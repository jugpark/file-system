import type { SessionUser } from './auth/session'

declare module 'fastify' {
  interface FastifyRequest {
    user: SessionUser | null
  }
}

export function errorBody(code: string, message: string) {
  return { error: { code, message } }
}
