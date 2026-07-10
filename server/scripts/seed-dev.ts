/**
 * 개발용 샘플 데이터 — UI 명세서의 목업과 같은 구조를 스토리지에 만든다.
 * 실행: pnpm seed:dev  (ACL 시드도 함께 적용)
 */
import fs from 'node:fs'
import path from 'node:path'
import { config } from '../src/config'
import { ACL_SEED, applyAclSeed } from '../src/db/acl-seed'

const root = config.storageRoot

const dirs = [
  'design/2026년 기획/UI 디자인/와이어프레임',
  'design/2026년 기획/UI 디자인/시안',
  'ops/confidential',
  `home/${config.devUser.id}`,
]

const files: Array<[string, string]> = [
  ['design/2026년 기획/UI 디자인/기획서.pdf', 'dummy pdf content\n'],
  ['design/2026년 기획/UI 디자인/컬러팔레트.png', 'dummy png content\n'],
  ['design/2026년 기획/UI 디자인/히어로.psd', 'dummy psd content\n'],
  ['design/2026년 기획/UI 디자인/시안/시안_v2.fig', 'dummy fig content\n'],
  ['ops/confidential/경영지원_문서.txt', '읽기 전용 폴더 샘플\n'],
  [`home/${config.devUser.id}/메모.txt`, '개인 공간 샘플 파일\n'],
]

for (const d of dirs) fs.mkdirSync(path.join(root, d), { recursive: true })
for (const [p, content] of files) fs.writeFileSync(path.join(root, p), content)

applyAclSeed()

console.log(`샘플 스토리지 생성 완료: ${root}`)
console.log(`dev 유저: ${config.devUser.username} (roles: ${config.devUser.roles.join(', ')})`)
console.table(ACL_SEED)
