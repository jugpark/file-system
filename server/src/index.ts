import fs from 'node:fs'
import path from 'node:path'
import Fastify from 'fastify'
import fastifyCookie from '@fastify/cookie'
import fastifyMultipart from '@fastify/multipart'
import fastifyStatic from '@fastify/static'
import { ROLE_CACHE_TTL_MS, ROLE_STALE_MAX_MS, SESSION_COOKIE } from '@fs/shared'
import { config } from './config'
import { fetchMemberRoles } from './auth/discord'
import { deleteSession, getSessionWithUser, updateSessionRoles } from './auth/session'
import { PathError } from './fs/safe-path'
import { fullScan } from './fs/indexer'
import { purgeTrash } from './fs/purge'
import authRoutes from './routes/auth'
import fsRoutes from './routes/fs'
import fsWriteRoutes from './routes/fs-write'
import healthRoutes from './routes/health'
import meRoutes from './routes/me'
import metaRoutes from './routes/meta'
import thumbnailRoutes from './routes/thumbnail'
import { errorBody } from './types'
import { startWatcher } from './watcher'

const app = Fastify({ logger: true })

await app.register(fastifyCookie, { secret: config.sessionSecret })
await app.register(fastifyMultipart, {
  limits: { fileSize: config.maxUploadMb * 1024 * 1024, files: 1 },
})
// 다운로드용 — serve:false, reply.sendFile 데코레이터만 사용 (Range 지원)
await app.register(fastifyStatic, { root: config.storageRoot, serve: false })

// 중단된 업로드 스테이징 잔여물 청소
for (const leftover of fs.readdirSync(config.tmpDir)) {
  fs.rmSync(path.join(config.tmpDir, leftover), { recursive: true, force: true })
}

app.decorateRequest('user', null)

// ── 인증 가드: /api/auth/*, /api/health 를 제외한 모든 /api/* ──
app.addHook('onRequest', async (req, reply) => {
  const url = req.raw.url ?? ''
  if (!url.startsWith('/api/')) return
  if (url.startsWith('/api/auth/') || url.startsWith('/api/health')) return

  const unauthorized = () =>
    reply.code(401).send(errorBody('UNAUTHORIZED', '로그인이 필요합니다'))

  const raw = req.cookies[SESSION_COOKIE]
  if (!raw) return unauthorized()
  const unsigned = req.unsignCookie(raw)
  if (!unsigned.valid || !unsigned.value) return unauthorized()
  const sid = unsigned.value

  const found = getSessionWithUser(sid)
  if (!found || found.session.expiresAt < Date.now()) return unauthorized()

  let roles: string[] = JSON.parse(found.session.rolesJson)
  const age = Date.now() - found.session.rolesFetchedAt

  // role 캐시 갱신 (dev auth는 갱신 대상 없음)
  if (!config.devAuth && age > ROLE_CACHE_TTL_MS) {
    try {
      const fresh = await fetchMemberRoles(found.user.id)
      if (fresh === null) {
        // 길드에서 나감/강퇴 → 즉시 차단
        deleteSession(sid)
        reply.clearCookie(SESSION_COOKIE, { path: '/' })
        return unauthorized()
      }
      updateSessionRoles(sid, fresh)
      roles = fresh
    } catch (err) {
      if (age > ROLE_STALE_MAX_MS) return unauthorized()
      req.log.warn({ err }, 'Discord role refresh failed — stale roles 사용')
    }
  }

  req.user = {
    id: found.user.id,
    username: found.user.username,
    avatarUrl: found.user.avatarUrl,
    roles,
  }
})

app.setErrorHandler((err, req, reply) => {
  if (err instanceof PathError) {
    return reply.code(err.statusCode).send(errorBody('BAD_PATH', err.message))
  }
  req.log.error({ err }, 'unhandled error')
  return reply.code(500).send(errorBody('INTERNAL', '서버 오류가 발생했습니다'))
})

await app.register(authRoutes)
await app.register(meRoutes)
await app.register(fsRoutes)
await app.register(fsWriteRoutes)
await app.register(metaRoutes)
await app.register(thumbnailRoutes)
await app.register(healthRoutes)

// ── SPA 정적 서빙 (프로덕션: web 빌드 결과물이 server/public 에 있음) ──
const publicDir = path.resolve(import.meta.dirname, '../public')
if (fs.existsSync(publicDir)) {
  await app.register(fastifyStatic, { root: publicDir, decorateReply: false })
}
app.setNotFoundHandler((req, reply) => {
  if ((req.raw.url ?? '').startsWith('/api/')) {
    return reply.code(404).send(errorBody('NOT_FOUND', '존재하지 않는 API입니다'))
  }
  if (fs.existsSync(path.join(publicDir, 'index.html'))) {
    return reply.sendFile('index.html', publicDir)
  }
  return reply.code(404).send('Not Found (dev 모드에서는 web을 :5173으로 접속하세요)')
})

await app.listen({ port: config.port, host: '0.0.0.0' })
if (config.devAuth) {
  app.log.warn('⚠ dev auth 모드 — Discord 미설정. /api/auth/login 이 가짜 유저로 로그인합니다')
}

// 검색 인덱스: 기동 시 전체 스캔으로 실제 상태와 동기화 후, 워처가 외부 변경을 추적
const indexed = await fullScan()
app.log.info(`fs_index 전체 스캔 완료 — ${indexed}개 항목`)
startWatcher(app.log)
// 워처가 놓치는 변경(inotify 미지원 마운트 등)의 안전망 — 주기적 재스캔
if (config.rescanMinutes > 0) {
  const timer = setInterval(() => {
    fullScan().catch((err) => app.log.warn({ err }, '주기 재스캔 실패'))
  }, config.rescanMinutes * 60_000)
  timer.unref()
  app.log.info(`fs_index 주기 재스캔: ${config.rescanMinutes}분 간격`)
}

// 휴지통 자동 비우기 — 기동 시 1회 + 매일
if (config.trashRetentionDays > 0) {
  const runPurge = async () => {
    const n = await purgeTrash(config.trashRetentionDays)
    if (n > 0) app.log.info(`휴지통 자동 비우기: ${n}개 영구 삭제 (보존 ${config.trashRetentionDays}일)`)
  }
  runPurge().catch((err) => app.log.warn({ err }, '휴지통 비우기 실패'))
  const purgeTimer = setInterval(() => {
    runPurge().catch((err) => app.log.warn({ err }, '휴지통 비우기 실패'))
  }, 24 * 60 * 60 * 1000)
  purgeTimer.unref()
}
