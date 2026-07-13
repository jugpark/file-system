import fs from 'node:fs'
import type { FastifyInstance } from 'fastify'
import type { MeResponse } from '@fs/shared'
import { config } from '../config'
import { resolveAbs } from '../fs/safe-path'

export default async function meRoutes(app: FastifyInstance) {
  app.get('/api/me', async (req): Promise<MeResponse> => {
    const u = req.user!
    const homePath = `/home/${u.id}`
    let homeExists = false
    try {
      homeExists = fs.statSync(resolveAbs(config.storageRoot, homePath)).isDirectory()
    } catch {
      /* 없거나 접근 불가 → false */
    }
    return {
      id: u.id,
      username: u.username,
      avatarUrl: u.avatarUrl,
      roles: u.roles,
      homePath,
      homeExists,
      isAdmin: u.isAdmin,
    }
  })
}
