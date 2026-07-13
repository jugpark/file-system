import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { config } from '../config'
import * as schema from './schema'

const sqlite = new Database(config.databasePath)
sqlite.pragma('journal_mode = WAL')
sqlite.pragma('foreign_keys = ON')

// M1 스키마. 마이그레이션 도구 없이 idempotent DDL로 관리 (M2에서 테이블 추가 시 여기 append)
sqlite.exec(`
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  avatar_url TEXT,
  created_at INTEGER NOT NULL,
  last_login_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  roles_json TEXT NOT NULL,
  roles_fetched_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
CREATE TABLE IF NOT EXISTS file_meta (
  path TEXT PRIMARY KEY,
  uploader_id TEXT NOT NULL,
  uploaded_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS activity_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  path TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('upload','mkdir','rename','move','copy','trash','restore')),
  detail_json TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_activity_path ON activity_log(path);
CREATE TABLE IF NOT EXISTS trash (
  id TEXT PRIMARY KEY,
  original_path TEXT NOT NULL,
  is_dir INTEGER NOT NULL,
  deleted_by TEXT NOT NULL,
  deleted_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS fs_index (
  path TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  name_search TEXT NOT NULL,
  parent TEXT NOT NULL,
  is_dir INTEGER NOT NULL,
  size INTEGER NOT NULL,
  mtime INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_fs_index_parent ON fs_index(parent);
CREATE INDEX IF NOT EXISTS idx_fs_index_mtime ON fs_index(mtime);
CREATE TABLE IF NOT EXISTS folder_acl (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  path_prefix TEXT NOT NULL,
  role_id TEXT NOT NULL,
  permission TEXT NOT NULL CHECK (permission IN ('read','write')),
  note TEXT
);
`)

export const db = drizzle(sqlite, { schema })
export { sqlite }
