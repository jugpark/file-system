import crypto from 'node:crypto'
import fsp from 'node:fs/promises'
import path from 'node:path'
import type { FastifyInstance } from 'fastify'
import { desc, eq, sql } from 'drizzle-orm'
import type { CreateShareBody, ShareLinkDto, ShareListResponse } from '@fs/shared'
import { resolvePermission } from '../acl/resolve'
import { loadAclRules } from '../acl/store'
import { config } from '../config'
import { db } from '../db'
import { shareLinks } from '../db/schema'
import { recordActivity } from '../fs/meta'
import { resolveAbs, toRelPath } from '../fs/safe-path'
import { errorBody } from '../types'

/**
 * R4 공유 링크 — 인증 없이 토큰만으로 다운로드되는 외부 공유 경로.
 * 인증 우회 통로이므로: 파일 전용 · write 권한자만 생성 · 만료 필수 · 전부 activity 기록.
 */

function toDto(row: typeof shareLinks.$inferSelect): ShareLinkDto {
  return {
    token: row.token,
    path: row.path,
    name: path.basename(row.path),
    url: `${config.baseUrl}/share/${row.token}`,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
    downloadCount: row.downloadCount,
    expired: row.expiresAt < Date.now(),
  }
}

export default async function shareRoutes(app: FastifyInstance) {
  app.post('/api/share', async (req, reply) => {
    const user = req.user!
    const body = req.body as CreateShareBody
    const rel = toRelPath(body?.path)
    if (resolvePermission(user, rel, loadAclRules()) !== 'write') {
      return reply.code(403).send(errorBody('FORBIDDEN', '공유 링크는 수정 권한자만 만들 수 있습니다'))
    }
    const abs = resolveAbs(config.storageRoot, rel)
    const stat = await fsp.stat(abs).catch(() => null)
    if (!stat?.isFile()) {
      return reply.code(400).send(errorBody('FILE_ONLY', '파일만 공유할 수 있습니다'))
    }
    const days = [1, 7, 30].includes(Number(body?.expiresDays)) ? Number(body.expiresDays) : 7
    const token = crypto.randomBytes(16).toString('base64url')
    const now = Date.now()
    db.insert(shareLinks)
      .values({
        token,
        path: rel,
        createdBy: user.id,
        createdAt: now,
        expiresAt: now + days * 24 * 60 * 60 * 1000,
      })
      .run()
    recordActivity('share_create', rel, user.id, { token, expiresDays: days })
    const row = db.select().from(shareLinks).where(eq(shareLinks.token, token)).get()!
    return toDto(row)
  })

  /** 내 공유 링크 목록 (admin은 전체) */
  app.get('/api/share', async (req) => {
    const user = req.user!
    const rows = user.isAdmin
      ? db.select().from(shareLinks).orderBy(desc(shareLinks.createdAt)).all()
      : db
          .select()
          .from(shareLinks)
          .where(eq(shareLinks.createdBy, user.id))
          .orderBy(desc(shareLinks.createdAt))
          .all()
    const res: ShareListResponse = { links: rows.map(toDto) }
    return res
  })

  app.delete('/api/share/:token', async (req, reply) => {
    const user = req.user!
    const { token } = req.params as { token: string }
    const row = db.select().from(shareLinks).where(eq(shareLinks.token, token)).get()
    if (!row) return reply.code(404).send(errorBody('NOT_FOUND', '존재하지 않는 링크입니다'))
    if (row.createdBy !== user.id && !user.isAdmin) {
      return reply.code(403).send(errorBody('FORBIDDEN', '본인이 만든 링크만 해지할 수 있습니다'))
    }
    db.delete(shareLinks).where(eq(shareLinks.token, token)).run()
    recordActivity('share_revoke', row.path, user.id, { token })
    return reply.code(204).send()
  })

  /**
   * 공개 다운로드 — 인증 가드 밖(/api/* 가 아님). 공개 엔드포인트라 rate limit 강화.
   * 실패 응답은 존재 여부를 구분하지 않는 단일 메시지(토큰 스캔 대응).
   */
  app.get(
    '/share/:token',
    { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const { token } = req.params as { token: string }
      const gone = () =>
        reply
          .code(404)
          .type('text/plain; charset=utf-8')
          .send('링크가 만료됐거나 존재하지 않습니다.')
      if (!/^[A-Za-z0-9_-]{10,64}$/.test(token)) return gone()
      const row = db.select().from(shareLinks).where(eq(shareLinks.token, token)).get()
      if (!row || row.expiresAt < Date.now()) return gone()
      const abs = resolveAbs(config.storageRoot, row.path)
      const stat = await fsp.stat(abs).catch(() => null)
      if (!stat?.isFile()) return gone()

      db.update(shareLinks)
        .set({ downloadCount: sql`${shareLinks.downloadCount} + 1` })
        .where(eq(shareLinks.token, token))
        .run()
      const name = path.basename(row.path)
      reply.header(
        'content-disposition',
        `attachment; filename="download"; filename*=UTF-8''${encodeURIComponent(name)}`,
      )
      return reply.sendFile(row.path.slice(1), config.storageRoot)
    },
  )
}
