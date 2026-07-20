import fsp from 'node:fs/promises'
import path from 'node:path'
import { inArray, lt } from 'drizzle-orm'
import { config } from '../config'
import { db } from '../db'
import { trash } from '../db/schema'

/** 파일/폴더의 총 바이트 — 폴더는 재귀 합계. 접근 불가 항목은 0으로 센다 */
export async function duBytes(abs: string): Promise<number> {
  const stat = await fsp.stat(abs).catch(() => null)
  if (!stat) return 0
  if (!stat.isDirectory()) return stat.size
  let sum = 0
  const dirents = await fsp.readdir(abs, { withFileTypes: true }).catch(() => [])
  for (const d of dirents) {
    sum += await duBytes(path.join(abs, d.name))
  }
  return sum
}

/** 보존 기한이 지난 휴지통 항목 영구 삭제. 삭제한 개수 반환 */
export async function purgeTrash(retentionDays: number, now = Date.now()): Promise<number> {
  if (retentionDays <= 0) return 0
  const cutoff = now - retentionDays * 24 * 60 * 60 * 1000
  const expired = db.select().from(trash).where(lt(trash.deletedAt, cutoff)).all()
  if (expired.length === 0) return 0

  const removedIds: string[] = []
  for (const row of expired) {
    try {
      await fsp.rm(path.join(config.trashDir, row.id), { recursive: true, force: true })
      removedIds.push(row.id)
    } catch {
      // 파일 삭제 실패 시 레코드를 남겨 다음 주기에 재시도
    }
  }
  if (removedIds.length > 0) {
    db.delete(trash).where(inArray(trash.id, removedIds)).run()
  }
  return removedIds.length
}
