import type { FastifyInstance } from 'fastify'
import { desc, eq } from 'drizzle-orm'
import type {
  ActivityItem,
  ActivityResponse,
  FsEntry,
  RecentResponse,
  SearchResponse,
} from '@fs/shared'
import { resolvePermission, type AclRule } from '../acl/resolve'
import { loadAclRules } from '../acl/store'
import { db } from '../db'
import { activityLog, users } from '../db/schema'
import { recentFiles, searchIndex, type IndexRow } from '../fs/indexer'
import { uploaderNamesFor } from '../fs/meta'
import { toRelPath } from '../fs/safe-path'
import type { SessionUser } from '../auth/session'

/** 인덱스 행 → 권한 필터 + FsEntry 변환 (none은 결과에서 제외) */
function toEntries(user: SessionUser, rows: IndexRow[], rules: AclRule[], cap: number): FsEntry[] {
  const entries: FsEntry[] = []
  for (const r of rows) {
    const perm = resolvePermission(user, r.path, rules)
    if (perm === 'none') continue
    entries.push({
      name: r.name,
      path: r.path,
      isDir: r.isDir,
      size: r.size,
      mtime: r.mtime,
      permission: perm,
      uploader: null,
    })
    if (entries.length >= cap) break
  }
  const uploaders = uploaderNamesFor(entries.filter((e) => !e.isDir).map((e) => e.path))
  for (const e of entries) e.uploader = uploaders.get(e.path) ?? null
  return entries
}

export default async function metaRoutes(app: FastifyInstance) {
  /** 파일명 검색 — fs_index LIKE 스캔 + 권한 필터 */
  app.get('/api/search', async (req) => {
    const user = req.user!
    const q = ((req.query as { q?: string }).q ?? '').trim()
    if (q.length < 1) {
      const empty: SearchResponse = { query: q, entries: [], truncated: false }
      return empty
    }
    const rules = loadAclRules()
    const CAP = 50
    // 권한 필터로 걸러질 것을 감안해 넉넉히 뽑는다
    const rows = searchIndex(q, 500)
    const entries = toEntries(user, rows, rules, CAP)
    const res: SearchResponse = {
      query: q,
      entries,
      truncated: rows.length >= 500 || entries.length >= CAP,
    }
    return res
  })

  /** 최근 수정 파일 — DB 로그 기준이 아니라 실제 mtime 기준 */
  app.get('/api/recent', async (req) => {
    const user = req.user!
    const limitRaw = Number((req.query as { limit?: string }).limit ?? 30)
    const limit = Math.min(Math.max(1, limitRaw || 30), 100)
    const rules = loadAclRules()
    const rows = recentFiles(limit * 5)
    const res: RecentResponse = { entries: toEntries(user, rows, rules, limit) }
    return res
  })

  /** 파일 생애주기 타임라인 — 정보 패널용 */
  app.get('/api/activity', async (req, reply) => {
    const user = req.user!
    const rel = toRelPath((req.query as { path?: string }).path)
    const rules = loadAclRules()
    if (resolvePermission(user, rel, rules) === 'none') {
      return reply.code(403).send({ error: { code: 'FORBIDDEN', message: '접근 권한이 없습니다' } })
    }
    const limitRaw = Number((req.query as { limit?: string }).limit ?? 20)
    const limit = Math.min(Math.max(1, limitRaw || 20), 100)
    const rows = db
      .select({
        id: activityLog.id,
        action: activityLog.action,
        detailJson: activityLog.detailJson,
        createdAt: activityLog.createdAt,
        actorId: activityLog.actorId,
        actorName: users.username,
      })
      .from(activityLog)
      .leftJoin(users, eq(users.id, activityLog.actorId))
      .where(eq(activityLog.path, rel))
      .orderBy(desc(activityLog.createdAt))
      .limit(limit)
      .all()
    const items: ActivityItem[] = rows.map((r) => ({
      id: r.id,
      action: r.action,
      actorName: r.actorName ?? r.actorId,
      createdAt: r.createdAt,
      detail: r.detailJson ? (JSON.parse(r.detailJson) as Record<string, unknown>) : null,
    }))
    const res: ActivityResponse = { path: rel, items }
    return res
  })
}
