import fsp from 'node:fs/promises'
import path from 'node:path'
import type { FastifyInstance } from 'fastify'
import type { FsEntry, ListResponse, TreeNode, TreeResponse } from '@fs/shared'
import { config } from '../config'
import { canSee, resolvePermission } from '../acl/resolve'
import { loadAclRules } from '../acl/store'
import { uploaderNamesFor } from '../fs/meta'
import { PathError, resolveAbs, toRelPath } from '../fs/safe-path'
import { errorBody } from '../types'

function childPath(parent: string, name: string): string {
  return parent === '/' ? `/${name}` : `${parent}/${name}`
}

export default async function fsRoutes(app: FastifyInstance) {
  /** 폴더 목록 — 탐색의 진실의 원천은 항상 라이브 readdir */
  app.get('/api/fs/list', async (req, reply) => {
    const user = req.user!
    const rel = toRelPath((req.query as { path?: string }).path)
    const rules = loadAclRules()
    if (!canSee(user, rel, rules)) {
      return reply.code(403).send(errorBody('FORBIDDEN', '접근 권한이 없습니다'))
    }
    const abs = resolveAbs(config.storageRoot, rel)
    const stat = await fsp.stat(abs).catch(() => null)
    if (!stat) return reply.code(404).send(errorBody('NOT_FOUND', '존재하지 않는 경로입니다'))
    if (!stat.isDirectory()) {
      return reply.code(400).send(errorBody('NOT_A_DIRECTORY', '폴더가 아닙니다'))
    }

    const dirents = await fsp.readdir(abs, { withFileTypes: true })
    const entries: FsEntry[] = []
    for (const d of dirents) {
      if (d.name.startsWith('.')) continue // .trash / .tmp / 숨김 파일
      const cRel = childPath(rel, d.name)
      const perm = resolvePermission(user, cRel, rules)
      if (perm === 'none' && !canSee(user, cRel, rules)) continue
      const cStat = await fsp.stat(path.join(abs, d.name)).catch(() => null)
      if (!cStat) continue
      entries.push({
        name: d.name,
        path: cRel,
        isDir: cStat.isDirectory(),
        size: cStat.isDirectory() ? 0 : cStat.size,
        mtime: Math.round(cStat.mtimeMs),
        // 경유 통로(none인데 하위 grant로 보이는 폴더)는 read로 표기
        permission: perm === 'none' ? 'read' : perm,
        uploader: null,
      })
    }
    // file_meta에서 업로더 표시명 연결
    const uploaders = uploaderNamesFor(entries.map((e) => e.path))
    for (const e of entries) e.uploader = uploaders.get(e.path) ?? null
    entries.sort((a, b) => Number(b.isDir) - Number(a.isDir) || a.name.localeCompare(b.name, 'ko'))
    const res: ListResponse = { path: rel, permission: resolvePermission(user, rel, rules), entries }
    return res
  })

  /** 사이드바 트리 — 하위 1단계의 "보이는" 폴더만 */
  app.get('/api/fs/tree', async (req, reply) => {
    const user = req.user!
    const rel = toRelPath((req.query as { path?: string }).path)
    const rules = loadAclRules()
    if (!canSee(user, rel, rules)) {
      return reply.code(403).send(errorBody('FORBIDDEN', '접근 권한이 없습니다'))
    }
    const abs = resolveAbs(config.storageRoot, rel)
    const dirents = await fsp.readdir(abs, { withFileTypes: true }).catch(() => null)
    if (!dirents) return reply.code(404).send(errorBody('NOT_FOUND', '존재하지 않는 경로입니다'))

    const nodes: TreeNode[] = []
    for (const d of dirents) {
      if (!d.isDirectory() || d.name.startsWith('.')) continue
      const cRel = childPath(rel, d.name)
      if (!canSee(user, cRel, rules)) continue
      const cAbs = path.join(abs, d.name)
      const grandChildren = await fsp.readdir(cAbs, { withFileTypes: true }).catch(() => [])
      const hasChildren = grandChildren.some(
        (g) => g.isDirectory() && !g.name.startsWith('.') && canSee(user, childPath(cRel, g.name), rules),
      )
      nodes.push({ name: d.name, path: cRel, hasChildren })
    }
    nodes.sort((a, b) => a.name.localeCompare(b.name, 'ko'))
    const res: TreeResponse = { path: rel, nodes }
    return res
  })

  /** 다운로드 — @fastify/static(send) 경유라 Range 요청 지원 */
  app.get('/api/fs/download', async (req, reply) => {
    const user = req.user!
    const rel = toRelPath((req.query as { path?: string }).path)
    const rules = loadAclRules()
    if (resolvePermission(user, rel, rules) === 'none') {
      return reply.code(403).send(errorBody('FORBIDDEN', '접근 권한이 없습니다'))
    }
    const abs = resolveAbs(config.storageRoot, rel)
    const stat = await fsp.stat(abs).catch(() => null)
    if (!stat) return reply.code(404).send(errorBody('NOT_FOUND', '존재하지 않는 파일입니다'))
    if (!stat.isFile()) {
      throw new PathError('파일이 아닙니다', 400)
    }
    const name = path.basename(rel)
    reply.header(
      'content-disposition',
      `attachment; filename="download"; filename*=UTF-8''${encodeURIComponent(name)}`,
    )
    return reply.sendFile(rel.slice(1), config.storageRoot)
  })
}
