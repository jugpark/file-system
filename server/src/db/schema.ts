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
    ],
  }).notNull(),
  detailJson: text('detail_json'),
  createdAt: integer('created_at').notNull(),
})

export const shareLinks = sqliteTable('share_links', {
  token: text('token').primaryKey(),
  path: text('path').notNull(),
  createdBy: text('created_by').notNull(),
  createdAt: integer('created_at').notNull(),
  expiresAt: integer('expires_at').notNull(),
  downloadCount: integer('download_count').notNull().default(0),
})

export const pinnedPaths = sqliteTable('pinned_paths', {
  userId: text('user_id').notNull(),
  path: text('path').notNull(),
  createdAt: integer('created_at').notNull(),
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
