import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const users = sqliteTable('users', {
  /** Discord user ID */
  id: text('id').primaryKey(),
  username: text('username').notNull(),
  avatarUrl: text('avatar_url'),
  createdAt: integer('created_at').notNull(),
  lastLoginAt: integer('last_login_at').notNull(),
})

export const sessions = sqliteTable('sessions', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  /** JSON string[] — Discord role ID 목록 캐시 */
  rolesJson: text('roles_json').notNull(),
  rolesFetchedAt: integer('roles_fetched_at').notNull(),
  expiresAt: integer('expires_at').notNull(),
  createdAt: integer('created_at').notNull(),
  /** 세션 관리 표시용 — 로그인 기기의 User-Agent */
  userAgent: text('user_agent'),
  /** 마지막 요청 시각 (스로틀 갱신) */
  lastSeenAt: integer('last_seen_at'),
})

export const fileMeta = sqliteTable('file_meta', {
  /** 스토리지 루트 기준 상대 경로 */
  path: text('path').primaryKey(),
  uploaderId: text('uploader_id').notNull(),
  uploadedAt: integer('uploaded_at').notNull(),
})

export const activityLog = sqliteTable('activity_log', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  path: text('path').notNull(),
  actorId: text('actor_id').notNull(),
  action: text('action', {
    enum: [
      'upload', 'mkdir', 'rename', 'move', 'copy', 'trash', 'restore',
      'acl_change', 'share_create', 'share_revoke', 'version_restore', 'settings_change',
      'download', 'trash_purge',
    ],
  }).notNull(),
  detailJson: text('detail_json'),
  createdAt: integer('created_at').notNull(),
})

export const shareLinks = sqliteTable('share_links', {
  token: text('token').primaryKey(),
  /** download=파일 받아가기 / upload=파일 요청(폴더로 무인증 업로드) */
  kind: text('kind', { enum: ['download', 'upload'] }).notNull().default('download'),
  path: text('path').notNull(),
  createdBy: text('created_by').notNull(),
  createdAt: integer('created_at').notNull(),
  expiresAt: integer('expires_at').notNull(),
  /** download=다운로드 횟수, upload=받은 파일 수 */
  downloadCount: integer('download_count').notNull().default(0),
})

export const pinnedPaths = sqliteTable('pinned_paths', {
  userId: text('user_id').notNull(),
  path: text('path').notNull(),
  createdAt: integer('created_at').notNull(),
})

/** 폴더 구독 — 구독 폴더 아래 업로드/삭제 시 Discord DM (본인 행동은 제외) */
export const subscriptions = sqliteTable('subscriptions', {
  userId: text('user_id').notNull(),
  path: text('path').notNull(),
  createdAt: integer('created_at').notNull(),
})

/** 접근 요청 — 못 보는/읽기전용 폴더에 대해 유저가 권한을 신청, admin이 처리 */
export const accessRequests = sqliteTable('access_requests', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: text('user_id').notNull(),
  path: text('path').notNull(),
  permission: text('permission', { enum: ['read', 'write'] }).notNull(),
  note: text('note'),
  status: text('status', { enum: ['pending', 'approved', 'denied'] }).notNull().default('pending'),
  createdAt: integer('created_at').notNull(),
  resolvedBy: text('resolved_by'),
  resolvedAt: integer('resolved_at'),
})

/** 런타임 서버 설정 (storageRoot 등) — env보다 우선 */
export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
})

export const trash = sqliteTable('trash', {
  /** 실체는 .trash/{id} 에 저장 */
  id: text('id').primaryKey(),
  originalPath: text('original_path').notNull(),
  isDir: integer('is_dir', { mode: 'boolean' }).notNull(),
  deletedBy: text('deleted_by').notNull(),
  deletedAt: integer('deleted_at').notNull(),
  /** bytes — 컬럼 추가 이전 행은 null, 목록 조회 시 lazy 백필 */
  size: integer('size'),
})

export const folderAcl = sqliteTable('folder_acl', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  /** '/design' 형태의 정규화 경로 prefix */
  pathPrefix: text('path_prefix').notNull(),
  /** Discord role ID */
  roleId: text('role_id').notNull(),
  permission: text('permission', { enum: ['read', 'write'] }).notNull(),
  note: text('note'),
})
