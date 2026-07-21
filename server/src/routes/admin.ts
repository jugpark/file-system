import fsp from 'node:fs/promises'
import type { FastifyInstance } from 'fastify'
import { and, desc, eq } from 'drizzle-orm'
import path from 'node:path'
import { inArray } from 'drizzle-orm'
import type {
  AclRuleDto,
  AdminActivityResponse,
  BackupStatusResponse,
  ContentIndexStatusResponse,
  PurgeTrashBody,
  PurgeTrashResponse,
  RoleDto,
  SettingsResponse,
  UpdateSettingsBody,
  UsageResponse,
} from '@fs/shared'
import { config } from '../config'
import { db, sqlite } from '../db'
import { activityLog, folderAcl, trash, users } from '../db/schema'
import {
  contentErrors,
  contentRetryErrors,
  contentSearchEnabled,
  contentStats,
} from '../fs/content-index'
import { fullScan } from '../fs/indexer'
import { recordActivity } from '../fs/meta'
import { toRelPath } from '../fs/safe-path'
import { registerAdminAccessRoutes } from './access'
import { saveStorageRoot } from '../settings'
import { errorBody } from '../types'
import { restartWatcher } from '../watcher'

/** 스토리지 볼륨 총/여유 바이트 */
export async function diskUsage(): Promise<{ totalBytes: number; freeBytes: number }> {
  const s = await fsp.statfs(config.storageRoot)
  return { totalBytes: s.bsize * s.blocks, freeBytes: s.bsize * s.bavail }
}

