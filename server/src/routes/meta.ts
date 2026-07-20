import type { FastifyInstance } from 'fastify'
import { desc, eq } from 'drizzle-orm'
import type {
  ActivityItem,
  ActivityResponse,
  ContentMatch,
  FsEntry,
  RecentResponse,
  SearchResponse,
  UsersResponse,
} from '@fs/shared'
import { resolvePermission, type AclRule } from '../acl/resolve'
import { loadAclRules } from '../acl/store'
import { db } from '../db'
import { activityLog, users } from '../db/schema'
import { contentSearchEnabled, searchContent } from '../fs/content-index'
import { indexGet, recentFiles, searchIndex, type IndexRow } from '../fs/indexer'
import { parseSearchFilters, passesFilters } from '../fs/search-filters'
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
  /** 검색 필터의 업로더 선택용 — 로그인한 적 있는 유저 전부 (소규모 조직 전제) */
  app.get('/api/users', async (): Promise<UsersResponse> => {
    const rows = db.select({ id: users.id, username: users.username }).from(users).all()
    rows.sort((a, b) => a.username.localeCompare(b.username, 'ko'))
    return { users: rows }
  })

  /** 파일명 + 문서 내용 검색 — fs_index LIKE 스캔 / content_fts + 권한·조건 필터 */
  app.get('/api/search', async (req) => {
    const user = req.user!
    const query = req.query as {
      q?: string
      from?: string
      ext?: string
      days?: string
      uploader?: string
    }
    const q = (query.q ?? '').trim()
    const contentEnabled = contentSearchEnabled()
    if (q.length < 1) {
      const empty: SearchResponse = {
        query: q, entries: [], truncated: false,
        content: [], contentTruncated: false, contentEnabled,
      }
      return empty
    }
    const rules = loadAclRules()
    const filters = parseSearchFilters(query)
    const CAP = 50
    // 권한 필터로 걸러질 것을 감안해 넉넉히 뽑는다
    const rows = searchIndex(q, 500).filter((r) => passesFilters(filters, r))
    const entries = toEntries(user, rows, rules, CAP)

    // 내용 일치 — 히트를 fs_index와 조인해 FsEntry 형태로, 권한 필터 후 CAP
    const CONTENT_CAP = 30
    const hits = searchContent(q, 300)
    const content: ContentMatch[] = []
    for (const h of hits) {
      if (content.length >= CONTENT_CAP) break
      const row = indexGet(h.path)
      if (!row || row.isDir) continue
      if (!passesFilters(filters, row)) continue
      const perm = resolvePermission(user, h.path, rules)
      if (perm === 'none') continue
      content.push({
        entry: {
          name: row.name, path: row.path, isDir: false, size: row.size,
          mtime: row.mtime, permission: perm, uploader: null,
        },
        snippet: h.snippet,
      })
    }
    const uploaders = uploaderNamesFor(content.map((c) => c.entry.path))
    for (const c of content) c.entry.uploader = uploaders.get(c.entry.path) ?? null

    const res: SearchResponse = {
      query: q,
      entries,
      truncated: rows.length >= 500 || entries.length >= CAP,
      content,
      contentTruncated: hits.length >= 300 || content.length >= CONTENT_CAP,
      contentEnabled,
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
