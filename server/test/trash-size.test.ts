import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it, afterAll } from 'vitest'
import { sqlite } from '../src/db'
import { contentQueueDrained, contentRetryErrors } from '../src/fs/content-index'
import { duBytes } from '../src/fs/purge'

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fs-du-'))
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }))

describe('duBytes', () => {
  it('파일은 자기 크기, 폴더는 재귀 합계', async () => {
    fs.writeFileSync(path.join(dir, 'a.bin'), Buffer.alloc(100))
    fs.mkdirSync(path.join(dir, 'sub'))
    fs.writeFileSync(path.join(dir, 'sub', 'b.bin'), Buffer.alloc(50))
    expect(await duBytes(path.join(dir, 'a.bin'))).toBe(100)
    expect(await duBytes(dir)).toBe(150)
  })

  it('없는 경로는 0', async () => {
    expect(await duBytes(path.join(dir, 'nope'))).toBe(0)
  })
})

describe('contentRetryErrors', () => {
  it('error 상태 행을 지우고 재큐잉한다 (파일이 없으면 인덱스에서 정리됨)', async () => {
    const rel = `/test-retry-${Date.now()}.md`
    sqlite
      .prepare(
        `INSERT INTO content_index (path, mtime, size, status, indexed_at, error)
         VALUES (?, 1, 1, 'error', 1, '테스트 실패 기록')`,
      )
      .run(rel)
    const n = contentRetryErrors()
    expect(n).toBeGreaterThanOrEqual(1)
    await contentQueueDrained()
    // 실제 파일이 없으므로 재추출 시도 후 행이 정리된다 — error로 남지 않는 것이 핵심
    const row = sqlite.prepare('SELECT status FROM content_index WHERE path = ?').get(rel) as
      | { status: string }
      | undefined
    expect(row).toBeUndefined()
  })
})
