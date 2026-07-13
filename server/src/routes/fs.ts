import fsp from 'node:fs/promises'
import path from 'node:path'
import type { FastifyInstance } from 'fastify'
import type { FsEntry, ListResponse, TreeNode, TreeResponse } from '@fs/shared'
import { config } from '../config'
import { canSee, resolvePermission } from '../acl/resolve'
import { loadAclRules } from '../acl/store'
import { inlineMimeFor, streamInline } from '../fs/inline'
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

  /**
   * 다운로드 — 기본은 attachment(@fastify/static 경유, Range 지원).
   * inline=1이면 MIME 화이트리스트에 있는 종류만 inline 스트리밍(미리보기용).
   * html/svg 등 화이트리스트 밖은 항상 attachment — 저장 XSS 차단.
   */
  app.get('/api/fs/download', async (req, reply) => {
    const user = req.user!
    const q = req.query as { path?: string; inline?: string }
    const rel = toRelPath(q.path)
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

    if (q.inline === '1') {
      const mime = inlineMimeFor(name)
      if (mime) return streamInline(req, reply, abs, stat, mime, name)
      // 화이트리스트 밖 → attachment로 폴백
    }
    reply.header(
      'content-disposition',
      `attachment; filename="download"; filename*=UTF-8''${encodeURIComponent(name)}`,
    )
    return reply.sendFile(rel.slice(1), config.storageRoot)
  })

  /** 여러 항목/폴더를 zip 스트리밍으로 다운로드 (임시 파일 없음) */
  app.get('/api/fs/download-zip', async (req, reply) => {
    const user = req.user!
    const raw = (req.query as { paths?: string | string[] }).paths
    const inputs = (Array.isArray(raw) ? raw : raw ? [raw] : []).slice(0, 200)
    if (inputs.length === 0) {
      return reply.code(400).send(errorBody('NO_PATHS', '다운로드할 항목이 없습니다'))
    }
    const rules = loadAclRules()
    const targets: Array<{ abs: string; name: string; isDir: boolean }> = []
    for (const input of inputs) {
      const rel = toRelPath(input)
      if (resolvePermission(user, rel, rules) === 'none') {
        return reply.code(403).send(errorBody('FORBIDDEN', `접근 권한이 없습니다: ${rel}`))
      }
      const abs = resolveAbs(config.storageRoot, rel)
      const stat = await fsp.stat(abs).catch(() => null)
      if (!stat) return reply.code(404).send(errorBody('NOT_FOUND', `존재하지 않음: ${rel}`))
      targets.push({ abs, name: path.basename(rel), isDir: stat.isDirectory() })
    }

    const { default: archiver } = await import('archiver')
    const archive = archiver('zip', { zlib: { level: 6 } })
    archive.on('error', (err) => {
      req.log.warn({ err }, 'zip 스트리밍 실패')
      reply.raw.destroy()
    })
    for (const t of targets) {
      if (t.isDir) archive.directory(t.abs, t.name)
      else archive.file(t.abs, { name: t.name })
    }
    const zipName =
      targets.length === 1 ? `${targets[0]!.name}.zip` : `사내스토리지_${targets.length}개항목.zip`
    reply.header(
      'content-disposition',
      `attachment; filename="download.zip"; filename*=UTF-8''${encodeURIComponent(zipName)}`,
    )
    reply.type('application/zip')
    archive.finalize()
    return reply.send(archive)
  })
}
