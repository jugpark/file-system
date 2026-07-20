import { eq } from 'drizzle-orm'
import { db } from '../db'
import { fileMeta } from '../db/schema'
import type { IndexRow } from './indexer'
import { toRelPath } from './safe-path'

/**
 * 검색 필터 — 파일명·내용 두 섹션에 공통 적용하기 위해 SQL이 아니라
 * 행 단위 술어로 거른다 (후보 500/300건 규모라 비용 무시 가능).
 */
export interface SearchFilters {
  /** 이 폴더 아래만 (null=전체) */
  scope: string | null
  /** 소문자 확장자 집합 (null=전체). 지정 시 폴더는 제외 */
  exts: Set<string> | null
  /** 이 시각 이후 수정분만 */
  sinceMs: number | null
  /** 이 업로더의 파일 경로 집합 (null=전체) */
  uploaderPaths: Set<string> | null
}

export function parseSearchFilters(
  q: { from?: string; ext?: string; days?: string; uploader?: string },
  now = Date.now(),
): SearchFilters {
  let scope: string | null = null
  try {
    const s = toRelPath(q.from)
    scope = s === '/' ? null : s
  } catch {
    // 잘못된 경로는 필터 없음으로 취급
  }
  const exts = q.ext
    ? new Set(
        q.ext
          .split(',')
          .map((e) => e.trim().toLowerCase().replace(/^\./, ''))
          .filter(Boolean),
      )
    : null
  const days = Number(q.days)
  const uploaderPaths = q.uploader
    ? new Set(
        db
          .select({ path: fileMeta.path })
          .from(fileMeta)
          .where(eq(fileMeta.uploaderId, q.uploader))
          .all()
          .map((r) => r.path),
      )
    : null
  return {
    scope,
    exts: exts && exts.size > 0 ? exts : null,
    sinceMs: Number.isFinite(days) && days > 0 ? now - days * 24 * 60 * 60 * 1000 : null,
    uploaderPaths,
  }
}

export function passesFilters(f: SearchFilters, row: IndexRow): boolean {
  if (f.scope && row.path !== f.scope && !row.path.startsWith(f.scope + '/')) return false
  if (f.exts) {
    if (row.isDir) return false
    const dot = row.name.lastIndexOf('.')
    if (dot <= 0 || !f.exts.has(row.name.slice(dot + 1).toLowerCase())) return false
  }
  if (f.sinceMs && row.mtime < f.sinceMs) return false
  if (f.uploaderPaths && (row.isDir || !f.uploaderPaths.has(row.path))) return false
  return true
}
