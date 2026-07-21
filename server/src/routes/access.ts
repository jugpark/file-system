import type { FastifyInstance } from 'fastify'
import { and, desc, eq } from 'drizzle-orm'
import type {
  AccessRequestDto,
  AccessRequestListResponse,
  CreateAccessRequestBody,
} from '@fs/shared'
import { resolvePermission } from '../acl/resolve'
import { loadAclRules } from '../acl/store'
import { db } from '../db'
import { accessRequests, users } from '../db/schema'
import { toRelPath } from '../fs/safe-path'
import { dmAccessResolved, notifyAccessRequest } from '../notify'
import { errorBody } from '../types'

/**
 * 접근 요청 — ACL로 못 보는/읽기전용 폴더에 대해 유저가 권한을 신청.
 * ACL은 role 기반이라 자동 부여는 하지 않는다: 요청은 admin의 처리 큐 + 알림 고리를 닫는다.
 * 승인/반려는 결정 기록 + 요청자 DM. 실제 ACL 규칙은 admin이 관리 화면에서 추가.
 */
export default async function accessRoutes(app: FastifyInstance) {
  app.post('/api/access-requests', async (req, reply) => {
    const user = req.user!
    const body = req.body as CreateAccessRequestBody
    const rel = toRelPath(body?.path)
    const permission = body?.permission === 'write' ? 'write' : 'read'
    if (rel === '/') return reply.code(400).send(errorBody('BAD_PATH', '루트는 요청 대상이 아닙니다'))

    // 이미 그 권한이 있으면 요청 불필요
    const current = resolvePermission(user, rel, loadAclRules())
    if (current === 'write' || (permission === 'read' && current === 'read')) {
      return reply.code(409).send(errorBody('ALREADY', '이미 접근 권한이 있습니다'))
    }
    // 같은 경로의 대기 중 요청이 있으면 중복 생성 안 함
    const pending = db
      .select({ id: accessRequests.id })
      .from(accessRequests)
      .where(
        and(
          eq(accessRequests.userId, user.id),
          eq(accessRequests.path, rel),
          eq(accessRequests.status, 'pending'),
        ),
      )
      .get()
    if (pending) {
      return reply.code(409).send(errorBody('PENDING', '이미 처리 대기 중인 요청이 있습니다'))
    }
    const now = Date.now()
    db.insert(accessRequests)
      .values({
        userId: user.id,
        path: rel,
        permission,
        note: (body?.note ?? '').slice(0, 500) || null,
        status: 'pending',
        createdAt: now,
      })
      .run()
    notifyAccessRequest(user.username, rel, permission)
    return reply.code(201).send({ ok: true })
  })

  /** 내가 낸 요청 목록 */
  app.get('/api/access-requests', async (req): Promise<AccessRequestListResponse> => {
    const user = req.user!
    const rows = db
      .select()
      .from(accessRequests)
      .where(eq(accessRequests.userId, user.id))
      .orderBy(desc(accessRequests.createdAt))
      .all()
    return { requests: rows.map(toDto) }
  })
}

function toDto(r: typeof accessRequests.$inferSelect): AccessRequestDto {
  return {
    id: r.id,
    path: r.path,
    permission: r.permission,
    note: r.note,
    status: r.status,
    createdAt: r.createdAt,
    resolvedAt: r.resolvedAt,
  }
}

/** admin 라우트(관리 가드 안)에서 등록 — 대기 목록 조회 + 처리 */
export function registerAdminAccessRoutes(app: FastifyInstance): void {
  app.get('/api/admin/access-requests', async (): Promise<AccessRequestListResponse> => {
    const rows = db
      .select({
        id: accessRequests.id,
        userId: accessRequests.userId,
        path: accessRequests.path,
        permission: accessRequests.permission,
        note: accessRequests.note,
        status: accessRequests.status,
        createdAt: accessRequests.createdAt,
        resolvedBy: accessRequests.resolvedBy,
        resolvedAt: accessRequests.resolvedAt,
        requesterName: users.username,
      })
      .from(accessRequests)
      .leftJoin(users, eq(users.id, accessRequests.userId))
      .orderBy(desc(accessRequests.createdAt))
      .limit(100)
      .all()
    const requests: AccessRequestDto[] = rows.map((r) => ({
      id: r.id,
      path: r.path,
      permission: r.permission,
      note: r.note,
      status: r.status,
      createdAt: r.createdAt,
      requesterName: r.requesterName ?? r.userId,
      resolvedAt: r.resolvedAt,
    }))
    return { requests }
  })

  app.post('/api/admin/access-requests/:id/resolve', async (req, reply) => {
    const admin = req.user!
    const { id } = req.params as { id: string }
    const { approve, note } = (req.body as { approve?: boolean; note?: string }) ?? {}
    const row = db.select().from(accessRequests).where(eq(accessRequests.id, Number(id))).get()
    if (!row) return reply.code(404).send(errorBody('NOT_FOUND', '없는 요청입니다'))
    if (row.status !== 'pending') {
      return reply.code(409).send(errorBody('RESOLVED', '이미 처리된 요청입니다'))
    }
    db.update(accessRequests)
      .set({
        status: approve ? 'approved' : 'denied',
        resolvedBy: admin.id,
        resolvedAt: Date.now(),
        note: note?.slice(0, 500) ?? row.note,
      })
      .where(eq(accessRequests.id, row.id))
      .run()
    dmAccessResolved(row.userId, row.path, !!approve, note)
    return { ok: true }
  })
}
