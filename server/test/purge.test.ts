import fs from 'node:fs'
import path from 'node:path'
import { eq } from 'drizzle-orm'
import { afterAll, describe, expect, it } from 'vitest'
import { config } from '../src/config'
import { db } from '../src/db'
import { trash } from '../src/db/schema'
import { purgeTrash } from '../src/fs/purge'

const DAY = 24 * 60 * 60 * 1000
const oldId = `test-purge-old-${Date.now()}`
const freshId = `test-purge-fresh-${Date.now()}`

afterAll(() => {
  db.delete(trash).where(eq(trash.id, oldId)).run()
  db.delete(trash).where(eq(trash.id, freshId)).run()
  fs.rmSync(path.join(config.trashDir, freshId), { force: true })
})

describe('purgeTrash', () => {
  it('보존 기한 초과분만 파일+레코드 삭제', async () => {
    const now = Date.now()
    fs.writeFileSync(path.join(config.trashDir, oldId), 'old')
    fs.writeFileSync(path.join(config.trashDir, freshId), 'fresh')
    db.insert(trash)
      .values({ id: oldId, originalPath: '/x/old.txt', isDir: false, deletedBy: 'u', deletedAt: now - 31 * DAY })
      .run()
    db.insert(trash)
      .values({ id: freshId, originalPath: '/x/fresh.txt', isDir: false, deletedBy: 'u', deletedAt: now - 1 * DAY })
      .run()

    const purged = await purgeTrash(30, now)

    expect(purged).toBeGreaterThanOrEqual(1)
    expect(fs.existsSync(path.join(config.trashDir, oldId))).toBe(false)
    expect(db.select().from(trash).where(eq(trash.id, oldId)).get()).toBeUndefined()
    // 기한 안 지난 항목은 보존
    expect(fs.existsSync(path.join(config.trashDir, freshId))).toBe(true)
    expect(db.select().from(trash).where(eq(trash.id, freshId)).get()).toBeDefined()
  })

  it('retentionDays=0 이면 아무것도 안 지움', async () => {
    expect(await purgeTrash(0)).toBe(0)
  })
})
