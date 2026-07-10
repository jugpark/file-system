import { db } from '../db'
import { folderAcl } from '../db/schema'
import type { AclRule } from './resolve'

/** folder_acl 전체 로드. 테이블이 작고 better-sqlite3는 동기라 요청마다 읽어도 충분하다 */
export function loadAclRules(): AclRule[] {
  return db
    .select({
      pathPrefix: folderAcl.pathPrefix,
      roleId: folderAcl.roleId,
      permission: folderAcl.permission,
    })
    .from(folderAcl)
    .all()
}
