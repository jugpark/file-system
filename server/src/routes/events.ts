import type { FastifyInstance } from 'fastify'
import { canSee } from '../acl/resolve'
import { loadAclRules } from '../acl/store'
import { onChanged } from '../events'

/**
 * SSE — 폴더 변경 무효화 신호. 클라이언트는 받은 경로의 목록/트리 캐시만 다시 불러온다.
 * 권한 없는 경로는 그 유저의 스트림에 아예 흘리지 않는다(경로명 노출 방지).
 */
export default async function eventsRoutes(app: FastifyInstance) {
  app.get('/api/events', (req, reply) => {
    const user = req.user!
    reply.hijack()
    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    })
    reply.raw.write('retry: 3000\n\n')

    const off = onChanged((dirPath) => {
      try {
        if (!canSee(user, dirPath, loadAclRules())) return
        reply.raw.write(`data: ${JSON.stringify({ type: 'changed', path: dirPath })}\n\n`)
      } catch {
        /* 스트림이 죽었으면 close 핸들러가 정리한다 */
      }
    })
    const heartbeat = setInterval(() => reply.raw.write(':hb\n\n'), 30_000)

    req.raw.on('close', () => {
      clearInterval(heartbeat)
      off()
    })
  })
}
