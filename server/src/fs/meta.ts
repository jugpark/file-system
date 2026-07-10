import { eq, inArray } from 'drizzle-orm'
import type { ActivityAction } from '@fs/shared'
import { db, sqlite } from '../db'
import { activityLog, fileMeta, users } from '../db/schema'

export function recordActivity(
  action: ActivityAction,
  relPath: string,
  actorId: string,
  detail?: Record<string, unknown>,
): void {
  db.insert(activityLog)
    .values({
      path: relPath,
      actorId,
      action,
      detailJson: detail ? JSON.stringify(detail) : null,
      createdAt: Date.now(),
    })
    .run()
}

export function setFileMeta(relPath: string, uploaderId: string): void {
  db.insert(fileMeta)
    .values({ path: relPath, uploaderId, uploadedAt: Date.now() })
    .onConflictDoUpdate({
      target: fileMeta.path,
      set: { uploaderId, uploadedAt: Date.now() },
    })
    .run()
}

function likeEscape(s: string): string {
  return s.replace(/[\\%_]/g, (c) => '\\' + c)
}

/**
 * rename/move 시 경로 키 일괄 이전 — 대상 자신 + (폴더면) 하위 전부.
 * activity_log도 함께 옮겨 파일의 타임라인이 새 경로를 따라간다
 * (이전 경로는 호출부에서 detail_json에 남긴다).
 */
export function moveMetaPrefix(from: string, to: string): void {
  for (const table of ['file_meta', 'activity_log']) {
    sqlite
      .prepare(
        `UPDATE ${table} SET path = ? || substr(path, ?) WHERE path = ? OR path LIKE ? ESCAPE '\\'`,
      )
      .run(to, from.length + 1, from, likeEscape(from) + '/%')
  }
}

/** trash 시 메타 제거 (activity_log는 이력이므로 보존) */
export function deleteMetaPrefix(relPath: string): void {
  sqlite
    .prepare(`DELETE FROM file_meta WHERE path = ? OR path LIKE ? ESCAPE '\\'`)
    .run(relPath, likeEscape(relPath) + '/%')
}

/** 목록 응답용 — 경로들의 업로더 표시명 맵 */
export function uploaderNamesFor(paths: string[]): Map<string, string> {
  if (paths.length === 0) return new Map()
  const rows = db
    .select({ path: fileMeta.path, username: users.username })
    .from(fileMeta)
    .leftJoin(users, eq(users.id, fileMeta.uploaderId))
    .where(inArray(fileMeta.path, paths))
    .all()
  const map = new Map<string, string>()
  for (const r of rows) if (r.username) map.set(r.path, r.username)
  return map
}
