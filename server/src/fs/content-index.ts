import fsp from 'node:fs/promises'
import { config } from '../config'
import { sqlite } from '../db'
import { extractableKind, extractFileText } from './extract'
import { resolveAbs } from './safe-path'

/**
 * 문서 내용 검색 인덱스 (R4) — fs_index를 뒤따르는 2차 인덱스.
 *
 * content_index: 파일별 추출 상태(mtime 비교로 재추출 판단)
 * content_fts:   FTS5 trigram — 한글 포함 3글자 이상 부분 일치. 2글자는 LIKE 폴백.
 *
 * 갱신 경로는 fs_index와 동일하게 indexer 훅(indexUpsert/Remove/MovePrefix)에서
 * 들어오고, 추출 자체는 인메모리 큐에서 한 건씩 백그라운드로 처리한다 —
 * 업로드/스캔 경로를 추출 비용으로 막지 않기 위함.
 */

let available = false
try {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS content_index (
      path TEXT PRIMARY KEY,
      mtime INTEGER NOT NULL,
      size INTEGER NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('ok','skipped','error')),
      indexed_at INTEGER NOT NULL,
      error TEXT
    );
    CREATE VIRTUAL TABLE IF NOT EXISTS content_fts USING fts5(path UNINDEXED, content, tokenize='trigram');
  `)
  available = true
} catch {
  // trigram 미지원 구형 SQLite — 내용 검색만 조용히 꺼지고 파일명 검색은 유지
}

export function contentSearchEnabled(): boolean {
  return available && !config.indexDisabled && !config.contentSearchDisabled
}

function likeEscape(s: string): string {
  return s.replace(/[\\%_]/g, (c) => '\\' + c)
}

// ─── 백그라운드 추출 큐 ─────────────────────────────────────

const queue: string[] = []
const queued = new Set<string>()
let pumping = false
let idleResolvers: Array<() => void> = []

/** 큐가 빌 때까지 대기 — 테스트·진단용 */
export function contentQueueDrained(): Promise<void> {
  if (!pumping && queue.length === 0) return Promise.resolve()
  return new Promise((r) => idleResolvers.push(r))
}

/** 추출 후보 등록. mtime이 기존 기록과 같으면 아무것도 안 한다 */
export function contentEnqueue(relPath: string, mtimeMs: number): void {
  if (!contentSearchEnabled()) return
  if (!extractableKind(relPath)) return
  const row = sqlite.prepare('SELECT mtime FROM content_index WHERE path = ?').get(relPath) as
    | { mtime: number }
    | undefined
  if (row && row.mtime === Math.round(mtimeMs)) return
  if (queued.has(relPath)) return
  queued.add(relPath)
  queue.push(relPath)
  void pump()
}

async function pump(): Promise<void> {
  if (pumping) return
  pumping = true
  try {
    let rel: string | undefined
    while ((rel = queue.shift()) !== undefined) {
      queued.delete(rel)
      await processOne(rel).catch(() => {})
      // 이벤트 루프 양보 — 대량 백필 중에도 요청 처리가 굶지 않게
      await new Promise((r) => setImmediate(r))
    }
  } finally {
    pumping = false
    const resolvers = idleResolvers
    idleResolvers = []
    for (const r of resolvers) r()
  }
}

function writeRows(relPath: string, mtime: number, size: number, text: string | null, status: 'ok' | 'skipped' | 'error', error: string | null): void {
  const tx = sqlite.transaction(() => {
    sqlite.prepare('DELETE FROM content_fts WHERE path = ?').run(relPath)
    if (text) sqlite.prepare('INSERT INTO content_fts (path, content) VALUES (?, ?)').run(relPath, text)
    sqlite
      .prepare(
        `INSERT INTO content_index (path, mtime, size, status, indexed_at, error)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(path) DO UPDATE SET
           mtime = excluded.mtime, size = excluded.size, status = excluded.status,
           indexed_at = excluded.indexed_at, error = excluded.error`,
      )
      .run(relPath, mtime, size, status, Date.now(), error)
  })
  tx()
}

async function processOne(relPath: string): Promise<void> {
  const kind = extractableKind(relPath)
  if (!kind) return
  let abs: string
  try {
    abs = resolveAbs(config.storageRoot, relPath)
  } catch {
    contentRemove(relPath)
    return
  }
  const stat = await fsp.stat(abs).catch(() => null)
  if (!stat || stat.isDirectory()) {
    contentRemove(relPath)
    return
  }
  const mtime = Math.round(stat.mtimeMs)
  if (stat.size > config.contentMaxMb * 1024 * 1024) {
    writeRows(relPath, mtime, stat.size, null, 'skipped', null)
    return
  }
  try {
    const text = await extractFileText(abs, kind)
    writeRows(relPath, mtime, stat.size, text || null, 'ok', null)
  } catch (err) {
    writeRows(relPath, mtime, stat.size, null, 'error', err instanceof Error ? err.message : String(err))
  }
}

// ─── fs_index 훅 대응 ───────────────────────────────────────

/** 항목 자신 + (폴더면) 하위 전부 제거 */
export function contentRemove(relPath: string): void {
  if (!available) return
  const prefix = likeEscape(relPath) + '/%'
  sqlite.prepare(`DELETE FROM content_index WHERE path = ? OR path LIKE ? ESCAPE '\\'`).run(relPath, prefix)
  sqlite.prepare(`DELETE FROM content_fts WHERE path = ? OR path LIKE ? ESCAPE '\\'`).run(relPath, prefix)
}

/** rename/move — 경로 키 일괄 이전 (내용은 그대로라 재추출 불필요) */
export function contentMove(from: string, to: string): void {
  if (!available) return
  for (const tbl of ['content_index', 'content_fts']) {
    sqlite.prepare(`UPDATE ${tbl} SET path = ? WHERE path = ?`).run(to, from)
    sqlite
      .prepare(`UPDATE ${tbl} SET path = ? || substr(path, ?) WHERE path LIKE ? ESCAPE '\\'`)
      .run(to, from.length + 1, likeEscape(from) + '/%')
  }
}

/** fullScan 후 고아 정리 — fs_index에 없는 내용 인덱스 삭제 */
export function contentReconcile(): void {
  if (!available) return
  sqlite.prepare(`DELETE FROM content_index WHERE path NOT IN (SELECT path FROM fs_index WHERE is_dir = 0)`).run()
  sqlite.prepare(`DELETE FROM content_fts WHERE path NOT IN (SELECT path FROM fs_index WHERE is_dir = 0)`).run()
}

/** 스토리지 루트 변경 시 전체 무효화 (fs_index 초기화와 짝) */
export function contentWipe(): void {
  if (!available) return
  sqlite.prepare('DELETE FROM content_index').run()
  sqlite.prepare('DELETE FROM content_fts').run()
}

/** 캐시된 추출 본문 (없으면 null) — 미리보기가 재추출을 피하려고 먼저 조회 */
export function cachedContent(relPath: string): string | null {
  if (!available) return null
  const row = sqlite.prepare('SELECT content FROM content_fts WHERE path = ?').get(relPath) as
    | { content: string }
    | undefined
  return row?.content ?? null
}

// ─── 관리(admin) ────────────────────────────────────────────

/** 상태별 카운트 + 큐 대기 건수 */
export function contentStats(): { counts: { ok: number; skipped: number; error: number }; pending: number } {
  const counts = { ok: 0, skipped: 0, error: 0 }
  if (available) {
    const rows = sqlite
      .prepare(`SELECT status, COUNT(*) AS c FROM content_index GROUP BY status`)
      .all() as Array<{ status: 'ok' | 'skipped' | 'error'; c: number }>
    for (const r of rows) counts[r.status] = r.c
  }
  return { counts, pending: queue.length + (pumping ? 1 : 0) }
}

/** 추출 실패 목록 (최근 순) */
export function contentErrors(limit = 50): Array<{ path: string; error: string | null; indexedAt: number }> {
  if (!available) return []
  return sqlite
    .prepare(
      `SELECT path, error, indexed_at AS indexedAt FROM content_index
       WHERE status = 'error' ORDER BY indexed_at DESC LIMIT ?`,
    )
    .all(limit) as Array<{ path: string; error: string | null; indexedAt: number }>
}

/** error 상태 전부 재추출 큐에 등록. 등록한 건수 반환 */
export function contentRetryErrors(): number {
  if (!contentSearchEnabled()) return 0
  const rows = sqlite
    .prepare(`SELECT path FROM content_index WHERE status = 'error'`)
    .all() as Array<{ path: string }>
  for (const r of rows) {
    // 상태 행을 지워 mtime-같음 스킵을 무효화한 뒤 재등록
    sqlite.prepare(`DELETE FROM content_index WHERE path = ?`).run(r.path)
    contentEnqueue(r.path, 0)
  }
  return rows.length
}

// ─── 검색 ───────────────────────────────────────────────────

export interface ContentHit {
  path: string
  /** 일치 부분 주변 발췌 (마킹 없음 — 하이라이트는 클라이언트가 질의어로 수행) */
  snippet: string
}

function makeSnippet(content: string, q: string): string {
  const i = content.toLowerCase().indexOf(q.toLowerCase())
  if (i < 0) return content.slice(0, 80).replace(/\n/g, ' ')
  const start = Math.max(0, i - 40)
  const end = Math.min(content.length, i + q.length + 40)
  return (
    (start > 0 ? '…' : '') +
    content.slice(start, end).replace(/\n/g, ' ') +
    (end < content.length ? '…' : '')
  )
}

/**
 * 내용 검색. 3글자 이상은 trigram MATCH(부분 일치), 2글자는 LIKE 폴백.
 * 권한 필터는 호출부(meta 라우트) 책임.
 */
export function searchContent(query: string, limit: number): ContentHit[] {
  if (!contentSearchEnabled()) return []
  const q = query.trim().normalize('NFC')
  const chars = [...q].length
  if (chars < 2) return []
  if (chars >= 3) {
    const match = '"' + q.replaceAll('"', '""') + '"'
    const rows = sqlite
      .prepare(
        `SELECT path, snippet(content_fts, 1, '', '', '…', 60) AS snippet
         FROM content_fts WHERE content_fts MATCH ? ORDER BY rank LIMIT ?`,
      )
      .all(match, limit) as ContentHit[]
    return rows.map((r) => ({ ...r, snippet: r.snippet.replace(/\s+/g, ' ') }))
  }
  // 2글자: trigram 인덱스를 못 타는 대신 소규모 코퍼스 전제의 순차 LIKE
  const rows = sqlite
    .prepare(`SELECT path, content FROM content_fts WHERE content LIKE ? ESCAPE '\\' LIMIT ?`)
    .all('%' + likeEscape(q) + '%', limit) as Array<{ path: string; content: string }>
  return rows.map((r) => ({ path: r.path, snippet: makeSnippet(r.content, q) }))
}
