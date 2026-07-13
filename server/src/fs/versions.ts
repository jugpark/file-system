import crypto from 'node:crypto'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { MAX_VERSIONS, type VersionDto } from '@fs/shared'
import { config } from '../config'

/**
 * 간이 버전 보관 (R4) — 같은 이름 업로드로 덮어쓸 때 기존본을
 * .versions/{sha1(경로)}/{ts}_{이름} 으로 옮겨 최근 MAX_VERSIONS개 보관.
 * 테이블 없이 디렉터리 자체가 원장이다.
 */

export function versionDirFor(relPath: string): string {
  const hash = crypto.createHash('sha1').update(relPath.normalize('NFC')).digest('hex')
  return path.join(config.versionsDir, hash)
}

async function prune(dir: string): Promise<void> {
  const names = await fsp.readdir(dir).catch(() => [])
  const sorted = names
    .map((n) => ({ n, ts: parseInt(n.split('_')[0] ?? '0', 10) || 0 }))
    .sort((a, b) => b.ts - a.ts)
  for (const v of sorted.slice(MAX_VERSIONS)) {
    await fsp.rm(path.join(dir, v.n), { force: true }).catch(() => {})
  }
}

/** 현재 파일을 버전으로 이동(보관). 같은 볼륨 rename이라 원자적 */
export async function stashVersion(relPath: string, absFile: string): Promise<void> {
  const dir = versionDirFor(relPath)
  await fsp.mkdir(dir, { recursive: true })
  const name = path.basename(relPath)
  await fsp.rename(absFile, path.join(dir, `${Date.now()}_${name}`))
  await prune(dir)
}

export async function listVersions(relPath: string): Promise<VersionDto[]> {
  const dir = versionDirFor(relPath)
  const names = await fsp.readdir(dir).catch(() => [])
  const out: VersionDto[] = []
  for (const n of names) {
    const ts = parseInt(n.split('_')[0] ?? '0', 10)
    if (!ts) continue
    const stat = await fsp.stat(path.join(dir, n)).catch(() => null)
    if (!stat?.isFile()) continue
    out.push({ id: n, mtime: ts, size: stat.size })
  }
  return out.sort((a, b) => b.mtime - a.mtime)
}

/** 버전 id 검증 — 경로 조작 차단 */
export function versionAbs(relPath: string, id: string): string | null {
  if (id.includes('/') || id.includes('\\') || id.startsWith('.')) return null
  if (!/^\d+_/.test(id)) return null
  return path.join(versionDirFor(relPath), id)
}
