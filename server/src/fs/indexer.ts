import fsp from 'node:fs/promises'
import path from 'node:path'
import { config } from '../config'
import { sqlite } from '../db'
import { contentEnqueue, contentMove, contentReconcile, contentRemove } from './content-index'

/**
 * fs_index — 검색·최근 파일 전용 인덱스. 탐색(목록)의 진실의 원천은 여전히
 * 라이브 readdir이고, 이 테이블은 그 상태를 뒤따라간다.
 * 갱신 경로: ① 쓰기 라우트에서 직접 호출(즉시), ② chokidar(외부 변경), ③ 기동 시 전체 스캔.
 *
 * 검색은 name_search(NFC·소문자) LIKE 스캔. 10~20인 NAS 규모(수만 파일)에서는
 * FTS5 동기화 복잡도보다 단순 스캔이 낫다 — 코퍼스가 커지면 FTS5 trigram으로 교체.
 */

function nameSearchKey(name: string): string {
  return name.normalize('NFC').toLowerCase()
}

function parentOf(rel: string): string {
  const segs = rel.split('/').filter(Boolean)
  return '/' + segs.slice(0, -1).join('/')
}

export function likeEscape(s: string): string {
  return s.replace(/[\\%_]/g, (c) => '\\' + c)
}

const upsertStmt = () =>
  sqlite.prepare(`
    INSERT INTO fs_index (path, name, name_search, parent, is_dir, size, mtime, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(path) DO UPDATE SET
      name = excluded.name, name_search = excluded.name_search, parent = excluded.parent,
      is_dir = excluded.is_dir, size = excluded.size, mtime = excluded.mtime,
      updated_at = excluded.updated_at
  `)

export function indexUpsert(relPath: string, stat: { isDir: boolean; size: number; mtimeMs: number }): void {
  const name = path.posix.basename(relPath)
  upsertStmt().run(
    relPath,
    name,
    nameSearchKey(name),
    parentOf(relPath),
    stat.isDir ? 1 : 0,
    stat.isDir ? 0 : stat.size,
    Math.round(stat.mtimeMs),
    Date.now(),
  )
  if (!stat.isDir) contentEnqueue(relPath, stat.mtimeMs)
}

/** 항목 자신 + (폴더면) 하위 전부 제거 */
export function indexRemove(relPath: string): void {
  sqlite
    .prepare(`DELETE FROM fs_index WHERE path = ? OR path LIKE ? ESCAPE '\\'`)
    .run(relPath, likeEscape(relPath) + '/%')
  contentRemove(relPath)
}

/** rename/move — 경로 키·parent 일괄 이전 */
export function indexMovePrefix(from: string, to: string): void {
  const toName = path.posix.basename(to)
  sqlite
    .prepare(
      `UPDATE fs_index SET path = ? || substr(path, ?), name = ?, name_search = ?, parent = ?
       WHERE path = ?`,
    )
    .run(to, from.length + 1, toName, nameSearchKey(toName), parentOf(to), from)
  // 하위 항목은 path/parent만 바뀐다
  sqlite
    .prepare(
      `UPDATE fs_index SET path = ? || substr(path, ?), parent = ? || substr(parent, ?)
       WHERE path LIKE ? ESCAPE '\\'`,
    )
    .run(to, from.length + 1, to, from.length + 1, likeEscape(from) + '/%')
  contentMove(from, to)
}

/** 기동 시 전체 재구축 — 스토리지를 걸어 실제 상태로 맞춘다 */
export async function fullScan(): Promise<number> {
  const rows: Array<{ rel: string; isDir: boolean; size: number; mtimeMs: number }> = []

  async function walk(absDir: string, relDir: string): Promise<void> {
    const dirents = await fsp.readdir(absDir, { withFileTypes: true }).catch(() => [])
    for (const d of dirents) {
      if (d.name.startsWith('.')) continue
      const rel = relDir === '/' ? `/${d.name}` : `${relDir}/${d.name}`
      const abs = path.join(absDir, d.name)
      const stat = await fsp.stat(abs).catch(() => null)
      if (!stat) continue
      rows.push({ rel, isDir: stat.isDirectory(), size: stat.size, mtimeMs: stat.mtimeMs })
      if (stat.isDirectory()) await walk(abs, rel)
    }
  }

  await walk(config.storageRoot, '/')

  const tx = sqlite.transaction(() => {
    sqlite.prepare('DELETE FROM fs_index').run()
    for (const r of rows) {
      indexUpsert(r.rel, { isDir: r.isDir, size: r.size, mtimeMs: r.mtimeMs })
    }
  })
  tx()
  contentReconcile()
  return rows.length
}

export interface IndexRow {
  path: string
  name: string
  isDir: boolean
  size: number
  mtime: number
}

function toRow(r: Record<string, unknown>): IndexRow {
  return {
    path: r.path as string,
    name: r.name as string,
    isDir: !!(r.is_dir as number),
    size: r.size as number,
    mtime: r.mtime as number,
  }
}

/** 파일명 부분 일치 검색 (대소문자·NFC 무시). limit+1개를 돌려 truncation 판단은 호출부에서 */
export function searchIndex(query: string, limit: number): IndexRow[] {
  const q = likeEscape(nameSearchKey(query.trim()))
  if (!q) return []
  return sqlite
    .prepare(
      `SELECT path, name, is_dir, size, mtime FROM fs_index
       WHERE name_search LIKE ? ESCAPE '\\'
       ORDER BY is_dir DESC, mtime DESC LIMIT ?`,
    )
    .all(`%${q}%`, limit)
    .map((r) => toRow(r as Record<string, unknown>))
}

/** 단일 경로 조회 — 내용 검색 결과에 크기·mtime을 붙일 때 사용 */
export function indexGet(relPath: string): IndexRow | null {
  const r = sqlite
    .prepare('SELECT path, name, is_dir, size, mtime FROM fs_index WHERE path = ?')
    .get(relPath)
  return r ? toRow(r as Record<string, unknown>) : null
}

/** 최근 수정 파일 (폴더 제외) */
export function recentFiles(limit: number): IndexRow[] {
  return sqlite
    .prepare(`SELECT path, name, is_dir, size, mtime FROM fs_index WHERE is_dir = 0 ORDER BY mtime DESC LIMIT ?`)
    .all(limit)
    .map((r) => toRow(r as Record<string, unknown>))
}
