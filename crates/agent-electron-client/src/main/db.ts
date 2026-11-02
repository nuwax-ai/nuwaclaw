import * as path from 'path';
import { app } from 'electron';
import Database from 'better-sqlite3';
import log from 'electron-log';
import { APP_DATA_DIR_NAME } from './services/constants';
import { APP_NAME_IDENTIFIER } from '@shared/constants';

const nuwaxHome = path.join(app.getPath('home'), APP_DATA_DIR_NAME);
const dbPath = path.join(nuwaxHome, `${APP_NAME_IDENTIFIER}.db`);

let db: Database.Database | null = null;

export function initDatabase(): void {
  try {
    db = new Database(dbPath);
    log.info('Database initialized at:', dbPath);

    // Create tables
    db.exec(`
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);
    log.info('Database tables created');
  } catch (error) {
    log.error('Database initialization failed:', error);
  }
}

export function getDb(): Database.Database | null {
  return db;
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
    log.info('[App] Database closed');
  }
}

export function readSetting(key: string): unknown {
  const row = db?.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
  if (!row?.value) return null;
  try { return JSON.parse(row.value); } catch { return row.value; }
}

export function writeSetting(key: string, value: unknown): boolean {
  if (!db) return false;
  if (value === null || value === undefined) {
    db.prepare('DELETE FROM settings WHERE key = ?').run(key);
  } else {
    db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, JSON.stringify(value));
  }
  return true;
}
