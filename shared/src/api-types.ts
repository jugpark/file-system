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
}

export interface ApiErrorBody {
  error: { code: string; message: string }
}

// ─── 쓰기 작업 (M2) ─────────────────────────────────────────

export type ActivityAction = 'upload' | 'mkdir' | 'rename' | 'move' | 'copy' | 'trash' | 'restore'

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
