import { db } from './pool.js';
import { randomUUID } from 'crypto';
import { hashPassword } from '../services/password.js';

const migrations = `
-- Users table (simplified - no credits, no stripe, no tiers)
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT,
  bio TEXT,
  avatar_url TEXT,
  banner_url TEXT,
  is_admin INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Songs table
CREATE TABLE IF NOT EXISTS songs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  lyrics TEXT,
  style TEXT,
  caption TEXT,
  cover_url TEXT,
  audio_url TEXT,
  duration INTEGER,
  bpm INTEGER,
  key_scale TEXT,
  time_signature TEXT,
  tags TEXT DEFAULT '[]',
  is_public INTEGER DEFAULT 0,
  is_featured INTEGER DEFAULT 0,
  like_count INTEGER DEFAULT 0,
  view_count INTEGER DEFAULT 0,
  has_video INTEGER DEFAULT 0,
  video_url TEXT,
  generation_params TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Generation jobs table (simplified - no credit_reserved)
CREATE TABLE IF NOT EXISTS generation_jobs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  acestep_task_id TEXT,
  status TEXT DEFAULT 'pending',
  params TEXT,
  result TEXT,
  error TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Playlists table
CREATE TABLE IF NOT EXISTS playlists (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  cover_url TEXT,
  is_public INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Playlist songs junction table
CREATE TABLE IF NOT EXISTS playlist_songs (
  playlist_id TEXT NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
  song_id TEXT NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
  position INTEGER NOT NULL DEFAULT 0,
  added_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (playlist_id, song_id)
);

-- Liked songs table
CREATE TABLE IF NOT EXISTS liked_songs (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  song_id TEXT NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
  liked_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, song_id)
);

-- Reference tracks (uploaded audio for use as references)
CREATE TABLE IF NOT EXISTS reference_tracks (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  storage_key TEXT NOT NULL,
  duration INTEGER,
  file_size_bytes INTEGER,
  tags TEXT DEFAULT '[]',
  created_at TEXT DEFAULT (datetime('now'))
);

-- Virtual singer profiles
CREATE TABLE IF NOT EXISTS virtual_singers (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  style_tags TEXT DEFAULT '[]',
  default_language TEXT DEFAULT 'zh',
  gender TEXT DEFAULT 'unspecified',
  persona_prompt TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  avatar_url TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- One active voice binding per singer
CREATE TABLE IF NOT EXISTS singer_voice_binding (
  singer_id TEXT PRIMARY KEY REFERENCES virtual_singers(id) ON DELETE CASCADE,
  adapter_path TEXT NOT NULL,
  export_path TEXT,
  output_dir TEXT,
  dataset_name TEXT,
  training_meta TEXT DEFAULT '{}',
  bound_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_songs_user_id ON songs(user_id);
CREATE INDEX IF NOT EXISTS idx_songs_created_at ON songs(created_at);
CREATE INDEX IF NOT EXISTS idx_songs_is_public ON songs(is_public);
CREATE INDEX IF NOT EXISTS idx_songs_is_featured ON songs(is_featured);
CREATE INDEX IF NOT EXISTS idx_generation_jobs_user_id ON generation_jobs(user_id);
CREATE INDEX IF NOT EXISTS idx_generation_jobs_status ON generation_jobs(status);
CREATE INDEX IF NOT EXISTS idx_generation_jobs_created_at ON generation_jobs(created_at);
CREATE INDEX IF NOT EXISTS idx_playlists_user_id ON playlists(user_id);
CREATE INDEX IF NOT EXISTS idx_reference_tracks_user_id ON reference_tracks(user_id);
CREATE INDEX IF NOT EXISTS idx_reference_tracks_created_at ON reference_tracks(created_at);
CREATE INDEX IF NOT EXISTS idx_virtual_singers_user_id ON virtual_singers(user_id);
CREATE INDEX IF NOT EXISTS idx_virtual_singers_updated_at ON virtual_singers(updated_at);
`;

function columnExists(tableName: string, columnName: string): boolean {
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;
  return columns.some((column) => column.name === columnName);
}

function ensureColumn(tableName: string, columnName: string, definition: string): void {
  if (columnExists(tableName, columnName)) return;
  db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
}

function ensureAshUser(): void {
  const ashPasswordHash = hashPassword('123456');
  const existingAsh = db.prepare('SELECT id FROM users WHERE username = ?').get('ASH') as { id: string } | undefined;

  let ashId = existingAsh?.id;
  if (ashId) {
    db.prepare("UPDATE users SET password_hash = ?, updated_at = datetime('now') WHERE id = ?").run(ashPasswordHash, ashId);
  } else {
    ashId = randomUUID();
    db.prepare(
      `INSERT INTO users (id, username, password_hash, is_admin, created_at, updated_at)
       VALUES (?, 'ASH', ?, 1, datetime('now'), datetime('now'))`
    ).run(ashId, ashPasswordHash);
  }

  const legacyAssignment = db.prepare('SELECT value FROM app_settings WHERE key = ?').get('legacy_data_assigned_to_ash') as { value: string } | undefined;
  if (legacyAssignment?.value !== 'true') {
    db.prepare("UPDATE songs SET user_id = ?, updated_at = datetime('now')").run(ashId);
    db.prepare("UPDATE virtual_singers SET user_id = ?, updated_at = datetime('now')").run(ashId);
    db.prepare(
      `INSERT INTO app_settings (key, value, updated_at)
       VALUES ('legacy_data_assigned_to_ash', 'true', datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
    ).run();
  }
}

function migrate(): void {
  console.log('Running SQLite database migrations...');

  try {
    // Execute the entire migration script at once
    db.exec(migrations);
    ensureColumn('users', 'password_hash', 'TEXT');
    ensureColumn('songs', 'singer_id', 'TEXT REFERENCES virtual_singers(id) ON DELETE SET NULL');
    ensureColumn('songs', 'singer_name_snapshot', 'TEXT');
    ensureColumn('virtual_singers', 'gender', "TEXT DEFAULT 'unspecified'");
    db.exec(`CREATE INDEX IF NOT EXISTS idx_songs_singer_id ON songs(singer_id)`);
    ensureAshUser();
    console.log('Migrations completed successfully!');
  } catch (error) {
    // Check if it's just "already exists" errors
    const errorMsg = String(error);
    if (errorMsg.includes('already exists') || errorMsg.includes('duplicate column name')) {
      console.log('Tables already exist, migrations completed!');
    } else {
      console.error('Migration failed:', error);
      throw error;
    }
  }
}

// Run migrations
migrate();
