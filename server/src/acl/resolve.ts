import type { Permission } from '@fs/shared'

/**
 * 권한 해석기 (순수 함수 — DB 접근 없음, 단위 테스트 대상)
 *
 * 규칙:
 *  - /home/{자기 id} 이하는 무조건 write, 남의 home은 무조건 none
 *  - 그 외에는 folder_acl 중 유저 role과 일치하고 경로의 조상(또는 자신)인
 *    prefix들 가운데 가장 깊은 것이 승리. 같은 깊이면 write > read
 *  - 아무것도 매칭되지 않으면 none (목록에서도 숨김)
 */

export interface AclRule {
  pathPrefix: string
  roleId: string
  permission: 'read' | 'write'
}

export interface AclUser {
  id: string
  roles: string[]
  /** ADMIN_ROLE_ID 보유자 — 전 경로 write, 단 남의 home은 read까지만 */
  isAdmin?: boolean
}

/** '/a/b' → ['a','b']. 비교는 항상 NFC로 정규화해서 수행 */
export function pathSegments(relPath: string): string[] {
  return relPath
    .split('/')
    .filter(Boolean)
    .map((s) => s.normalize('NFC'))
}

function isPrefixOf(prefix: string[], target: string[]): boolean {
  return prefix.length <= target.length && prefix.every((seg, i) => target[i] === seg)
}

export function resolvePermission(user: AclUser, relPath: string, rules: AclRule[]): Permission {
  const segs = pathSegments(relPath)

  if (segs[0] === 'home') {
    if (segs[1] === user.id) return 'write'
    // 남의 개인 공간은 ACL로도 열 수 없다. admin은 read까지만(개인 공간 존중)
    if (segs.length >= 2) return user.isAdmin ? 'read' : 'none'
  }

  if (user.isAdmin) return 'write'

  let best: { depth: number; perm: 'read' | 'write' } | null = null
  for (const rule of rules) {
    if (!user.roles.includes(rule.roleId)) continue
    const ruleSegs = pathSegments(rule.pathPrefix)
    if (!isPrefixOf(ruleSegs, segs)) continue
    const depth = ruleSegs.length
    if (!best || depth > best.depth || (depth === best.depth && rule.permission === 'write')) {
      best = { depth, perm: rule.permission }
    }
  }
  return best?.perm ?? 'none'
}

/**
 * 목록/트리에 노출해도 되는가.
 * 직접 권한이 없어도, 하위에 권한 있는 폴더가 존재하면 "경유 통로"로 보인다.
 * (예: /design/shared에만 권한이 있어도 / 와 /design 은 탐색 가능해야 한다)
 */
export function canSee(user: AclUser, relPath: string, rules: AclRule[]): boolean {
  if (user.isAdmin) return true
  if (resolvePermission(user, relPath, rules) !== 'none') return true
  const segs = pathSegments(relPath)
  // 자기 home으로 가는 조상 경로 ('/', '/home')
  if (isPrefixOf(segs, ['home', user.id])) return true
  // 하위에 grant가 존재하는 경로
  return rules.some(
    (rule) => user.roles.includes(rule.roleId) && isPrefixOf(segs, pathSegments(rule.pathPrefix)),
  )
}
