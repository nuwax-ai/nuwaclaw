import { ipcMain } from 'electron';
import { getDb } from '../db';

export function registerMessageHandlers(): void {
  ipcMain.handle('message:list', (_, sessionId: string) => {
    const db = getDb();
    if (!db) return [];
    const stmt = db.prepare('SELECT * FROM messages WHERE session_id = ? ORDER BY created_at ASC');
    return stmt.all(sessionId);
  });

  ipcMain.handle('message:add', (_, message: { id: string; session_id: string; role: string; content: string }) => {
    const db = getDb();
    if (!db) return null;
    const now = Date.now();
    const stmt = db.prepare(
      'INSERT INTO messages (id, session_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)'
    );
    stmt.run(message.id, message.session_id, message.role, message.content, now);

    // Update session timestamp
    db.prepare('UPDATE sessions SET updated_at = ? WHERE id = ?').run(now, message.session_id);

    return { ...message, created_at: now };
  });
}
