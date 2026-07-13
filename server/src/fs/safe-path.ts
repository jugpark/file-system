import path from 'node:path'

/**
 * 경로 보안 계층 — 모든 /api/fs/* 라우트는 반드시 toRelPath → resolveAbs를 거친다.
 *
 * 주의: 조회 경로는 NFC로 강제 변환하지 않는다. NAS에 NFD(macOS) 이름으로 저장된
 * 파일도 목록에 나온 그대로 다시 요청하면 열려야 하기 때문. NFC 강제는 쓰기(M2)에서만.
 * ACL 비교는 resolve.ts 내부에서 양쪽을 NFC 정규화해 수행한다.
 */

export class PathError extends Error {
  statusCode: number
  constructor(message: string, statusCode = 400) {
    super(message)
    this.name = 'PathError'
    this.statusCode = statusCode
  }
}

function hasControlChar(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    if (c < 0x20 || c === 0x7f) return true
  }
  return false
}

/** 사용자 입력 → 정규화된 상대 경로('/a/b', 루트는 '/'). 위험 요소는 전부 거부 */
export function toRelPath(input: string | undefined): string {
  const raw = input ?? '/'
  if (raw.includes('\\')) throw new PathError('허용되지 않는 경로입니다')
  if (hasControlChar(raw)) throw new PathError('허용되지 않는 경로입니다')
  const segs = raw.split('/').filter((s) => s.length > 0)
  for (const seg of segs) {
    if (seg === '.' || seg === '..') throw new PathError('허용되지 않는 경로입니다')
    // 숨김 파일 + 예약 디렉터리(.trash, .tmp) 접근 차단
    if (seg.startsWith('.')) throw new PathError('존재하지 않는 경로입니다', 404)
  }
  return '/' + segs.join('/')
}

/** 상대 경로 → 스토리지 안의 절대 경로. 루트 탈출은 이중으로 차단 */
export function resolveAbs(storageRoot: string, relPath: string): string {
  const root = path.resolve(storageRoot)
  const abs = path.resolve(root, '.' + relPath)
  // 드라이브 루트(C:\)나 '/'처럼 root가 이미 구분자로 끝나는 경우를 처리
  const rootWithSep = root.endsWith(path.sep) ? root : root + path.sep
  if (abs !== root && !abs.startsWith(rootWithSep)) {
    throw new PathError('허용되지 않는 경로입니다', 400)
  }
  return abs
}
