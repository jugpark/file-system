import type { FastifyInstance } from 'fastify'
import type { SessionDto, SessionListResponse } from '@fs/shared'
import { listSessions, revokeOtherSessions, revokeSession } from '../auth/session'
import { errorBody } from '../types'

/** 세션 관리 — 내 로그인 기기 목록과 원격 해지 (기기 분실·공용 PC 대응) */
export default async function sessionsRoutes(app: FastifyInstance) {
  app.get('/api/sessions', async (req): Promise<SessionListResponse> => {
    const user = req.user!
    const rows = listSessions(user.id)
    const sessions: SessionDto[] = rows.map((r) => ({
      id: r.id,
      userAgent: r.userAgent,
      createdAt: r.createdAt,
      lastSeenAt: r.lastSeenAt,
      expiresAt: r.expiresAt,
      current: r.id === req.sessionId,
    }))
    return { sessions }
  })

  app.delete('/api/sessions/:id', async (req, reply) => {
    const user = req.user!
    const { id } = req.params as { id: string }
    if (id === req.sessionId) {
      // 현재 세션은 로그아웃으로 끊는다 — 실수로 자기 세션을 여기서 지우는 것 방지
      return reply.code(400).send(errorBody('CURRENT_SESSION', '현재 기기는 로그아웃으로 종료하세요'))
    }
    const n = revokeSession(id, user.id)
    if (n === 0) return reply.code(404).send(errorBody('NOT_FOUND', '이미 없는 세션입니다'))
    return reply.code(204).send()
  })

  app.post('/api/sessions/revoke-others', async (req, reply) => {
    const user = req.user!
    if (!req.sessionId) return reply.code(400).send(errorBody('NO_SESSION', '세션을 확인할 수 없습니다'))
    const n = revokeOtherSessions(req.sessionId, user.id)
    return { revoked: n }
  })
}
