import fs from 'node:fs'
import path from 'node:path'
import { eq } from 'drizzle-orm'
import { config, ensureDir } from './config'
import { db, sqlite } from './db'
import { settings } from './db/schema'

/**
 * 런타임 서버 설정 — 스토리지 루트를 UI(admin)에서 바꿀 수 있게 한다.
 * DB settings 테이블이 env보다 우선. 적용은 즉시(모든 라우트가 config를 요청 시점에 읽음).
 */

/** 스토리지 루트 검증 + config 반영. 작업 폴더(.tmp 등)도 새 루트 기준으로 재배치 */
export function applyStorageRoot(newRoot: string): void {
  const abs = path.resolve(newRoot)
  if (!path.isAbsolute(newRoot) && !/^[A-Za-z]:[\\/]/.test(newRoot)) {
    throw new Error('절대 경로여야 합니다 (예: C:/ 또는 /data/storage)')
  }
  let stat: fs.Stats
  try {
    stat = fs.statSync(abs)
  } catch {
    throw new Error(`존재하지 않는 경로입니다: ${abs}`)
  }
  if (!stat.isDirectory()) throw new Error('폴더가 아닙니다')

  config.storageRoot = abs

  // 작업 폴더 재배치 — env로 고정했으면 유지(같은 볼륨 유지는 운영자 책임),
  // 아니면 새 루트의 dot 디렉터리 → 실패 시 서버 data/work 폴백
  if (!config.workDirsPinned) {
    const targets: Array<['tmpDir' | 'trashDir' | 'versionsDir', string]> = [
      ['tmpDir', '.tmp'],
      ['trashDir', '.trash'],
      ['versionsDir', '.versions'],
    ]
    for (const [key, dotName] of targets) {
      const preferred = path.join(abs, dotName)
      try {
        ensureDir(preferred)
        config[key] = preferred
      } catch {
        const fallback = path.join(config.dataDir, 'work', dotName)
        ensureDir(fallback)
        config[key] = fallback
      }
    }
  } else {
    ensureDir(config.tmpDir)
    ensureDir(config.trashDir)
    ensureDir(config.versionsDir)
  }
}

/** 부팅 시 DB 저장값으로 env 기본을 덮어쓴다 (실패하면 env 값 유지) */
export function loadSettings(log?: { warn: (msg: string) => void }): void {
  const row = db.select().from(settings).where(eq(settings.key, 'storageRoot')).get()
  if (!row || path.resolve(row.value) === config.storageRoot) return
  try {
    applyStorageRoot(row.value)
    log?.warn(`설정에 저장된 스토리지 루트 적용: ${config.storageRoot}`)
  } catch (err) {
    log?.warn(
      `저장된 스토리지 루트(${row.value}) 적용 실패 — env 기본(${config.storageRoot}) 사용: ${
        err instanceof Error ? err.message : err
      }`,
    )
  }
}

/** 저장 + 적용 + 인덱스 초기화. 호출부(admin 라우트)가 워처 재시작·재스캔을 담당 */
export function saveStorageRoot(newRoot: string): string {
  applyStorageRoot(newRoot) // 검증 실패 시 여기서 throw — DB에 저장 안 됨
  db.insert(settings)
    .values({ key: 'storageRoot', value: config.storageRoot })
    .onConflictDoUpdate({ target: settings.key, set: { value: config.storageRoot } })
    .run()
  // 루트가 바뀌면 상대 경로 기반 인덱스는 전부 무효
  sqlite.prepare('DELETE FROM fs_index').run()
  return config.storageRoot
}
