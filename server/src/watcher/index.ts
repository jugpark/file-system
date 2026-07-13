import path from 'node:path'
import chokidar from 'chokidar'
import type { FastifyBaseLogger } from 'fastify'
import { config } from '../config'
import { emitChanged, parentDirOf } from '../events'
import { indexRemove, indexUpsert } from '../fs/indexer'

/**
 * 외부 변경 감지 — 삼바/SSH로 직접 넣거나 지운 파일을 fs_index에 반영한다.
 * (쓰기 라우트를 거친 변경은 라우트가 이미 인덱스를 갱신하므로 여기선 idempotent 재갱신일 뿐)
 */

/** 스토리지 루트 기준 상대 경로. 숨김/예약(.trash, .tmp) 하위면 null */
export function toWatchRel(storageRoot: string, absPath: string): string | null {
  const rel = path.relative(storageRoot, absPath)
  if (!rel || rel.startsWith('..')) return null
  const segs = rel.split(path.sep)
  if (segs.some((s) => s.startsWith('.'))) return null
  return '/' + segs.join('/')
}

export function startWatcher(log: FastifyBaseLogger): void {
  const watcher = chokidar.watch(config.storageRoot, {
    ignoreInitial: true, // 초기 상태는 fullScan()이 담당
    ignored: (absPath: string) => {
      const rel = path.relative(config.storageRoot, absPath)
      return rel.split(path.sep).some((s) => s.startsWith('.'))
    },
    awaitWriteFinish: { stabilityThreshold: 800, pollInterval: 200 },
    // 9p/drvfs·일부 네트워크 마운트는 inotify가 전달되지 않는다 → WATCH_POLLING=true
    usePolling: config.watchPolling,
    interval: 1500,
    binaryInterval: 3000,
  })

  const upsert = (absPath: string, stats?: { isDirectory(): boolean; size: number; mtimeMs: number }) => {
    const rel = toWatchRel(config.storageRoot, absPath)
    if (!rel || !stats) return
    indexUpsert(rel, { isDir: stats.isDirectory(), size: stats.size, mtimeMs: stats.mtimeMs })
    emitChanged(parentDirOf(rel)) // 외부 반입도 열려 있는 화면에 실시간 반영
  }
  const remove = (absPath: string) => {
    const rel = toWatchRel(config.storageRoot, absPath)
    if (!rel) return
    indexRemove(rel)
    emitChanged(parentDirOf(rel))
  }

  watcher
    .on('add', (p, s) => upsert(p, s))
    .on('change', (p, s) => upsert(p, s))
    .on('addDir', (p, s) => upsert(p, s))
    .on('unlink', remove)
    .on('unlinkDir', remove)
    .on('error', (err) => log.warn({ err }, 'watcher error'))

  log.info('파일 워처 시작 (외부 변경 → fs_index)')
}
