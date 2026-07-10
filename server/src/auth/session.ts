import crypto from 'node:crypto'
import { eq, lt } from 'drizzle-orm'
import { SESSION_TTL_DAYS } from '@fs/shared'
import { db } from '../db'
import { sessions, users } from '../db/schema'

export interface SessionUser {
  id: string
  username: string
  avatarUrl: string | null
  roles: string[]
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

export function createSession(userId: string, roles: string[]): string {
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
    })
    .run()
  // 부수 청소: 만료 세션 제거
  db.delete(sessions).where(lt(sessions.expiresAt, now)).run()
  return id
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
