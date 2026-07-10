import fs from 'node:fs'
import path from 'node:path'

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
  baseUrl: (env.BASE_URL ?? 'http://localhost:5173').replace(/\/$/, ''),
  sessionSecret: env.SESSION_SECRET ?? 'dev-only-insecure-secret',
  storageRoot: path.resolve(env.STORAGE_ROOT ?? './data/storage'),
  databasePath: path.resolve(env.DATABASE_PATH ?? './data/app.db'),
  maxUploadMb: Number(env.MAX_UPLOAD_MB ?? 2048),
  discord,
  devAuth,
  devUser: {
    id: env.DEV_USER_ID ?? '100000000000000001',
    username: env.DEV_USERNAME ?? 'dev',
    roles: (env.DEV_ROLES ?? 'design').split(',').map((r) => r.trim()).filter(Boolean),
  },
}

fs.mkdirSync(config.storageRoot, { recursive: true })
fs.mkdirSync(path.dirname(config.databasePath), { recursive: true })
