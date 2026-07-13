import crypto from 'node:crypto'
import { createWriteStream } from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import type { FastifyInstance, FastifyReply } from 'fastify'
import { desc, eq, inArray } from 'drizzle-orm'
import type {
  BatchResponse,
  BatchResult,
  CopyBody,
  MkdirBody,
  MoveBody,
  RenameBody,
  RestoreBody,
  TrashBody,
  TrashItem,
  TrashListResponse,
  UploadResponse,
} from '@fs/shared'
import { canSee, resolvePermission, type AclRule } from '../acl/resolve'
import { loadAclRules } from '../acl/store'
import { config } from '../config'
import { db } from '../db'
import { trash, users } from '../db/schema'
import { indexMovePrefix, indexRemove, indexUpsert } from '../fs/indexer'
import { deleteMetaPrefix, moveMetaPrefix, recordActivity, setFileMeta } from '../fs/meta'
import { resolveCollision, resolveRestoreName, validateEntryName } from '../fs/names'
import { PathError, resolveAbs, toRelPath } from '../fs/safe-path'
import type { SessionUser } from '../auth/session'
import { errorBody } from '../types'

function childPath(parent: string, name: string): string {
  return parent === '/' ? `/${name}` : `${parent}/${name}`
}

function parentOf(rel: string): string {
  const segs = rel.split('/').filter(Boolean)
  return '/' + segs.slice(0, -1).join('/')
}

/** 대상 폴더가 존재하는 쓰기 가능 디렉터리인지 검증 후 절대 경로 반환 */
async function requireWritableDir(
  user: SessionUser,
  rel: string,
  rules: AclRule[],
  reply: FastifyReply,
): Promise<string | null> {
  if (resolvePermission(user, rel, rules) !== 'write') {
    reply.code(403).send(errorBody('FORBIDDEN', '이 폴더에 수정 권한이 없습니다'))
    return null
  }
  const abs = resolveAbs(config.storageRoot, rel)
  const stat = await fsp.stat(abs).catch(() => null)
  if (!stat?.isDirectory()) {
    reply.code(404).send(errorBody('NOT_FOUND', '존재하지 않는 폴더입니다'))
    return null
  }
  return abs
}