export default async function adminRoutes(app: FastifyInstance) {
  // 사이드바 디스크 게이지용 — 전 유저
  app.get('/api/usage', async (): Promise<UsageResponse> => diskUsage())

  // ── 이하 admin 전용 ──
  app.addHook('onRequest', async (req, reply) => {
    if (!req.raw.url?.startsWith('/api/admin/')) return
    if (!req.user?.isAdmin) {
      return reply.code(403).send(errorBody('ADMIN_ONLY', '관리자만 사용할 수 있습니다'))
    }
  })

  // ── 서버 설정: 스토리지 루트 ──
  app.get('/api/admin/settings', async (): Promise<SettingsResponse> => ({
    storageRoot: config.storageRoot,
    indexDisabled: config.indexDisabled,
  }))

  app.put('/api/admin/settings', async (req, reply) => {
    const user = req.user!
    const body = req.body as UpdateSettingsBody
    const requested = (body?.storageRoot ?? '').trim()
    if (!requested) {
      return reply.code(400).send(errorBody('BAD_INPUT', 'storageRoot가 필요합니다'))
    }
    const before = config.storageRoot
    try {
      saveStorageRoot(requested)
    } catch (err) {
      return reply
        .code(400)
        .send(errorBody('BAD_ROOT', err instanceof Error ? err.message : '적용할 수 없는 경로입니다'))
    }
    recordActivity('settings_change', '/', user.id, { key: 'storageRoot', from: before, to: config.storageRoot })
    req.log.warn(`스토리지 루트 변경: ${before} → ${config.storageRoot} (by ${user.username})`)
    if (!config.indexDisabled) {
      // 새 루트 기준 재색인 — 응답을 막지 않게 백그라운드로
      fullScan()
        .then((n) => req.log.info(`재색인 완료 — ${n}개 항목`))
        .catch((err) => req.log.warn({ err }, '재색인 실패'))
      restartWatcher(req.log).catch((err) => req.log.warn({ err }, '워처 재시작 실패'))
    }
    const res: SettingsResponse = { storageRoot: config.storageRoot, indexDisabled: config.indexDisabled }
    return res
  })

  app.get('/api/admin/acl', async () => {
    const rows = db.select().from(folderAcl).all()
    const rules: AclRuleDto[] = rows.map((r) => ({
      id: r.id,
      pathPrefix: r.pathPrefix,
      roleId: r.roleId,
      permission: r.permission,
      note: r.note,
    }))
    return { rules }
  })

  app.post('/api/admin/acl', async (req, reply) => {
    const user = req.user!
    const body = req.body as { pathPrefix?: string; roleId?: string; permission?: string; note?: string }
    const prefix = toRelPath(body?.pathPrefix)
    const roleId = (body?.roleId ?? '').trim()
    const permission = body?.permission
    if (prefix === '/' || prefix.startsWith('/home')) {
      return reply.code(400).send(errorBody('BAD_PREFIX', '루트/개인 공간에는 규칙을 걸 수 없습니다'))
    }
    if (!roleId || (permission !== 'read' && permission !== 'write')) {
      return reply.code(400).send(errorBody('BAD_INPUT', 'roleId와 permission(read|write)이 필요합니다'))
    }
    const dup = db
      .select()
      .from(folderAcl)
      .where(and(eq(folderAcl.pathPrefix, prefix), eq(folderAcl.roleId, roleId)))
      .get()
    if (dup) return reply.code(409).send(errorBody('EXISTS', '같은 폴더·role 규칙이 이미 있습니다'))
    db.insert(folderAcl)
      .values({ pathPrefix: prefix, roleId, permission, note: body?.note?.trim() || null })
      .run()
    recordActivity('acl_change', prefix, user.id, { op: 'add', roleId, permission })
    return reply.code(201).send({ ok: true })
  })

  app.delete('/api/admin/acl/:id', async (req, reply) => {
    const user = req.user!
    const id = Number((req.params as { id: string }).id)
    const row = db.select().from(folderAcl).where(eq(folderAcl.id, id)).get()
    if (!row) return reply.code(404).send(errorBody('NOT_FOUND', '존재하지 않는 규칙입니다'))
    db.delete(folderAcl).where(eq(folderAcl.id, id)).run()
    recordActivity('acl_change', row.pathPrefix, user.id, {
      op: 'remove',
      roleId: row.roleId,
      permission: row.permission,
    })
    return reply.code(204).send()
  })

  /** 규칙 편집용 Discord role 목록 (dev auth에서는 시드 role 반환) */
  app.get('/api/admin/roles', async (req, reply) => {
    if (config.devAuth) {
      const roles: RoleDto[] = [
        ...config.devUser.roles.map((r) => ({ id: r, name: `${r} (dev)` })),
        { id: 'ops', name: 'ops (dev)' },
      ]
      return { roles }
    }
    const res = await fetch(
      `https://discord.com/api/v10/guilds/${config.discord.guildId}/roles`,
      { headers: { authorization: `Bot ${config.discord.botToken}` } },
    )
    if (!res.ok) {
      req.log.warn(`Discord roles fetch failed: ${res.status}`)
      return reply.code(502).send(errorBody('DISCORD_ERROR', 'Discord role 조회에 실패했습니다'))
    }
    const raw = (await res.json()) as Array<{ id: string; name: string; managed: boolean }>
    const roles: RoleDto[] = raw
      .filter((r) => r.name !== '@everyone' && !r.managed)
      .map((r) => ({ id: r.id, name: r.name }))
    return { roles }
  })

  /** 사용량 — 디스크 + 최상위 폴더별 파일 합계 (fs_index 롤업, 스캔 불필요) */
  app.get('/api/admin/usage', async (): Promise<UsageResponse> => {
    const disk = await diskUsage()
    const rows = sqlite
      .prepare(
        `SELECT '/' || substr(path, 2, CASE WHEN instr(substr(path, 2), '/') = 0
           THEN length(path) ELSE instr(substr(path, 2), '/') - 1 END) AS top,
           SUM(size) AS bytes
         FROM fs_index WHERE is_dir = 0 GROUP BY top ORDER BY bytes DESC LIMIT 20`,
      )
      .all() as Array<{ top: string; bytes: number }>
    return { ...disk, folders: rows.map((r) => ({ path: r.top, bytes: r.bytes })) }
  })

  // 접근 요청 처리 큐 (admin 전용) — 라우트 정의는 access.ts에 위임
  registerAdminAccessRoutes(app)

  /** 백업 상태 — backup.sh가 남긴 마지막 실행 결과 파일 */
  app.get('/api/admin/backup-status', async (): Promise<BackupStatusResponse> => {
    try {
      const raw = await fsp.readFile(config.backupStatusPath, 'utf8')
      const j = JSON.parse(raw) as Partial<BackupStatusResponse>
      return {
        known: true,
        ok: !!j.ok,
        at: typeof j.at === 'number' ? j.at : undefined,
        size: typeof j.size === 'string' ? j.size : undefined,
        dest: typeof j.dest === 'string' ? j.dest : undefined,
        error: typeof j.error === 'string' ? j.error : undefined,
      }
    } catch {
      return { known: false }
    }
  })

  /** 내용 검색 인덱스 상태 — 카운트/큐/실패 목록 */
  app.get('/api/admin/content-index', async (): Promise<ContentIndexStatusResponse> => {
    const stats = contentStats()
    return { enabled: contentSearchEnabled(), ...stats, errors: contentErrors() }
  })

  /** 추출 실패 전부 재시도 */
  app.post('/api/admin/content-index/retry', async () => {
    return { retried: contentRetryErrors() }
  })

  /** 휴지통 영구 삭제 — ids 없으면 전체 비우기 */
  app.post('/api/admin/trash/purge', async (req) => {
    const user = req.user!
    const ids = (req.body as PurgeTrashBody | undefined)?.ids
    const rows = ids?.length
      ? db.select().from(trash).where(inArray(trash.id, ids)).all()
      : db.select().from(trash).all()
    let purged = 0
    for (const row of rows) {
      try {
        await fsp.rm(path.join(config.trashDir, row.id), { recursive: true, force: true })
        db.delete(trash).where(eq(trash.id, row.id)).run()
        recordActivity('trash_purge', row.originalPath, user.id, { trashId: row.id })
        purged++
      } catch (err) {
        req.log.warn({ err, id: row.id }, '휴지통 영구 삭제 실패 — 다음 항목 계속')
      }
    }
    const res: PurgeTrashResponse = { purged }
    return res
  })

  /** 감사 로그 — 전체 활동 스트림 */
  app.get('/api/admin/activity', async (req) => {
    const q = req.query as { limit?: string; action?: string; userId?: string }
    const limit = Math.min(Math.max(1, Number(q.limit) || 100), 500)
    const conds = []
    if (q.action) conds.push(eq(activityLog.action, q.action as never))
    if (q.userId) conds.push(eq(activityLog.actorId, q.userId))
    const base = db
      .select({
        id: activityLog.id,
        path: activityLog.path,
        action: activityLog.action,
        detailJson: activityLog.detailJson,
        createdAt: activityLog.createdAt,
        actorId: activityLog.actorId,
        actorName: users.username,
      })
      .from(activityLog)
      .leftJoin(users, eq(users.id, activityLog.actorId))
    const rows = (conds.length ? base.where(and(...conds)) : base)
      .orderBy(desc(activityLog.createdAt))
      .limit(limit)
      .all()
    const res: AdminActivityResponse = {
      items: rows.map((r) => ({
        id: r.id,
        path: r.path,
        action: r.action,
        actorName: r.actorName ?? r.actorId,
        createdAt: r.createdAt,
        detail: r.detailJson ? (JSON.parse(r.detailJson) as Record<string, unknown>) : null,
      })),
    }
    return res
  })
}
