// E2E 공용 유틸 — 어서션 프레임워크 + 다중 신원(쿠키) + HTTP/DB 헬퍼.
// 실제 서버를 띄우고 실 HTTP로 두드리는 통합 테스트라 vitest가 아닌 순수 Node로 돈다.
import { Signer } from '@fastify/cookie'
import Database from 'better-sqlite3'

export const BASE = process.env.E2E_BASE ?? 'http://127.0.0.1:6099'
export const SECRET = process.env.E2E_SECRET ?? 'e2e-secret-32-chars-long-000000000'
const signer = new Signer(SECRET)

let pass = 0
let fail = 0
const failures = []
let group = ''

export function section(name) {
  group = name
  console.log(`\n── ${name} ──`)
}
export function ok(cond, name) {
  if (cond) pass++
  else {
    fail++
    failures.push(`[${group}] ${name}`)
    console.log(`  ✗ ${name}`)
  }
}
export function eq(actual, expected, name) {
  ok(actual === expected, `${name} (기대 ${JSON.stringify(expected)}, 실제 ${JSON.stringify(actual)})`)
}
export function summary() {
  console.log(`\n${'='.repeat(52)}`)
  console.log(`E2E 결과: ${pass} passed, ${fail} failed`)
  if (failures.length) {
    console.log('\n실패:')
    for (const f of failures) console.log('  ✗ ' + f)
  }
  console.log('='.repeat(52))
  return fail === 0
}

/** 지정 신원의 유저+세션을 DB에 직접 심고 서명 쿠키를 만든다 (다중 유저 시뮬레이션) */
export function makeIdentity(dbPath, { id, username, roles }) {
  const db = new Database(dbPath)
  const now = Date.now()
  db.prepare(
    `INSERT INTO users (id, username, avatar_url, created_at, last_login_at)
     VALUES (?, ?, NULL, ?, ?) ON CONFLICT(id) DO UPDATE SET username=excluded.username`,
  ).run(id, username, now, now)
  const sid = `e2e_${id}_${now}`
  db.prepare(
    `INSERT INTO sessions (id, user_id, roles_json, roles_fetched_at, expires_at, created_at, user_agent, last_seen_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(sid, id, JSON.stringify(roles), now, now + 30 * 864e5, now, `e2e/${username}`, now)
  db.close()
  return { id, username, roles, cookie: `sid=${signer.sign(sid)}`, sid }
}

/** 같은 유저의 추가 세션(다른 기기) 심기 */
export function extraSession(dbPath, userId, ua) {
  const db = new Database(dbPath)
  const now = Date.now()
  const sid = `e2e_${userId}_extra_${now}`
  db.prepare(
    `INSERT INTO sessions (id, user_id, roles_json, roles_fetched_at, expires_at, created_at, user_agent, last_seen_at)
     VALUES (?, ?, '[]', ?, ?, ?, ?, ?)`,
  ).run(sid, userId, now, now + 30 * 864e5, now, ua, now)
  db.close()
  return `sid=${signer.sign(sid)}`
}

export function openDb(dbPath) {
  return new Database(dbPath, { readonly: true })
}

export async function req(id, method, path, { body, raw } = {}) {
  const headers = {}
  if (id?.cookie) headers.cookie = id.cookie
  let payload
  if (body !== undefined) {
    headers['content-type'] = 'application/json'
    payload = JSON.stringify(body)
  }
  const res = await fetch(BASE + path, { method, headers, body: payload })
  if (raw) return res
  const text = await res.text()
  let data = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = text
  }
  return { status: res.status, data, headers: res.headers }
}
export const GET = (id, p, o) => req(id, 'GET', p, o)
export const POST = (id, p, body) => req(id, 'POST', p, { body })
export const PATCH = (id, p, body) => req(id, 'PATCH', p, { body })
export const DEL = (id, p) => req(id, 'DELETE', p)

export async function upload(cookie, path, filename, content, relPath) {
  const fd = new FormData()
  if (relPath) fd.append('relPath', relPath)
  fd.append('file', new Blob([content]), filename)
  const headers = {}
  if (cookie) headers.cookie = cookie
  const res = await fetch(`${BASE}/api/fs/upload?path=${encodeURIComponent(path)}`, {
    method: 'POST',
    headers,
    body: fd,
  })
  const t = await res.text()
  return { status: res.status, data: t ? JSON.parse(t) : null }
}

export async function anonUpload(url, filename, content) {
  const fd = new FormData()
  fd.append('file', new Blob([content]), filename)
  const res = await fetch(url, { method: 'POST', body: fd })
  const t = await res.text()
  let data = t
  try {
    data = t ? JSON.parse(t) : null
  } catch {
    /* keep text */
  }
  return { status: res.status, data }
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
