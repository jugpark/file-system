import { describe, expect, it } from 'vitest'
import { toWatchRel } from '../src/watcher'

describe('toWatchRel', () => {
  const root = '/data/storage'

  it('스토리지 안 경로 → 상대 경로', () => {
    expect(toWatchRel(root, '/data/storage/design/a.txt')).toBe('/design/a.txt')
    expect(toWatchRel(root, '/data/storage/한글 폴더/파일.pdf')).toBe('/한글 폴더/파일.pdf')
  })

  it('루트 자신·바깥 경로는 null', () => {
    expect(toWatchRel(root, '/data/storage')).toBe(null)
    expect(toWatchRel(root, '/data/other/x')).toBe(null)
  })

  it('숨김/예약 세그먼트(.tmp, .trash, dotfile)는 null', () => {
    expect(toWatchRel(root, '/data/storage/.tmp/abc')).toBe(null)
    expect(toWatchRel(root, '/data/storage/.trash/id1')).toBe(null)
    expect(toWatchRel(root, '/data/storage/design/.hidden')).toBe(null)
  })
})
