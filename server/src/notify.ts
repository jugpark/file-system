import { config } from './config'
import { db } from './db'
import { subscriptions } from './db/schema'

/**
 * Discord 알림 2종 — 실패해도 본 작업을 막지 않는다.
 *   웹훅: DISCORD_WEBHOOK_URL 설정 시 공유 폴더 활동을 채널로 (개인 공간 제외)
 *   DM:   봇 토큰 설정 시 구독(subscriptions) 폴더 활동을 구독자에게 (본인 행동 제외)
 * 스팸 방지: 같은 키는 5분에 1건만.
 */
const lastSent = new Map<string, number>()
const WINDOW_MS = 5 * 60 * 1000

function post(content: string): void {
  if (!config.webhookUrl) return
  fetch(config.webhookUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ content }),
  }).catch(() => {
    /* 알림 실패가 본 작업을 막으면 안 된다 */
  })
}

function throttled(key: string): boolean {
  const now = Date.now()
  if ((lastSent.get(key) ?? 0) > now - WINDOW_MS) return true
  lastSent.set(key, now)
  if (lastSent.size > 500) lastSent.clear()
  return false
}

/** 업로드/삭제 알림 — 웹훅(공유 폴더) + 구독자 DM 팬아웃. actorId는 본인 제외용 */
export function notifyFileActivity(
  action: 'upload' | 'trash',
  actorName: string,
  relPath: string,
  actorId = '',
): void {
  notifySubscribers(action, actorId, actorName, relPath)
  if (!config.webhookUrl) return
  if (relPath === '/' || relPath.startsWith('/home/') || relPath === '/home') return
  const segs = relPath.split('/').filter(Boolean)
  const topFolder = '/' + (segs[0] ?? '')
  if (throttled(`${actorName}|${topFolder}|${action}`)) return
  const name = segs[segs.length - 1] ?? relPath
  const dir = '/' + segs.slice(0, -1).join('/')
  post(
    action === 'upload'
      ? `📁 **@${actorName}** 님이 \`${dir}\` 에 **${name}** 업로드`
      : `🗑 **@${actorName}** 님이 \`${dir}\` 의 **${name}** 삭제 (휴지통)`,
  )
}

// ─── 구독 DM ────────────────────────────────────────────────

const DISCORD_API = 'https://discord.com/api/v10'
/** userId → DM 채널 id 캐시 (봇당 채널은 불변) */
const dmChannels = new Map<string, string>()

async function sendDm(userId: string, content: string): Promise<void> {
  const token = config.discord.botToken
  if (!token) return
  try {
    let channel = dmChannels.get(userId)
    if (!channel) {
      const res = await fetch(`${DISCORD_API}/users/@me/channels`, {
        method: 'POST',
        headers: { authorization: `Bot ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ recipient_id: userId }),
      })
      if (!res.ok) return
      channel = ((await res.json()) as { id: string }).id
      dmChannels.set(userId, channel)
    }
    await fetch(`${DISCORD_API}/channels/${channel}/messages`, {
      method: 'POST',
      headers: { authorization: `Bot ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ content }),
    })
  } catch {
    /* DM 실패(차단 등)는 무시 */
  }
}

function notifySubscribers(
  action: 'upload' | 'trash',
  actorId: string,
  actorName: string,
  relPath: string,
): void {
  if (!config.discord.botToken) return
  const rows = db.select().from(subscriptions).all()
  if (rows.length === 0) return
  const name = relPath.split('/').filter(Boolean).pop() ?? relPath
  for (const sub of rows) {
    if (sub.userId === actorId) continue // 내 행동은 나한테 알리지 않음
    if (relPath !== sub.path && !relPath.startsWith(sub.path + '/')) continue
    if (throttled(`dm|${sub.userId}|${sub.path}|${action}`)) continue
    void sendDm(
      sub.userId,
      action === 'upload'
        ? `🔔 구독 폴더 \`${sub.path}\` — **@${actorName}** 님이 **${name}** 업로드`
        : `🔔 구독 폴더 \`${sub.path}\` — **@${actorName}** 님이 **${name}** 삭제 (휴지통)`,
    )
  }
}

/** 디스크 여유 공간 경고 — 하루 1건 */
export function notifyDiskWarning(freePct: number): void {
  const key = 'disk-warning'
  const now = Date.now()
  if ((lastSent.get(key) ?? 0) > now - 24 * 60 * 60 * 1000) return
  lastSent.set(key, now)
  post(`⚠ **스토리지 여유 공간 ${freePct.toFixed(1)}%** — 정리가 필요합니다.`)
}
