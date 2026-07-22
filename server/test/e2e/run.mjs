// E2E 오케스트레이터 — 실제 서버를 임시 데이터로 띄우고 전체 시나리오를 돌린 뒤 정리한다.
// 실행:  pnpm test:e2e   (server 디렉터리 기준)
// 요구:  네이티브 모듈(better-sqlite3·sharp)이 빌드된 환경 — 즉 pnpm install 완료 후.
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { runChecks } from './checks.mjs'
import { BASE, SECRET, sleep } from './lib.mjs'

const SERVER_DIR = path.resolve(fileURLToPath(import.meta.url), '../../..') // .../server
const PORT = Number(new URL(BASE).port || 6099)
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'fs-e2e-'))

function log(m) {
  console.log(`[e2e] ${m}`)
}

async function waitHealthy(ms = 30000) {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) {
    try {
      if ((await fetch(BASE + '/api/health')).ok) return true
    } catch {
      /* not up yet */
    }
    await sleep(400)
  }
  return false
}

async function main() {
  // 픽스처 트리 — 부팅 시 fullScan이 인덱싱하도록 서버 기동 전에 만든다
  const storage = path.join(DATA, 'storage')
  for (const d of ['team/docs', 'team/drop', 'shared', 'home/u_editor']) {
    fs.mkdirSync(path.join(storage, d), { recursive: true })
  }
  fs.writeFileSync(path.join(storage, 'shared', 'notice.txt'), '전사 공지사항 원문')

  log(`서버 기동 (포트 ${PORT}, 데이터 ${DATA})`)
  const server = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts'], {
    cwd: SERVER_DIR,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      PORT: String(PORT),
      BASE_URL: BASE,
      SESSION_SECRET: SECRET,
      ADMIN_ROLE_ID: 'admin',
      STORAGE_ROOT: storage,
      DATABASE_PATH: path.join(DATA, 'app.db'),
      WATCH_POLLING: 'true',
      INDEX_RESCAN_MIN: '0',
      // Discord 미설정 → dev auth 모드 (E2E는 세션을 직접 심으므로 로그인 흐름 불필요)
      DISCORD_CLIENT_ID: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const logs = []
  server.stdout.on('data', (b) => logs.push(b.toString()))
  server.stderr.on('data', (b) => logs.push(b.toString()))
  let serverExited = false
  server.on('exit', (code) => {
    serverExited = true
    if (code) log(`서버 조기 종료 (code ${code})`)
  })

  let passed = false
  try {
    if (!(await waitHealthy())) {
      console.error('서버가 기동하지 못했습니다. 로그:')
      console.error(logs.join('').split('\n').slice(-20).join('\n'))
      throw new Error('server did not become healthy')
    }
    if (serverExited) throw new Error('server exited during startup')
    passed = await runChecks(DATA)
  } finally {
    server.kill('SIGTERM')
    await sleep(300)
    if (!serverExited) server.kill('SIGKILL')
    fs.rmSync(DATA, { recursive: true, force: true })
  }
  return passed
}

main()
  .then((ok) => process.exit(ok ? 0 : 1))
  .catch((e) => {
    console.error(e)
    process.exit(2)
  })
