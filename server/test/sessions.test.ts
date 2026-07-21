import { afterAll, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { db } from '../src/db'
import { sessions } from '../src/db/schema'
import {
  createSession,
  listSessions,
  revokeOtherSessions,
  revokeSession,
  touchSession,
} from '../src/auth/session'

const userId = `test-sess-user-${Date.now()}`
const other = `test-sess-other-${Date.now()}`

afterAll(() => {
  db.delete(sessions).where(eq(sessions.userId, userId)).run()
  db.delete(sessions).where(eq(sessions.userId, other)).run()
})

describe('session management', () => {
  it('createSession이 UA·last_seen을 기록', () => {
    const sid = createSession(userId, ['design'], 'Mozilla/5.0 Chrome Test')
    const row = db.select().from(sessions).where(eq(sessions.id, sid)).get()!
    expect(row.userAgent).toBe('Mozilla/5.0 Chrome Test')
    expect(row.lastSeenAt).toBeGreaterThan(0)
  })

  it('listSessions는 내 세션만', () => {
    createSession(userId, [], 'A')
    createSession(other, [], 'B')
    const mine = listSessions(userId)
    expect(mine.length).toBeGreaterThanOrEqual(2)
    expect(mine.every((s) => s.userId === userId)).toBe(true)
  })

  it('touchSession은 스로틀 안에선 갱신 안 함', () => {
    const sid = createSession(userId, [], 'C')
    // 저장된 값을 과거로 밀어 놓고 스로틀 경계를 확인
    const old = Date.now() - 10 * 60_000
    db.update(sessions).set({ lastSeenAt: old }).where(eq(sessions.id, sid)).run()

    // 최근에 본 것으로 알려주면(스로틀 내) DB를 건드리지 않는다
    touchSession(sid, Date.now())
    expect(db.select().from(sessions).where(eq(sessions.id, sid)).get()!.lastSeenAt).toBe(old)

    // 오래된 last_seen을 주면 갱신 — 과거값보다 확실히 커진다
    touchSession(sid, old)
    expect(db.select().from(sessions).where(eq(sessions.id, sid)).get()!.lastSeenAt!).toBeGreaterThan(old)
  })

  it('revokeSession은 소유자만, 남의 세션은 못 지움', () => {
    const mine = createSession(userId, [], 'D')
    const theirs = createSession(other, [], 'E')
    expect(revokeSession(theirs, userId)).toBe(0) // 남의 것 → 0
    expect(db.select().from(sessions).where(eq(sessions.id, theirs)).get()).toBeDefined()
    expect(revokeSession(mine, userId)).toBe(1)
    expect(db.select().from(sessions).where(eq(sessions.id, mine)).get()).toBeUndefined()
  })

  it('revokeOtherSessions는 현재만 남기고 내 나머지 삭제', () => {
    db.delete(sessions).where(eq(sessions.userId, userId)).run()
    const keep = createSession(userId, [], 'keep')
    createSession(userId, [], 'gone1')
    createSession(userId, [], 'gone2')
    const n = revokeOtherSessions(keep, userId)
    expect(n).toBe(2)
    const left = listSessions(userId)
    expect(left.map((s) => s.id)).toEqual([keep])
  })
})
