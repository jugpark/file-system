import { ACL_SEED, applyAclSeed } from '../src/db/acl-seed'

applyAclSeed()
console.log('folder_acl 시드 적용 완료:')
console.table(ACL_SEED)
