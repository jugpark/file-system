import { eq } from 'drizzle-orm'
import { afterAll, describe, expect, it } from 'vitest'
import { db } from '../src/db'
import { fileMeta } from '../src/db/schema'
import type { IndexRow } from '../src/fs/indexer'
import { parseSearchFilters, passesFilters } from '../src/fs/search-filters'

const NOW = 1_700_000_000_000
const DAY = 24 * 60 * 60 * 1000

function row(over: Partial<IndexRow>): IndexRow {
  return { path: '/docs/a.pdf', name: 'a.pdf', isDir: false, size: 10, mtime: NOW, ...over }
}

const uploaderId = `test-filter-user-${Date.now()}`
afterAll(() => {
  db.delete(fileMeta).where(eq(fileMeta.uploaderId, uploaderId)).run()
})

describe('parseSearchFilters', () => {
  it('빈 입력 → 모두 null (필터 없음)', () => {
    const f = parseSearchFilters({}, NOW)
    expect(f).toEqual({ scope: null, exts: null, sinceMs: null, uploaderPaths: null })
  })

  it('ext는 소문자·점 제거·공백 정리', () => {
    const f = parseSearchFilters({ ext: ' .PDF, docx ,, ' }, NOW)
    expect([...f.exts!]).toEqual(['pdf', 'docx'])
  })

  it('잘못된 from 경로는 무시', () => {
    expect(parseSearchFilters({ from: '/../etc' }, NOW).scope).toBeNull()
    expect(parseSearchFilters({ from: '/docs' }, NOW).scope).toBe('/docs')
  })

  it('days → sinceMs 환산, 비수치·0은 무시', () => {
    expect(parseSearchFilters({ days: '7' }, NOW).sinceMs).toBe(NOW - 7 * DAY)
    expect(parseSearchFilters({ days: 'abc' }, NOW).sinceMs).toBeNull()
    expect(parseSearchFilters({ days: '0' }, NOW).sinceMs).toBeNull()
  })
})

describe('passesFilters', () => {
  it('scope — 자기 자신·하위만 통과, 이름 prefix 함정(/docs vs /docs2) 방지', () => {
    const f = parseSearchFilters({ from: '/docs' }, NOW)
    expect(passesFilters(f, row({ path: '/docs/a.pdf' }))).toBe(true)
    expect(passesFilters(f, row({ path: '/docs/sub/b.pdf' }))).toBe(true)
    expect(passesFilters(f, row({ path: '/docs2/a.pdf' }))).toBe(false)
    expect(passesFilters(f, row({ path: '/other/a.pdf' }))).toBe(false)
  })

  it('ext — 대소문자 무시, 폴더는 제외, 확장자 없는 파일 제외', () => {
    const f = parseSearchFilters({ ext: 'pdf,docx' }, NOW)
    expect(passesFilters(f, row({ name: '보고서.PDF' }))).toBe(true)
    expect(passesFilters(f, row({ name: 'memo.txt' }))).toBe(false)
    expect(passesFilters(f, row({ name: 'Makefile' }))).toBe(false)
    expect(passesFilters(f, row({ name: 'docs', isDir: true }))).toBe(false)
  })

  it('days — 기준 시각 이전 수정분 제외', () => {
    const f = parseSearchFilters({ days: '7' }, NOW)
    expect(passesFilters(f, row({ mtime: NOW - 1 * DAY }))).toBe(true)
    expect(passesFilters(f, row({ mtime: NOW - 8 * DAY }))).toBe(false)
  })

  it('uploader — file_meta에 그 업로더로 기록된 경로만', () => {
    db.insert(fileMeta)
      .values({ path: '/docs/mine.pdf', uploaderId, uploadedAt: NOW })
      .run()
    const f = parseSearchFilters({ uploader: uploaderId }, NOW)
    expect(passesFilters(f, row({ path: '/docs/mine.pdf' }))).toBe(true)
    expect(passesFilters(f, row({ path: '/docs/other.pdf' }))).toBe(false)
    expect(passesFilters(f, row({ path: '/docs/mine.pdf', isDir: true }))).toBe(false)
  })

  it('복합 필터는 AND', () => {
    const f = parseSearchFilters({ from: '/docs', ext: 'pdf', days: '7' }, NOW)
    expect(passesFilters(f, row({}))).toBe(true)
    expect(passesFilters(f, row({ path: '/etc/a.pdf' }))).toBe(false)
    expect(passesFilters(f, row({ name: 'a.txt' }))).toBe(false)
    expect(passesFilters(f, row({ mtime: NOW - 30 * DAY }))).toBe(false)
  })
})
