import fs from 'node:fs'
import path from 'node:path'

// .env 자동 로드 (server/.env 우선, 없으면 repo 루트) — 이미 설정된 env가 우선한다
for (const candidate of ['.env', '../.env']) {
  const p = path.resolve(candidate)
  if (fs.existsSync(p)) {
    process.loadEnvFile(p)
    break
  }
}

const env = process.env
const isProd = env.NODE_ENV === 'production'

const discord = {
  clientId: env.DISCORD_CLIENT_ID ?? '',
  clientSecret: env.DISCORD_CLIENT_SECRET ?? '',
  botToken: env.DISCORD_BOT_TOKEN ?? '',
  guildId: env.DISCORD_GUILD_ID ?? '',
}

/** Discord 설정이 없으면 개발용 가짜 로그인으로 동작 (프로덕션 금지) */
const devAuth = !discord.clientId

if (isProd && devAuth) {
  throw new Error('프로덕션에서는 DISCORD_CLIENT_ID 등 Discord 설정이 필수입니다')
}
if (isProd && (!env.SESSION_SECRET || env.SESSION_SECRET === 'change-me-in-production')) {
  throw new Error('프로덕션에서는 SESSION_SECRET을 반드시 설정해야 합니다')
}
if (!devAuth && (!discord.clientSecret || !discord.botToken || !discord.guildId)) {
  throw new Error('DISCORD_CLIENT_SECRET / DISCORD_BOT_TOKEN / DISCORD_GUILD_ID가 모두 필요합니다')
}

export const config = {
  isProd,
  port: Number(env.PORT ?? 3000),
  /** 바인딩 주소 — 본인 PC에서만 볼 때는 127.0.0.1 권장 */
  host: env.HOST ?? '0.0.0.0',
  baseUrl: (env.BASE_URL ?? 'http://localhost:5173').replace(/\/$/, ''),
  sessionSecret: env.SESSION_SECRET ?? 'dev-only-insecure-secret',
  storageRoot: path.resolve(env.STORAGE_ROOT ?? './data/storage'),
  /**
   * 업로드 스테이징/휴지통/버전 보관소 — 기본은 storage 안(.tmp 등).
   * rename이 원자적이려면 storage와 "같은 볼륨"이기만 하면 되므로,
   * 드라이브 루트처럼 루트에 폴더를 못 만드는 경우 env로 같은 볼륨의 다른 위치를 지정한다.
   */
  tmpDir: path.resolve(env.TMP_DIR ?? path.join(env.STORAGE_ROOT ?? './data/storage', '.tmp')),
  trashDir: path.resolve(env.TRASH_DIR ?? path.join(env.STORAGE_ROOT ?? './data/storage', '.trash')),
  databasePath: path.resolve(env.DATABASE_PATH ?? './data/app.db'),
  maxUploadMb: Number(env.MAX_UPLOAD_MB ?? 2048),
  /** inotify가 안 통하는 마운트(9p/drvfs, 일부 NFS/SMB)에서 true — 폴링 감시 */
  watchPolling: env.WATCH_POLLING === 'true',
  /** 주기적 전체 재스캔(분) — 워처가 놓친 변경의 안전망. 0=끔 */
  rescanMinutes: Number(env.INDEX_RESCAN_MIN ?? 10),
  /**
   * true면 검색 인덱스(기동 전체 스캔·워처·재스캔)를 전부 끈다.
   * 드라이브 루트처럼 초대형 트리를 STORAGE_ROOT로 잡을 때 필수 —
   * 탐색/업로드는 정상이고 검색·최근 파일만 빈 결과가 된다.
   */
  indexDisabled: env.INDEX_DISABLED === 'true',
  /** 휴지통 보존 일수 — 초과분은 매일 영구 삭제. 0=자동 비우기 끔 */
  trashRetentionDays: Number(env.TRASH_RETENTION_DAYS ?? 30),
  /** 이 Discord role 보유자는 admin — 전 경로 접근(남의 home은 read), 관리 API 사용 */
  adminRoleId: env.ADMIN_ROLE_ID ?? '',
  /** 설정 시 공유 폴더 업로드/삭제·디스크 경고를 이 웹훅으로 알림 */
  webhookUrl: env.DISCORD_WEBHOOK_URL ?? '',
  /** 같은 이름 덮어쓰기 시 이전 버전 보관소 */
  versionsDir: path.resolve(
    env.VERSIONS_DIR ?? path.join(env.STORAGE_ROOT ?? './data/storage', '.versions'),
  ),
  /** 썸네일 디스크 캐시 (스토리지가 아니라 DB 옆에 둔다) */
  thumbsDir: path.resolve(path.dirname(path.resolve(env.DATABASE_PATH ?? './data/app.db')), 'thumbs'),
  discord,
  devAuth,
  devUser: {
    id: env.DEV_USER_ID ?? '100000000000000001',
    username: env.DEV_USERNAME ?? 'dev',
    roles: (env.DEV_ROLES ?? 'design').split(',').map((r) => r.trim()).filter(Boolean),
  },
}

// Windows 드라이브 루트(C:\)는 존재해도 mkdirSync(recursive)가 EPERM을 던진다 → 존재하면 건너뜀
function ensureDir(p: string): void {
  if (fs.existsSync(p)) return
  fs.mkdirSync(p, { recursive: true })
}
ensureDir(config.storageRoot)
ensureDir(config.tmpDir)
ensureDir(config.trashDir)
ensureDir(path.dirname(config.databasePath))
ensureDir(config.thumbsDir)
ensureDir(config.versionsDir)
