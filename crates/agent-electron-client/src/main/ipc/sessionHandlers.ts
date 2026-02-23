import { ipcMain } from 'electron';
import { getDb } from '../db';

export function registerSessionHandlers(): void {
  ipcMain.handle('session:list', () => {
    const db = getDb();
    if (!db) return [];
    const stmt = db.prepare('SELECT * FROM sessions ORDER BY updated_at DESC');
    return stmt.all();
  });

  ipcMain.handle('session:create', (_, session: { id: string; title: string; model: string; system_prompt?: string }) => {
    const db = getDb();
    if (!db) return null;
    const now = Date.now();
    const stmt = db.prepare(
      'INSERT INTO sessions (id, created_at, updated_at, title, model, system_prompt) VALUES (?, ?, ?, ?, ?, ?)'
    );
    stmt.run(session.id, now, now, session.title, session.model, session.system_prompt || null);
    return { ...session, created_at: now, updated_at: now };
  });

  ipcMain.handle('session:delete', (_, sessionId: string) => {
    const db = getDb();
    if (!db) return false;
    db.prepare('DELETE FROM messages WHERE session_id = ?').run(sessionId);
    db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
    return true;
  });
}
