import { config } from './config'

/**
 * Discord 웹훅 알림 — DISCORD_WEBHOOK_URL 미설정이면 전부 no-op.
 * 스팸 방지: 같은 키(유저·최상위폴더·액션)는 5분에 1건만.
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

/** 공유 폴더(개인 공간 제외)의 업로드/삭제 알림 */
export function notifyFileActivity(
  action: 'upload' | 'trash',
  actorName: string,
  relPath: string,
): void {
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

/** 디스크 여유 공간 경고 — 하루 1건 */
export function notifyDiskWarning(freePct: number): void {
  const key = 'disk-warning'
  const now = Date.now()
  if ((lastSent.get(key) ?? 0) > now - 24 * 60 * 60 * 1000) return
  lastSent.set(key, now)
  post(`⚠ **스토리지 여유 공간 ${freePct.toFixed(1)}%** — 정리가 필요합니다.`)
}
