import { createReadStream } from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import type { FastifyInstance } from 'fastify'
import type { VersionListResponse } from '@fs/shared'
import { resolvePermission } from '../acl/resolve'
import { loadAclRules } from '../acl/store'
import { config } from '../config'
import { emitChanged, parentDirOf } from '../events'
import { indexUpsert } from '../fs/indexer'
import { recordActivity, setFileMeta } from '../fs/meta'
import { resolveAbs, toRelPath } from '../fs/safe-path'
import { listVersions, stashVersion, versionAbs } from '../fs/versions'
import { errorBody } from '../types'

/** R4 간이 버전 보관 — 같은 이름 덮어쓰기 시 자동 보관된 이전본 열람/복원 */
export default async function versionsRoutes(app: FastifyInstance) {
  app.get('/api/fs/versions', async (req, reply) => {
    const user = req.user!
    const rel = toRelPath((req.query as { path?: string }).path)
    if (resolvePermission(user, rel, loadAclRules()) === 'none') {
      return reply.code(403).send(errorBody('FORBIDDEN', '접근 권한이 없습니다'))
    }
    const res: VersionListResponse = { path: rel, versions: await listVersions(rel) }
    return res
  })

  app.get('/api/fs/versions/download', async (req, reply) => {
    const user = req.user!
    const q = req.query as { path?: string; id?: string }
    const rel = toRelPath(q.path)
    if (resolvePermission(user, rel, loadAclRules()) === 'none') {
      return reply.code(403).send(errorBody('FORBIDDEN', '접근 권한이 없습니다'))
    }
    const abs = q.id ? versionAbs(rel, q.id) : null
    const stat = abs ? await fsp.stat(abs).catch(() => null) : null
    if (!abs || !stat?.isFile()) {
      return reply.code(404).send(errorBody('NOT_FOUND', '존재하지 않는 버전입니다'))
    }
    const origName = path.basename(rel)
    reply.header(
      'content-disposition',
      `attachment; filename="version"; filename*=UTF-8''${encodeURIComponent(origName)}`,
    )
    return reply.send(createReadStream(abs))
  })

  /** 복원: 현재 파일을 버전으로 보관 → 선택한 버전을 현재 자리로 */
  app.post('/api/fs/versions/restore', async (req, reply) => {
    const user = req.user!
    const body = req.body as { path?: string; id?: string }
    const rel = toRelPath(body?.path)
    if (resolvePermission(user, rel, loadAclRules()) !== 'write') {
      return reply.code(403).send(errorBody('FORBIDDEN', '수정 권한이 없습니다'))
    }
    const verAbs = body?.id ? versionAbs(rel, body.id) : null
    const verStat = verAbs ? await fsp.stat(verAbs).catch(() => null) : null
    if (!verAbs || !verStat?.isFile()) {
      return reply.code(404).send(errorBody('NOT_FOUND', '존재하지 않는 버전입니다'))
    }
    const abs = resolveAbs(config.storageRoot, rel)
    const cur = await fsp.stat(abs).catch(() => null)
    if (cur?.isFile()) await stashVersion(rel, abs)
    await fsp.rename(verAbs, abs)
    setFileMeta(rel, user.id)
    recordActivity('version_restore', rel, user.id, { versionId: body.id })
    indexUpsert(rel, { isDir: false, size: verStat.size, mtimeMs: Date.now() })
    emitChanged(parentDirOf(rel))
    return { path: rel }
  })
}
