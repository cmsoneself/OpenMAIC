/**
 * Cloud sync SQLite database adapter (server-side only).
 *
 * Single-file SQLite via better-sqlite3 (synchronous, fast, zero-config).
 * Lazily initialized on first call so that importing this module on the
 * client is a no-op (the adapter is only exercised from API routes which
 * always run on the server runtime).
 *
 * Tables:
 *   - users:      one row per invitation code holder
 *   - classrooms: metadata index of uploaded .maic.zip blobs
 *   - sessions:   opaque session tokens issued after invite-code login
 *
 * The actual zip payloads are NOT stored in SQLite (kept on disk by the
 * file-storage adapter in storage.ts) so the DB stays tiny and easy to
 * back up.
 */
import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";

import { getCloudServerConfig } from "./cloud-config";

export interface UserRow {
  id: string;
  invite_code_hash: string;
  display_name: string | null;
  created_at: number;
}

export interface ClassroomRow {
  id: string; // server-issued uuid
  owner_id: string;
  title: string;
  description: string | null;
  size_bytes: number;
  sha256: string;
  created_at: number;
  updated_at: number;
}

export interface SessionRow {
  token: string;
  user_id: string;
  created_at: number;
  expires_at: number;
}

let _db: Database.Database | null = null;
let _dbPath: string | null = null;

function ensureDir(dir: string) {
  try {
    mkdirSync(dir, { recursive: true });
  } catch {
    // existing dir is fine
  }
}

export function getDbPath(): string {
  const { dataDir } = getCloudServerConfig();
  return resolve(join(dataDir, "cloud.sqlite"));
}

export function getDb(): Database.Database {
  const dbPath = getDbPath();
  // Re-open if dataDir env changed at runtime (mostly relevant for tests).
  if (_db && _dbPath === dbPath) return _db;
  if (_db && _dbPath !== dbPath) {
    _db.close();
    _db = null;
  }

  ensureDir(getCloudServerConfig().dataDir);

  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      invite_code_hash TEXT NOT NULL UNIQUE,
      display_name TEXT,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS classrooms (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      size_bytes INTEGER NOT NULL DEFAULT 0,
      sha256 TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_classrooms_owner
      ON classrooms(owner_id, updated_at DESC);

    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_expires
      ON sessions(expires_at);
  `);

  _db = db;
  _dbPath = dbPath;
  return db;
}

/** Close the connection (mostly for tests / graceful shutdown). */
export function closeDb(): void {
  if (_db) {
    _db.close();
    _db = null;
    _dbPath = null;
  }
}
