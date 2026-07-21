import { describe, expect, it } from 'vitest'
import { buildDigestText, type DigestRow } from '../src/notify'

const NOW = 1_700_000_000_000
const WEEK = 7 * 24 * 60 * 60 * 1000

function rows(...specs: Array<[string, string, number?]>): DigestRow[] {
  return specs.flatMap(([action, actorName, count = 1]) =>
    Array.from({ length: count }, () => ({ action, actorName })),
  )
}

describe('buildDigestText', () => {
  it('활동이 없으면 null', () => {
    expect(buildDigestText([], NOW - WEEK, NOW)).toBeNull()
  })

  it('세는 액션만(다운로드·공유생성 등은 제외) — 전부 제외면 null', () => {
    expect(buildDigestText(rows(['download', 'a'], ['share_create', 'b']), NOW - WEEK, NOW)).toBeNull()
  })

  it('업로드/삭제/기타 집계 + 상위 기여자', () => {
    const text = buildDigestText(
      rows(['upload', '민지', 5], ['upload', '수현', 2], ['trash', '민지', 1], ['rename', '태호', 3]),
      NOW - WEEK,
      NOW,
    )!
    expect(text).toContain('업로드 7')
    expect(text).toContain('삭제 1')
    expect(text).toContain('기타 변경 3')
    // 민지(6) > 태호(3) > 수현(2)
    expect(text).toMatch(/@민지 \(6\).*@태호 \(3\).*@수현 \(2\)/s)
  })

  it('기간(일) 표시', () => {
    const text = buildDigestText(rows(['upload', 'a']), NOW - WEEK, NOW)!
    expect(text).toContain('지난 7일')
  })
})
