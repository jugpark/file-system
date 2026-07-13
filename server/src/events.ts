import { EventEmitter } from 'node:events'

/**
 * 파일 변경 이벤트 버스 — SSE(/api/events)로 브라우저에 전달돼 열려 있는
 * 목록을 자동 갱신한다. 사내 인원 규모라 인메모리로 충분(브로커 불필요).
 * 이벤트는 "이 폴더가 바뀌었다"는 무효화 신호일 뿐, 진실의 원천은 여전히 readdir.
 */
const bus = new EventEmitter()
bus.setMaxListeners(100) // 동시 접속 브라우저 수만큼 리스너가 붙는다

const lastEmit = new Map<string, number>()

/** 해당 폴더가 바뀌었음을 알림. 같은 폴더 1초 내 중복은 무시(워처 폭주 방지) */
export function emitChanged(dirPath: string): void {
  const now = Date.now()
  if ((lastEmit.get(dirPath) ?? 0) > now - 1000) return
  lastEmit.set(dirPath, now)
  bus.emit('changed', dirPath)
  if (lastEmit.size > 1000) lastEmit.clear()
}

export function onChanged(fn: (dirPath: string) => void): () => void {
  bus.on('changed', fn)
  return () => bus.off('changed', fn)
}

export function parentDirOf(relPath: string): string {
  const segs = relPath.split('/').filter(Boolean)
  return '/' + segs.slice(0, -1).join('/')
}
