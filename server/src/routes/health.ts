import fsp from 'node:fs/promises'
import fs from 'node:fs'
import type { FastifyInstance } from 'fastify'
import { config } from '../config'
import { sqlite } from '../db'

export default async function healthRoutes(app: FastifyInstance) {
  app.get('/api/health', async (_req, reply) => {
    try {
      sqlite.prepare('SELECT 1').get()
      await fsp.access(config.storageRoot, fs.constants.W_OK)
      return { ok: true }
    } catch (err) {
      app.log.error({ err }, 'health check failed')
      return reply.code(503).send({ ok: false })
    }
  })
}
