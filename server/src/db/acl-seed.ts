import { folderAcl } from './schema'
import { db } from './index'

export interface SeedRule {
  pathPrefix: string
  roleId: string
  permission: 'read' | 'write'
  note?: string
}

/**
 * ACL 시드 — v1에서는 관리 UI 없이 이 목록이 권한의 원본이다.
 * 실서버 적용 시 roleId를 실제 Discord role ID(숫자 문자열)로 교체할 것.
 * 적용: pnpm seed:acl
 */
export const ACL_SEED: SeedRule[] = [
  { pathPrefix: '/design', roleId: 'design', permission: 'write', note: '디자인팀 공유 (dev 샘플)' },
  { pathPrefix: '/ops', roleId: 'design', permission: 'read', note: '경영지원 문서 열람만 (dev 샘플)' },
]

export function applyAclSeed(rules: SeedRule[] = ACL_SEED): void {
  db.delete(folderAcl).run()
  for (const r of rules) {
    db.insert(folderAcl)
      .values({ pathPrefix: r.pathPrefix, roleId: r.roleId, permission: r.permission, note: r.note ?? null })
      .run()
  }
}
