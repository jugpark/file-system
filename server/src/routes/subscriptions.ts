import fsp from 'node:fs/promises'
import path from 'node:path'
import type { FastifyInstance } from 'fastify'
import { and, asc, eq } from 'drizzle-orm'
import type { SubscriptionListResponse } from '@fs/shared'
import { canSee } from '../acl/resolve'
import { loadAclRules } from '../acl/store'
import { config } from '../config'
import { db } from '../db'
import { subscriptions } from '../db/schema'
import { resolveAbs, toRelPath } from '../fs/safe-path'
import { errorBody } from '../types'

/** 폴더 구독 — 구독 폴더 아래 업로드/삭제 시 Discord DM. 핀과 같은 유저별 경로 목록 */
export default async function subscriptionsRoutes(app: FastifyInstance) {
  app.get('/api/subscriptions', async (req): Promise<SubscriptionListResponse> => {
    const user = req.user!
    const rows = db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.userId, user.id))
      .orderBy(asc(subscriptions.createdAt))
      .all()
    const list: SubscriptionListResponse['subscriptions'] = []
    for (const row of rows) {
      const stat = await fsp.stat(resolveAbs(config.storageRoot, row.path)).catch(() => null)
      if (!stat?.isDirectory()) {
        // 폴더가 사라짐(삭제/이동) → 구독 자동 정리
        db.delete(subscriptions)
          .where(and(eq(subscriptions.userId, user.id), eq(subscriptions.path, row.path)))
          .run()
        continue
      }
      list.push({ path: row.path, name: path.basename(row.path) || '전체' })
    }
    return { subscriptions: list }
  })

  app.post('/api/subscriptions', async (req, reply) => {
    const user = req.user!
    const rel = toRelPath((req.body as { path?: string })?.path)
    if (rel === '/' || !canSee(user, rel, loadAclRules())) {
      return reply.code(403).send(errorBody('FORBIDDEN', '접근할 수 없는 경로입니다'))
    }
    const stat = await fsp.stat(resolveAbs(config.storageRoot, rel)).catch(() => null)
    if (!stat?.isDirectory()) {
      return reply.code(400).send(errorBody('DIR_ONLY', '폴더만 구독할 수 있습니다'))
    }
    db.insert(subscriptions)
      .values({ userId: user.id, path: rel, createdAt: Date.now() })
      .onConflictDoNothing()
      .run()
    return reply.code(204).send()
  })

  app.delete('/api/subscriptions', async (req, reply) => {
    const user = req.user!
    const rel = toRelPath((req.query as { path?: string }).path)
    db.delete(subscriptions)
      .where(and(eq(subscriptions.userId, user.id), eq(subscriptions.path, rel)))
      .run()
    return reply.code(204).send()
  })
}
