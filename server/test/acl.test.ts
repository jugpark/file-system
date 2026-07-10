import { describe, expect, it } from 'vitest'
import { canSee, resolvePermission, type AclRule, type AclUser } from '../src/acl/resolve'

const designer: AclUser = { id: '111', roles: ['design'] }
const dev: AclUser = { id: '222', roles: ['engineering'] }
const noRole: AclUser = { id: '333', roles: [] }

const rules: AclRule[] = [
  { pathPrefix: '/design', roleId: 'design', permission: 'write' },
  { pathPrefix: '/design', roleId: 'engineering', permission: 'read' },
  { pathPrefix: '/design/archive', roleId: 'design', permission: 'read' },
  { pathPrefix: '/ops/confidential', roleId: 'design', permission: 'read' },
]

describe('resolvePermission', () => {
  it('기본은 deny', () => {
    expect(resolvePermission(noRole, '/design', rules)).toBe('none')
    expect(resolvePermission(designer, '/random', rules)).toBe('none')
  })

  it('prefix가 하위 경로에 상속된다', () => {
    expect(resolvePermission(designer, '/design/shared/시안_v2', rules)).toBe('write')
    expect(resolvePermission(dev, '/design/shared', rules)).toBe('read')
  })

  it('가장 깊은 prefix가 승리한다 (하위에서 권한 축소 가능)', () => {
    expect(resolvePermission(designer, '/design/archive/old', rules)).toBe('read')
  })

  it('같은 깊이면 write가 이긴다', () => {
    const both: AclUser = { id: '444', roles: ['design', 'engineering'] }
    expect(resolvePermission(both, '/design/x', rules)).toBe('write')
  })

  it('이름이 비슷한 형제 폴더에는 매칭되지 않는다', () => {
    expect(resolvePermission(designer, '/design2', rules)).toBe('none')
    expect(resolvePermission(designer, '/designers/x', rules)).toBe('none')
  })

  it('자기 home은 자동 write, 남의 home은 무조건 none', () => {
    expect(resolvePermission(designer, '/home/111', rules)).toBe('write')
    expect(resolvePermission(designer, '/home/111/메모.txt', rules)).toBe('write')
    expect(resolvePermission(designer, '/home/222', rules)).toBe('none')
    // ACL로도 남의 home은 못 연다
    const evil: AclRule[] = [{ pathPrefix: '/home/222', roleId: 'design', permission: 'write' }]
    expect(resolvePermission(designer, '/home/222/x', evil)).toBe('none')
  })

  it('NFD로 들어온 경로도 NFC prefix와 매칭된다', () => {
    const krRules: AclRule[] = [{ pathPrefix: '/디자인', roleId: 'design', permission: 'write' }]
    const nfdPath = '/디자인/시안'.normalize('NFD')
    expect(resolvePermission(designer, nfdPath, krRules)).toBe('write')
  })
})

describe('canSee', () => {
  it('직접 권한이 있으면 보인다', () => {
    expect(canSee(designer, '/design/shared', rules)).toBe(true)
  })

  it('하위 grant로 가는 경유 통로는 보인다 (단, 통로일 뿐 권한은 none)', () => {
    expect(canSee(designer, '/ops', rules)).toBe(true)
    expect(resolvePermission(designer, '/ops', rules)).toBe('none')
  })

  it('grant와 무관한 경로는 안 보인다', () => {
    expect(canSee(dev, '/ops', rules)).toBe(false)
    expect(canSee(noRole, '/design', rules)).toBe(false)
  })

  it('루트와 /home 은 자기 home으로 가는 통로라 항상 보인다', () => {
    expect(canSee(noRole, '/', rules)).toBe(true)
    expect(canSee(noRole, '/home', rules)).toBe(true)
    expect(canSee(noRole, '/home/333', rules)).toBe(true)
    expect(canSee(noRole, '/home/999', rules)).toBe(false)
  })
})
