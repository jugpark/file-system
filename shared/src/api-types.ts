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
  /** 업로더 표시명 (file_meta 기록이 있는 파일만) */
  uploader: string | null
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
  /** 개인 공간 폴더가 실제로 존재하는가 (스토리지 루트에 못 만드는 환경이면 false) */
  homeExists: boolean
  /** ADMIN_ROLE_ID 보유자 — 전 경로 접근(남의 home은 read), 관리 페이지 노출 */
  isAdmin: boolean
}

export interface ApiErrorBody {
  error: { code: string; message: string }
}

// ─── 쓰기 작업 (M2) ─────────────────────────────────────────

export type ActivityAction =
  | 'upload'
  | 'mkdir'
  | 'rename'
  | 'move'
  | 'copy'
  | 'trash'
  | 'restore'
  | 'acl_change'
  | 'share_create'
  | 'share_revoke'
  | 'version_restore'

export interface UploadResponse {
  /** 실제 저장된 경로 (이름 충돌 시 " (1)" 붙은 최종본) */
  path: string
  name: string
}

export interface MkdirBody {
  /** 부모 폴더 경로 */
  path: string
  name: string
}

export interface MkdirResponse {
  path: string
}

export interface RenameBody {
  path: string
  newName: string
}

export interface RenameResponse {
  path: string
}

export interface MoveBody {
  paths: string[]
  destDir: string
}

export interface CopyBody {
  paths: string[]
  destDir: string
}

export interface TrashBody {
  paths: string[]
}

export interface RestoreBody {
  trashIds: string[]
}

/** move/copy/trash/restore 공통 — 항목별 성공/실패 */
export interface BatchResult {
  path: string
  ok: boolean
  error?: string
  newPath?: string
}

export interface BatchResponse {
  results: BatchResult[]
}

export interface TrashItem {
  id: string
  originalPath: string
  name: string
  isDir: boolean
  deletedByName: string
  deletedAt: number
}

export interface TrashListResponse {
  items: TrashItem[]
}

// ─── 메타데이터 조회 (M3) ───────────────────────────────────

/** 검색·최근 파일 결과 공용 — FsEntry와 동일 형태 */
export interface SearchResponse {
  query: string
  entries: FsEntry[]
  /** 권한 필터 전 원본 매치 수 (더 있음 표시용) */
  truncated: boolean
}

export interface RecentResponse {
  entries: FsEntry[]
}

export interface ActivityItem {
  id: number
  action: ActivityAction
  actorName: string
  createdAt: number
  /** rename/move의 from 등 부가 정보 */
  detail: Record<string, unknown> | null
}

export interface ActivityResponse {
  path: string
  items: ActivityItem[]
}

// ─── 확장 스펙 R1~R4 ────────────────────────────────────────

export interface AclRuleDto {
  id: number
  pathPrefix: string
  roleId: string
  roleName?: string
  permission: 'read' | 'write'
  note: string | null
}

export interface RoleDto {
  id: string
  name: string
}

export interface UsageResponse {
  totalBytes: number
  freeBytes: number
  /** admin 전용 — 최상위 폴더별 사용량 (파일 합계) */
  folders?: Array<{ path: string; bytes: number }>
}

export interface AdminActivityItem extends ActivityItem {
  path: string
}

export interface AdminActivityResponse {
  items: AdminActivityItem[]
}

export interface CreateShareBody {
  path: string
  /** 만료까지 일수 (1/7/30) */
  expiresDays: number
}

export interface ShareLinkDto {
  token: string
  path: string
  name: string
  /** 전체 공유 URL */
  url: string
  createdAt: number
  expiresAt: number
  downloadCount: number
  expired: boolean
}

export interface ShareListResponse {
  links: ShareLinkDto[]
}

export interface VersionDto {
  /** .versions 안의 파일명 = "{ts}_{원본이름}" */
  id: string
  mtime: number
  size: number
}

export interface VersionListResponse {
  path: string
  versions: VersionDto[]
}

export interface PinDto {
  path: string
  name: string
  isDir: boolean
}

export interface PinListResponse {
  pins: PinDto[]
}
