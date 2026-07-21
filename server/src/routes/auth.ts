import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import type { FastifyInstance, FastifyReply } from 'fastify'
import { SESSION_COOKIE, SESSION_TTL_DAYS } from '@fs/shared'
import { config } from '../config'
import { authorizeUrl, exchangeCode, fetchDiscordUser, fetchMemberRoles } from '../auth/discord'
import { createSession, deleteSession, upsertUser } from '../auth/session'
import { resolveAbs } from '../fs/safe-path'

function setSessionCookie(reply: FastifyReply, sid: string) {
  reply.setCookie(SESSION_COOKIE, sid, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: config.isProd,
    signed: true,
    maxAge: SESSION_TTL_DAYS * 24 * 60 * 60,
  })
}

/** 첫 로그인 시 개인 공간 폴더를 만들어 둔다 — 실패해도 로그인은 진행 */
function ensureHomeDir(userId: string) {
  try {
    fs.mkdirSync(resolveAbs(config.storageRoot, `/home/${userId}`), { recursive: true })
  } catch {
    // 스토리지 루트에 쓸 수 없는 환경(드라이브 루트 등) — 개인 공간 없이 동작
  }
}

/** 로그인 계열은 봇 스캔 대상 — 전역(300/분)보다 엄격하게 */
const STRICT_RATE = { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }

export default async function authRoutes(app: FastifyInstance) {
  app.get('/api/auth/login', STRICT_RATE, async (req, reply) => {
    if (config.devAuth) {
      // Discord 미설정 개발 모드: 가짜 유저로 즉시 로그인
      const dev = config.devUser
      upsertUser({ id: dev.id, username: dev.username, avatarUrl: null })
      ensureHomeDir(dev.id)
      setSessionCookie(reply, createSession(dev.id, dev.roles, req.headers['user-agent']))
      return reply.redirect('/')
    }
    const state = crypto.randomBytes(16).toString('hex')
    reply.setCookie('oauth_state', state, {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: config.isProd,
      signed: true,
      maxAge: 600,
    })
    return reply.redirect(authorizeUrl(state))
  })

  app.get('/api/auth/callback', STRICT_RATE, async (req, reply) => {
    const { code, state } = req.query as { code?: string; state?: string }
    const rawState = req.cookies['oauth_state']
    const saved = rawState ? req.unsignCookie(rawState) : null
    reply.clearCookie('oauth_state', { path: '/' })
    if (!code || !state || !saved?.valid || saved.value !== state) {
      return reply.redirect('/login?error=oauth')
    }
    try {
      const accessToken = await exchangeCode(code)
      const duser = await fetchDiscordUser(accessToken)
      const roles = await fetchMemberRoles(duser.id)
      if (roles === null) return reply.redirect('/login?error=not_member')
      upsertUser(duser)
      ensureHomeDir(duser.id)
      setSessionCookie(reply, createSession(duser.id, roles, req.headers['user-agent']))
      return reply.redirect('/')
    } catch (err) {
      req.log.error({ err }, 'OAuth callback failed')
      return reply.redirect('/login?error=oauth')
    }
  })

  app.post('/api/auth/logout', async (req, reply) => {
    const raw = req.cookies[SESSION_COOKIE]
    const unsigned = raw ? req.unsignCookie(raw) : null
    if (unsigned?.valid && unsigned.value) deleteSession(unsigned.value)
    reply.clearCookie(SESSION_COOKIE, { path: '/' })
    return reply.code(204).send()
  })
}
