import fs from 'node:fs'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { config } from '../src/config'
import { sqlite } from '../src/db'
import {
  contentEnqueue,
  contentMove,
  contentQueueDrained,
  contentReconcile,
  contentRemove,
  contentSearchEnabled,
  searchContent,
} from '../src/fs/content-index'
import { indexRemove, indexUpsert } from '../src/fs/indexer'

const stamp = Date.now()
const relA = `/test-content-a-${stamp}.md`
const relB = `/test-content-b-${stamp}.md`
const token = `증분예산결산흐름${stamp}`

function cleanup(rel: string) {
  fs.rmSync(path.join(config.storageRoot, rel), { force: true })
  sqlite.prepare('DELETE FROM fs_index WHERE path = ?').run(rel)
  contentRemove(rel)
}

afterAll(() => {
  for (const r of [relA, relB]) cleanup(r)
})

describe('content-index', () => {
  it('추출→FTS 인덱싱→trigram 부분 일치(한글)', async () => {
    expect(contentSearchEnabled()).toBe(true)
    const abs = path.join(config.storageRoot, relA)
    fs.writeFileSync(abs, `프로젝트 개요\n${token} 정리 문서\n마지막 줄`)
    const st = fs.statSync(abs)
    contentEnqueue(relA, st.mtimeMs)
    await contentQueueDrained()

    const hits = searchContent(token, 10)
    expect(hits.some((h) => h.path === relA)).toBe(true)
    // 스니펫에 일치 부분 주변 문맥이 담긴다
    const hit = hits.find((h) => h.path === relA)!
    expect(hit.snippet).toContain('정리 문서')
  })

  it('2글자 질의는 LIKE 폴백으로 동작', () => {
    const hits = searchContent('증분', 10)
    expect(hits.some((h) => h.path === relA)).toBe(true)
    expect(hits.find((h) => h.path === relA)!.snippet).toContain('증분')
  })

  it('1글자는 빈 결과', () => {
    expect(searchContent('증', 10)).toEqual([])
  })

  it('move — 경로 키만 이전되고 검색은 유지', async () => {
    fs.renameSync(path.join(config.storageRoot, relA), path.join(config.storageRoot, relB))
    contentMove(relA, relB)
    const hits = searchContent(token, 10)
    expect(hits.some((h) => h.path === relB)).toBe(true)
    expect(hits.some((h) => h.path === relA)).toBe(false)
  })

  it('remove — 인덱스에서 사라진다', () => {
    contentRemove(relB)
    expect(searchContent(token, 10)).toEqual([])
  })

  it('mtime이 같으면 재추출을 건너뛴다 (큐에 안 들어감)', async () => {
    const abs = path.join(config.storageRoot, relB)
    fs.writeFileSync(abs, `재추출 확인 ${token}`)
    const st = fs.statSync(abs)
    contentEnqueue(relB, st.mtimeMs)
    await contentQueueDrained()
    const before = sqlite
      .prepare('SELECT indexed_at FROM content_index WHERE path = ?')
      .get(relB) as { indexed_at: number }
    contentEnqueue(relB, st.mtimeMs) // 같은 mtime — no-op이어야 한다
    await contentQueueDrained()
    const after = sqlite
      .prepare('SELECT indexed_at FROM content_index WHERE path = ?')
      .get(relB) as { indexed_at: number }
    expect(after.indexed_at).toBe(before.indexed_at)
  })

  it('reconcile — fs_index에 없는 내용 인덱스는 고아로 정리', async () => {
    // relB는 위 테스트에서 내용 인덱스만 있고 fs_index에는 없음 → 정리 대상
    expect(
      sqlite.prepare('SELECT COUNT(*) c FROM content_index WHERE path = ?').get(relB),
    ).toMatchObject({ c: 1 })
    contentReconcile()
    expect(
      sqlite.prepare('SELECT COUNT(*) c FROM content_index WHERE path = ?').get(relB),
    ).toMatchObject({ c: 0 })
  })

  it('indexUpsert/indexRemove 훅으로도 내용 인덱스가 따라간다', async () => {
    const abs = path.join(config.storageRoot, relA)
    fs.writeFileSync(abs, `훅 경유 인덱싱 ${token}`)
    const st = fs.statSync(abs)
    indexUpsert(relA, { isDir: false, size: st.size, mtimeMs: st.mtimeMs })
    await contentQueueDrained()
    expect(searchContent(`훅 경유 인덱싱 ${token}`, 10).some((h) => h.path === relA)).toBe(true)

    indexRemove(relA)
    expect(searchContent(`훅 경유 인덱싱 ${token}`, 10)).toEqual([])
  })
})
