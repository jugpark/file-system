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
