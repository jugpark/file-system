import fsp from 'node:fs/promises'
import path from 'node:path'
import { inArray, lt } from 'drizzle-orm'
import { config } from '../config'
import { db } from '../db'
import { trash } from '../db/schema'

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
