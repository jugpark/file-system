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

export const folderAcl = sqliteTable('folder_acl', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  /** '/design' 형태의 정규화 경로 prefix */
  pathPrefix: text('path_prefix').notNull(),
  /** Discord role ID */
  roleId: text('role_id').notNull(),
  permission: text('permission', { enum: ['read', 'write'] }).notNull(),
  note: text('note'),
})
