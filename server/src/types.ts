import type { SessionUser } from './auth/session'

declare module 'fastify' {
  interface FastifyRequest {
    user: SessionUser | null
    /** 현재 요청을 인증한 세션 id (세션 관리에서 '현재 기기' 판별용) */
    sessionId: string | null
  }
}

export function errorBody(code: string, message: string) {
  return { error: { code, message } }
}
