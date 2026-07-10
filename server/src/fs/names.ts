import fsp from 'node:fs/promises'
import path from 'node:path'
import { FORBIDDEN_NAME_CHARS } from '@fs/shared'
import { PathError } from './safe-path'

/**
 * 쓰기 작업의 이름 규칙 — 새로 만들어지는 이름은 항상 NFC로 강제한다.
 * (조회 경로는 NFD 그대로 허용하는 것과 대비됨 — safe-path.ts 주석 참고)
 */
export function validateEntryName(raw: string): string {
  const name = raw.normalize('NFC').trim()
  if (!name) throw new PathError('이름이 비어 있습니다')
  if (name.length > 200) throw new PathError('이름이 너무 깁니다 (200자 이하)')
  if (name === '.' || name === '..') throw new PathError('사용할 수 없는 이름입니다')
  if (name.startsWith('.')) throw new PathError("이름은 '.'으로 시작할 수 없습니다")
  if (FORBIDDEN_NAME_CHARS.test(name)) {
    throw new PathError('이름에 사용할 수 없는 문자가 있습니다 (\\ / : * ? " < > |)')
  }
  return name
}

async function exists(absDir: string, name: string): Promise<boolean> {
  return !!(await fsp.stat(path.join(absDir, name)).catch(() => null))
}

/** 'a.txt' 충돌 시 'a (1).txt', 'a (2).txt' … 로 회피한 최종 이름 */
export async function resolveCollision(absDir: string, name: string): Promise<string> {
  if (!(await exists(absDir, name))) return name
  const dot = name.lastIndexOf('.')
  const stem = dot > 0 ? name.slice(0, dot) : name
  const ext = dot > 0 ? name.slice(dot) : ''
  for (let i = 1; i < 1000; i++) {
    const candidate = `${stem} (${i})${ext}`
    if (!(await exists(absDir, candidate))) return candidate
  }
  throw new PathError('이름 충돌을 해결할 수 없습니다', 409)
}

/** 복원 시 원래 자리가 차 있으면 ' (복원)' 접미사로 회피 */
export async function resolveRestoreName(absDir: string, name: string): Promise<string> {
  if (!(await exists(absDir, name))) return name
  const dot = name.lastIndexOf('.')
  const stem = dot > 0 ? name.slice(0, dot) : name
  const ext = dot > 0 ? name.slice(dot) : ''
  return resolveCollision(absDir, `${stem} (복원)${ext}`)
}
