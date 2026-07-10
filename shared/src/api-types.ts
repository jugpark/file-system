/** 서버·웹이 공유하는 API 요청/응답 DTO. 여기 외의 곳에 API 형태를 정의하지 않는다. */

export type Permission = 'none' | 'read' | 'write'

/** 파일/폴더 한 항목. permission은 "이 항목 자체"에 대한 현재 유저의 권한 */
export interface FsEntry {
  name: string
  /** 스토리지 루트 기준 상대 경로. 항상 '/'로 시작 */
  path: string
  isDir: boolean
  /** bytes. 폴더는 0 */
  size: number
  /** epoch ms */
  mtime: number
  permission: Exclude<Permission, 'none'>
}

export interface ListResponse {
  path: string
  permission: Permission
  entries: FsEntry[]
}

export interface TreeNode {
  name: string
  path: string
  hasChildren: boolean
}

export interface TreeResponse {
  path: string
  nodes: TreeNode[]
}

export interface MeResponse {
  id: string
  username: string
  avatarUrl: string | null
  roles: string[]
  /** 이 유저의 개인 공간 경로 (/home/{id}) */
  homePath: string
}

export interface ApiErrorBody {
  error: { code: string; message: string }
}
