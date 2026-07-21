import crypto from 'node:crypto'
import { and, desc, eq, lt, ne } from 'drizzle-orm'
import { SESSION_TTL_DAYS } from '@fs/shared'
import { db } from '../db'
import { sessions, users } from '../db/schema'

export interface SessionUser {
  id: string
  username: string
  avatarUrl: string | null
  roles: string[]
  isAdmin: boolean
}

export function upsertUser(u: { id: string; username: string; avatarUrl: string | null }): void {
  const now = Date.now()
  db.insert(users)
    .values({ id: u.id, username: u.username, avatarUrl: u.avatarUrl, createdAt: now, lastLoginAt: now })
    .onConflictDoUpdate({
      target: users.id,
      set: { username: u.username, avatarUrl: u.avatarUrl, lastLoginAt: now },
    })
    .run()
}

export function createSession(userId: string, roles: string[], userAgent?: string): string {
  const id = crypto.randomBytes(32).toString('base64url')
  const now = Date.now()
  db.insert(sessions)
    .values({
      id,
      userId,
      rolesJson: JSON.stringify(roles),
      rolesFetchedAt: now,
      expiresAt: now + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000,
      createdAt: now,
      userAgent: userAgent?.slice(0, 400) ?? null,
      lastSeenAt: now,
    })
    .run()
  // 부수 청소: 만료 세션 제거
  db.delete(sessions).where(lt(sessions.expiresAt, now)).run()
  return id
}

/** 마지막 활동 시각 갱신 — 요청마다 쓰면 부담이라 60초 스로틀 */
const TOUCH_THROTTLE_MS = 60_000
export function touchSession(sid: string, lastSeenAt: number | null): void {
  const now = Date.now()
  if (lastSeenAt && now - lastSeenAt < TOUCH_THROTTLE_MS) return
  db.update(sessions).set({ lastSeenAt: now }).where(eq(sessions.id, sid)).run()
}

/** 내 활성 세션 목록 (최근 활동 순) */
export function listSessions(userId: string) {
  return db
    .select()
    .from(sessions)
    .where(eq(sessions.userId, userId))
    .orderBy(desc(sessions.lastSeenAt))
    .all()
}

/** 내 세션 하나 해지 (소유권 확인) — 지운 행 수 반환 */
export function revokeSession(sid: string, userId: string): number {
  return db.delete(sessions).where(and(eq(sessions.id, sid), eq(sessions.userId, userId))).run()
    .changes
}

/** 현재 세션만 남기고 내 나머지 세션 전부 해지 — 지운 행 수 반환 */
export function revokeOtherSessions(keepSid: string, userId: string): number {
  return db
    .delete(sessions)
    .where(and(eq(sessions.userId, userId), ne(sessions.id, keepSid)))
    .run().changes
}

export function getSessionWithUser(sid: string) {
  const session = db.select().from(sessions).where(eq(sessions.id, sid)).get()
  if (!session) return null
  const user = db.select().from(users).where(eq(users.id, session.userId)).get()
  if (!user) return null
  return { session, user }
}

export function updateSessionRoles(sid: string, roles: string[]): void {
  db.update(sessions)
    .set({ rolesJson: JSON.stringify(roles), rolesFetchedAt: Date.now() })
    .where(eq(sessions.id, sid))
    .run()
}

export function deleteSession(sid: string): void {
  db.delete(sessions).where(eq(sessions.id, sid)).run()
}