export default async function fsWriteRoutes(app: FastifyInstance) {
  /** 업로드 — .tmp에 스트리밍 후 rename(같은 볼륨=원자적). 실패 시 잔여물 없음 */
  app.post('/api/fs/upload', async (req, reply) => {
    const user = req.user!
    const rel = toRelPath((req.query as { path?: string }).path)
    const rules = loadAclRules()
    const absDir = await requireWritableDir(user, rel, rules, reply)
    if (!absDir) return

    const data = await req.file()
    if (!data) {
      return reply.code(400).send(errorBody('NO_FILE', '업로드할 파일이 없습니다'))
    }
    const name = validateEntryName(data.filename)
    const tmpPath = path.join(config.tmpDir, crypto.randomUUID())
    try {
      await pipeline(data.file, createWriteStream(tmpPath))
      if (data.file.truncated) {
        throw new PathError(`파일이 최대 크기(${config.maxUploadMb}MB)를 초과했습니다`, 413)
      }
      const size = (await fsp.stat(tmpPath)).size
      const finalName = await resolveCollision(absDir, name)
      const destRel = childPath(rel, finalName)
      await fsp.rename(tmpPath, path.join(absDir, finalName))
      setFileMeta(destRel, user.id)
      recordActivity('upload', destRel, user.id, { size })
      indexUpsert(destRel, { isDir: false, size, mtimeMs: Date.now() })
      const res: UploadResponse = { path: destRel, name: finalName }
      return res
    } catch (err) {
      await fsp.unlink(tmpPath).catch(() => {})
      throw err
    }
  })

  app.post('/api/fs/mkdir', async (req, reply) => {
    const user = req.user!
    const body = req.body as MkdirBody
    const rel = toRelPath(body?.path)
    const rules = loadAclRules()
    const absDir = await requireWritableDir(user, rel, rules, reply)
    if (!absDir) return

    const name = validateEntryName(body.name ?? '')
    const destRel = childPath(rel, name)
    const destAbs = path.join(absDir, name)
    if (await fsp.stat(destAbs).catch(() => null)) {
      return reply.code(409).send(errorBody('EXISTS', '같은 이름이 이미 있습니다'))
    }
    await fsp.mkdir(destAbs)
    recordActivity('mkdir', destRel, user.id)
    indexUpsert(destRel, { isDir: true, size: 0, mtimeMs: Date.now() })
    return { path: destRel }
  })

  app.patch('/api/fs/rename', async (req, reply) => {
    const user = req.user!
    const body = req.body as RenameBody
    const rel = toRelPath(body?.path)
    if (rel === '/') throw new PathError('루트는 변경할 수 없습니다')
    const rules = loadAclRules()
    if (resolvePermission(user, rel, rules) !== 'write') {
      return reply.code(403).send(errorBody('FORBIDDEN', '수정 권한이 없습니다'))
    }
    const abs = resolveAbs(config.storageRoot, rel)
    if (!(await fsp.stat(abs).catch(() => null))) {
      return reply.code(404).send(errorBody('NOT_FOUND', '존재하지 않는 경로입니다'))
    }
    const newName = validateEntryName(body.newName ?? '')
    const parentRel = parentOf(rel)
    const destRel = childPath(parentRel, newName)
    if (destRel === rel) return { path: rel }
    const destAbs = resolveAbs(config.storageRoot, destRel)
    if (await fsp.stat(destAbs).catch(() => null)) {
      return reply.code(409).send(errorBody('EXISTS', '같은 이름이 이미 있습니다'))
    }
    await fsp.rename(abs, destAbs)
    moveMetaPrefix(rel, destRel)
    indexMovePrefix(rel, destRel)
    recordActivity('rename', destRel, user.id, { from: rel })
    return { path: destRel }
  })

  /** move/copy 공통 골격 — 항목별 성공/실패를 모아 반환 */
  async function transferBatch(
    user: SessionUser,
    body: MoveBody | CopyBody,
    mode: 'move' | 'copy',
    reply: FastifyReply,
  ) {
    const rules = loadAclRules()
    const destRel = toRelPath(body?.destDir)
    const destAbs = await requireWritableDir(user, destRel, rules, reply)
    if (!destAbs) return

    const results: BatchResult[] = []
    for (const rawPath of body.paths ?? []) {
      try {
        const srcRel = toRelPath(rawPath)
        if (srcRel === '/') throw new PathError('루트는 이동할 수 없습니다')
        const perm = resolvePermission(user, srcRel, rules)
        const needed = mode === 'move' ? perm === 'write' : perm !== 'none'
        if (!needed) throw new PathError('권한이 없습니다', 403)
        if (destRel === srcRel || destRel.startsWith(srcRel + '/')) {
          throw new PathError('자기 자신 안으로는 옮길 수 없습니다', 400)
        }
        const srcAbs = resolveAbs(config.storageRoot, srcRel)
        const stat = await fsp.stat(srcAbs).catch(() => null)
        if (!stat) throw new PathError('존재하지 않는 경로입니다', 404)

        const name = path.basename(srcRel)
        if (destRel === parentOf(srcRel) && mode === 'move') {
          results.push({ path: srcRel, ok: true, newPath: srcRel }) // 제자리 이동 = no-op
          continue
        }
        // copy는 같은 폴더 복제를 허용하므로 충돌은 자동 회피
        const finalName =
          mode === 'copy'
            ? await resolveCollision(destAbs, name)
            : (await fsp.stat(path.join(destAbs, name)).catch(() => null))
              ? (() => {
                  throw new PathError('같은 이름이 이미 있습니다', 409)
                })()
              : name
        const newRel = childPath(destRel, finalName)
        const newAbs = path.join(destAbs, finalName)

        if (mode === 'move') {
          await fsp.rename(srcAbs, newAbs)
          moveMetaPrefix(srcRel, newRel)
          indexMovePrefix(srcRel, newRel)
          recordActivity('move', newRel, user.id, { from: srcRel })
        } else {
          await fsp.cp(srcAbs, newAbs, { recursive: true, errorOnExist: true, force: false })
          if (stat.isFile()) setFileMeta(newRel, user.id)
          recordActivity('copy', newRel, user.id, { from: srcRel })
          // 복사본 인덱싱 — 폴더 하위는 워처가 뒤따라 채운다
          const newStat = await fsp.stat(newAbs).catch(() => null)
          if (newStat) {
            indexUpsert(newRel, {
              isDir: newStat.isDirectory(),
              size: newStat.size,
              mtimeMs: newStat.mtimeMs,
            })
          }
        }
        results.push({ path: srcRel, ok: true, newPath: newRel })
      } catch (err) {
        results.push({
          path: rawPath,
          ok: false,
          error: err instanceof Error ? err.message : '실패했습니다',
        })
      }
    }
    const res: BatchResponse = { results }
    return res
  }

  app.post('/api/fs/move', async (req, reply) =>
    transferBatch(req.user!, req.body as MoveBody, 'move', reply),
  )
  app.post('/api/fs/copy', async (req, reply) =>
    transferBatch(req.user!, req.body as CopyBody, 'copy', reply),
  )

  /** 삭제 — 즉시 지우지 않고 .trash/{id}로 이동, 삭제자를 기록 */
  app.delete('/api/fs/trash', async (req) => {
    const user = req.user!
    const body = req.body as TrashBody
    const rules = loadAclRules()
    const results: BatchResult[] = []
    for (const rawPath of body?.paths ?? []) {
      try {
        const rel = toRelPath(rawPath)
        if (rel === '/') throw new PathError('루트는 삭제할 수 없습니다')
        if (resolvePermission(user, rel, rules) !== 'write') {
          throw new PathError('수정 권한이 없습니다', 403)
        }
        const abs = resolveAbs(config.storageRoot, rel)
        const stat = await fsp.stat(abs).catch(() => null)
        if (!stat) throw new PathError('존재하지 않는 경로입니다', 404)

        const id = crypto.randomUUID()
        await fsp.rename(abs, path.join(config.trashDir, id))
        db.insert(trash)
          .values({
            id,
            originalPath: rel,
            isDir: stat.isDirectory(),
            deletedBy: user.id,
            deletedAt: Date.now(),
          })
          .run()
        deleteMetaPrefix(rel)
        indexRemove(rel)
        recordActivity('trash', rel, user.id, { trashId: id })
        results.push({ path: rel, ok: true })
      } catch (err) {
        results.push({
          path: rawPath,
          ok: false,
          error: err instanceof Error ? err.message : '실패했습니다',
        })
      }
    }
    const res: BatchResponse = { results }
    return res
  })

  /** 내가 볼 수 있는 휴지통 — 내가 지운 것 + 원위치에 write 권한이 있는 것 */
  app.get('/api/trash', async (req) => {
    const user = req.user!
    const rules = loadAclRules()
    const rows = db
      .select({
        id: trash.id,
        originalPath: trash.originalPath,
        isDir: trash.isDir,
        deletedBy: trash.deletedBy,
        deletedAt: trash.deletedAt,
        deletedByName: users.username,
      })
      .from(trash)
      .leftJoin(users, eq(users.id, trash.deletedBy))
      .orderBy(desc(trash.deletedAt))
      .all()
    const items: TrashItem[] = rows
      .filter(
        (r) => r.deletedBy === user.id || resolvePermission(user, r.originalPath, rules) === 'write',
      )
      .map((r) => ({
        id: r.id,
        originalPath: r.originalPath,
        name: path.basename(r.originalPath),
        isDir: r.isDir,
        deletedByName: r.deletedByName ?? r.deletedBy,
        deletedAt: r.deletedAt,
      }))
    const res: TrashListResponse = { items }
    return res
  })

  app.post('/api/fs/restore', async (req) => {
    const user = req.user!
    const body = req.body as RestoreBody
    const ids = body?.trashIds ?? []
    const rules = loadAclRules()
    const rows = ids.length
      ? db.select().from(trash).where(inArray(trash.id, ids)).all()
      : []
    const byId = new Map(rows.map((r) => [r.id, r]))

    const results: BatchResult[] = []
    for (const id of ids) {
      const row = byId.get(id)
      try {
        if (!row) throw new PathError('휴지통에 없는 항목입니다', 404)
        const mayRestore =
          row.deletedBy === user.id ||
          resolvePermission(user, row.originalPath, rules) === 'write'
        if (!mayRestore) throw new PathError('복원 권한이 없습니다', 403)

        const parentRel = parentOf(row.originalPath)
        const parentAbs = resolveAbs(config.storageRoot, parentRel)
        await fsp.mkdir(parentAbs, { recursive: true })
        const finalName = await resolveRestoreName(parentAbs, path.basename(row.originalPath))
        const destRel = childPath(parentRel, finalName)
        const destAbs = resolveAbs(config.storageRoot, destRel)
        await fsp.rename(path.join(config.trashDir, id), destAbs)
        db.delete(trash).where(eq(trash.id, id)).run()
        recordActivity('restore', destRel, user.id, { trashId: id, originalPath: row.originalPath })
        // 복원 항목 인덱싱 — 폴더 하위는 워처가 뒤따라 채운다
        const restoredStat = await fsp.stat(destAbs).catch(() => null)
        if (restoredStat) {
          indexUpsert(destRel, {
            isDir: restoredStat.isDirectory(),
            size: restoredStat.size,
            mtimeMs: restoredStat.mtimeMs,
          })
        }
        results.push({ path: row.originalPath, ok: true, newPath: destRel })
      } catch (err) {
        results.push({
          path: row?.originalPath ?? id,
          ok: false,
          error: err instanceof Error ? err.message : '실패했습니다',
        })
      }
    }
    const res: BatchResponse = { results }
    return res
  })
}
