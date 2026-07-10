import type { FastifyInstance } from 'fastify'
import type { MeResponse } from '@fs/shared'

export default async function meRoutes(app: FastifyInstance) {
  app.get('/api/me', async (req): Promise<MeResponse> => {
    const u = req.user!
    return {
      id: u.id,
      username: u.username,
      avatarUrl: u.avatarUrl,
      roles: u.roles,
      homePath: `/home/${u.id}`,
    }
  })
}
