import fsp from 'node:fs/promises'
import path from 'node:path'
import type { FastifyInstance } from 'fastify'
import { and, asc, eq } from 'drizzle-orm'
import type { PinDto, PinListResponse } from '@fs/shared'
import { canSee } from '../acl/resolve'
import { loadAclRules } from '../acl/store'
import { config } from '../config'
import { db } from '../db'
import { pinnedPaths } from '../db/schema'
import { resolveAbs, toRelPath } from '../fs/safe-path'
import { errorBody } from '../types'

/** R4 즐겨찾기 — 유저별 핀. 사라진 경로는 조회 시 지연 정리 */
export default async function pinsRoutes(app: FastifyInstance) {
  app.get('/api/pins', async (req) => {
    const user = req.user!
    const rows = db
      .select()
      .from(pinnedPaths)
      .where(eq(pinnedPaths.userId, user.id))
      .orderBy(asc(pinnedPaths.createdAt))
      .all()
    const pins: PinDto[] = []
    for (const row of rows) {
      const stat = await fsp
        .stat(resolveAbs(config.storageRoot, row.path))
        .catch(() => null)
      if (!stat) {
        // 대상이 사라짐(삭제/이동) → 핀 자동 정리
        db.delete(pinnedPaths)
          .where(and(eq(pinnedPaths.userId, user.id), eq(pinnedPaths.path, row.path)))
          .run()
        continue
      }
      pins.push({ path: row.path, name: path.basename(row.path), isDir: stat.isDirectory() })
    }
    const res: PinListResponse = { pins }
    return res
  })

  app.post('/api/pins', async (req, reply) => {
    const user = req.user!
    const rel = toRelPath((req.body as { path?: string })?.path)
    if (rel === '/' || !canSee(user, rel, loadAclRules())) {
      return reply.code(403).send(errorBody('FORBIDDEN', '접근할 수 없는 경로입니다'))
    }
    db.insert(pinnedPaths)
      .values({ userId: user.id, path: rel, createdAt: Date.now() })
      .onConflictDoNothing()
      .run()
    return reply.code(204).send()
  })

  app.delete('/api/pins', async (req, reply) => {
    const user = req.user!
    const rel = toRelPath((req.query as { path?: string }).path)
    db.delete(pinnedPaths)
      .where(and(eq(pinnedPaths.userId, user.id), eq(pinnedPaths.path, rel)))
      .run()
    return reply.code(204).send()
  })
}
