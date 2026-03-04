/**
 * Memory File Sync Module
 *
 * File watching and hash-based synchronization
 * Based on specs/long-memory/long-memory.md
 */

import * as path from 'path';
import * as fs from 'fs';
import { EventEmitter } from 'events';
import chokidar, { FSWatcher } from 'chokidar';
import log from 'electron-log';
import type { MemoryChunk, SyncResult, SyncState, MemorySource } from './types';
import { MemoryDatabase } from './MemoryDatabase';
import {
  CORE_MEMORY_FILE,
  DAILY_MEMORY_DIR,
  WATCH_DEBOUNCE_MS,
  DEFAULT_SYNC_STATE,
} from './constants';
import { calculateHash } from './utils/hash';
import { chunkMarkdown, compareChunks } from './utils/chunker';

// ==================== Types ====================

interface FileSyncOptions {
  workspaceDir: string;
  database: MemoryDatabase;
  debounceMs?: number;
}

interface PendingSync {
  filePath: string;
  eventType: 'add' | 'change' | 'unlink';
  timestamp: number;
}

// ==================== MemoryFileSync Class ====================

export class MemoryFileSync extends EventEmitter {
  private workspaceDir: string = '';
  private database: MemoryDatabase | null = null;
  private watcher: FSWatcher | null = null;
  private debounceMs: number;
  private debounceTimers: Map<string, NodeJS.Timeout> = new Map();
  private pendingSyncs: Map<string, PendingSync> = new Map();
  private initialized: boolean = false;

  constructor() {
    super();
    this.debounceMs = WATCH_DEBOUNCE_MS;
  }

  /**
   * Initialize file sync
   */
  async init(options: FileSyncOptions): Promise<void> {
    this.workspaceDir = options.workspaceDir;
    this.database = options.database;
    this.debounceMs = options.debounceMs ?? WATCH_DEBOUNCE_MS;

    // Ensure directories exist
    this.ensureDirectories();

    // Start file watcher
    this.startWatcher();

    this.initialized = true;
    log.info('[MemoryFileSync] Initialized for:', this.workspaceDir);
  }

  /**
   * Destroy file sync
   */
  destroy(): void {
    this.stopWatcher();
    this.clearAllTimers();
    this.initialized = false;
    log.info('[MemoryFileSync] Destroyed');
  }

  /**
   * Check if initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  // ==================== Directory Management ====================

  /**
   * Ensure memory directories exist
   */
  private ensureDirectories(): void {
    const coreFile = this.getCoreMemoryPath();
    const dailyDir = this.getDailyMemoryDir();

    // Create daily memory directory
    if (!fs.existsSync(dailyDir)) {
      fs.mkdirSync(dailyDir, { recursive: true });
      log.info('[MemoryFileSync] Created daily memory directory:', dailyDir);
    }

    // Create core memory file if not exists
    if (!fs.existsSync(coreFile)) {
      const defaultContent = this.getDefaultCoreMemoryContent();
      fs.writeFileSync(coreFile, defaultContent, 'utf8');
      log.info('[MemoryFileSync] Created core memory file:', coreFile);
    }
  }

  /**
   * Get default MEMORY.md content
   */
  private getDefaultCoreMemoryContent(): string {
    return `# 长期记忆

> 此文件由 Nuwax Agent 自动生成，你可以直接编辑此文件。

## 用户档案

## 偏好

## 项目相关

## 重要决策

---
*最后更新: ${new Date().toISOString().split('T')[0]}*
`;
  }

  /**
   * Get core memory file path
   */
  getCoreMemoryPath(): string {
    return path.join(this.workspaceDir, CORE_MEMORY_FILE);
  }

  /**
   * Get daily memory directory
   */
  getDailyMemoryDir(): string {
    return path.join(this.workspaceDir, DAILY_MEMORY_DIR);
  }

  /**
   * Get daily memory file path for a specific date
   */
  getDailyMemoryPath(date?: Date): string {
    const d = date ?? new Date();
    const dateStr = d.toISOString().split('T')[0]; // YYYY-MM-DD
    return path.join(this.getDailyMemoryDir(), `${dateStr}.md`);
  }

  // ==================== File Watching ====================

  /**
   * Start file watcher
   */
  private startWatcher(): void {
    if (this.watcher) {
      return;
    }

    const watchPatterns = [
      this.getCoreMemoryPath(),
      path.join(this.getDailyMemoryDir(), '*.md'),
    ];

    this.watcher = chokidar.watch(watchPatterns, {
      ignored: /(^|[\/\\])\../, // Ignore dotfiles
      persistent: true,
      ignoreInitial: true, // Don't trigger on initial scan
      awaitWriteFinish: {
        stabilityThreshold: 500,
        pollInterval: 100,
      },
    });

    this.watcher
      .on('add', (filePath) => this.handleFileEvent(filePath, 'add'))
      .on('change', (filePath) => this.handleFileEvent(filePath, 'change'))
      .on('unlink', (filePath) => this.handleFileEvent(filePath, 'unlink'))
      .on('error', (error) => {
        log.error('[MemoryFileSync] Watcher error:', error);
        this.emit('error', error);
      });

    log.info('[MemoryFileSync] Watcher started');
  }

  /**
   * Stop file watcher
   */
  private stopWatcher(): void {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
      log.info('[MemoryFileSync] Watcher stopped');
    }
  }

  /**
   * Handle file system event
   */
  private handleFileEvent(filePath: string, eventType: 'add' | 'change' | 'unlink'): void {
    log.debug(`[MemoryFileSync] File event: ${eventType} - ${filePath}`);

    // Mark as dirty
    this.database?.setSyncState({ dirty: true });

    // Debounce the sync
    this.debounceSync(filePath, eventType);
  }

  /**
   * Debounce sync operation
   */
  private debounceSync(filePath: string, eventType: 'add' | 'change' | 'unlink'): void {
    // Clear existing timer for this file
    const existingTimer = this.debounceTimers.get(filePath);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    // Store pending sync
    this.pendingSyncs.set(filePath, {
      filePath,
      eventType,
      timestamp: Date.now(),
    });

    // Set new timer
    const timer = setTimeout(() => {
      this.debounceTimers.delete(filePath);
      this.processPendingSync(filePath);
    }, this.debounceMs);

    this.debounceTimers.set(filePath, timer);
  }

  /**
   * Process pending sync for a file
   */
  private async processPendingSync(filePath: string): Promise<void> {
    const pending = this.pendingSyncs.get(filePath);
    if (!pending) return;

    this.pendingSyncs.delete(filePath);

    try {
      await this.syncFile(filePath, pending.eventType);
    } catch (error) {
      log.error('[MemoryFileSync] Failed to sync file:', filePath, error);
      this.emit('sync:error', { filePath, error });
    }
  }

  /**
   * Clear all timers
   */
  private clearAllTimers(): void {
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();
    this.pendingSyncs.clear();
  }

  // ==================== Sync Operations ====================

  /**
   * Sync on startup (full hash verification)
   */
  async syncOnStartup(): Promise<SyncResult> {
    log.info('[MemoryFileSync] Starting startup sync...');

    const result: SyncResult = {
      added: 0,
      removed: 0,
      unchanged: 0,
      errors: [],
    };

    try {
      // Get all existing memory files
      const files = this.getAllMemoryFiles();
      const db = this.database!;

      // Check each file
      for (const filePath of files) {
        try {
          const syncResult = await this.syncFileWithHashCheck(filePath);
          result.added += syncResult.added;
          result.removed += syncResult.removed;
          result.unchanged += syncResult.unchanged;
        } catch (error) {
          result.errors.push(`${filePath}: ${error}`);
        }
      }

      // Check for deleted files
      const deletedResult = await this.checkDeletedFiles(files);
      result.removed += deletedResult;

      // Update sync state
      db.setSyncState({
        dirty: false,
        syncing: false,
        lastSyncTime: Date.now(),
      });

      log.info('[MemoryFileSync] Startup sync complete:', result);
      this.emit('sync:complete', result);
    } catch (error) {
      log.error('[MemoryFileSync] Startup sync failed:', error);
      result.errors.push(String(error));
    }

    return result;
  }

  /**
   * Sync a single file
   */
  async syncFile(filePath: string, eventType: 'add' | 'change' | 'unlink'): Promise<SyncResult> {
    const result: SyncResult = {
      added: 0,
      removed: 0,
      unchanged: 0,
      errors: [],
    };

    const db = this.database!;
    const relativePath = path.relative(this.workspaceDir, filePath);

    if (eventType === 'unlink') {
      // File deleted
      const deleted = db.deleteBySourcePath(relativePath);
      db.deleteFileHash(relativePath);
      result.removed = deleted;
    } else {
      // File added or changed
      const syncResult = await this.syncFileWithHashCheck(filePath);
      result.added = syncResult.added;
      result.removed = syncResult.removed;
      result.unchanged = syncResult.unchanged;
    }

    // Update sync state
    db.setSyncState({
      dirty: false,
      lastSyncTime: Date.now(),
    });

    this.emit('sync:file', { filePath, result });
    return result;
  }

  /**
   * Sync file with hash check
   */
  private async syncFileWithHashCheck(filePath: string): Promise<SyncResult> {
    const result: SyncResult = {
      added: 0,
      removed: 0,
      unchanged: 0,
      errors: [],
    };

    const db = this.database!;
    const relativePath = path.relative(this.workspaceDir, filePath);

    // Check if file exists
    if (!fs.existsSync(filePath)) {
      return result;
    }

    // Read file content
    const content = fs.readFileSync(filePath, 'utf8');
    const fileHash = calculateHash(content);
    const stats = fs.statSync(filePath);

    // Check if file has changed
    const existingHash = db.getFileHash(relativePath);
    if (existingHash && existingHash.hash === fileHash) {
      result.unchanged = existingHash.chunkCount;
      return result;
    }

    // Determine source type
    const source: MemorySource = path.basename(filePath) === CORE_MEMORY_FILE ? 'core' : 'daily';

    // Parse and chunk file
    const newChunks = chunkMarkdown(content, relativePath);

    // Get existing chunks from database
    const existingMemories = db.getMemories({
      status: 'active',
      source,
    }).filter(m => m.sourcePath === relativePath);

    const oldChunks: MemoryChunk[] = existingMemories.map(m => ({
      text: m.text,
      hash: m.fingerprint,
      startLine: m.startLine!,
      endLine: m.endLine!,
    }));

    // Compare chunks
    const { added, removed, unchanged } = compareChunks(oldChunks, newChunks);

    // Delete removed chunks
    for (const removedHash of removed) {
      const memory = existingMemories.find(m => m.fingerprint === removedHash);
      if (memory) {
        db.deleteMemory(memory.id);
        result.removed++;
      }
    }

    // Insert added chunks
    for (const chunk of added) {
      const entry = db.createEntryFromChunk(chunk, source, relativePath);
      db.insertMemory(entry);
      result.added++;
    }

    result.unchanged = unchanged.length;

    // Update file hash record
    db.setFileHash({
      path: relativePath,
      hash: fileHash,
      chunkCount: newChunks.length,
      lastModified: stats.mtimeMs,
      syncedAt: Date.now(),
    });

    return result;
  }

  /**
   * Check for files that have been deleted
   */
  private async checkDeletedFiles(existingFiles: string[]): Promise<number> {
    const db = this.database!;
    const dbHashes = db.getAllFileHashes();
    let deleted = 0;

    const existingRelativePaths = new Set(
      existingFiles.map(f => path.relative(this.workspaceDir, f))
    );

    for (const record of dbHashes) {
      if (!existingRelativePaths.has(record.path)) {
        // File has been deleted
        const removed = db.deleteBySourcePath(record.path);
        db.deleteFileHash(record.path);
        deleted += removed;
      }
    }

    return deleted;
  }

  /**
   * Rebuild entire index
   */
  async rebuildIndex(): Promise<SyncResult> {
    log.info('[MemoryFileSync] Rebuilding index...');

    const result: SyncResult = {
      added: 0,
      removed: 0,
      unchanged: 0,
      errors: [],
    };

    const db = this.database!;

    // Clear all existing data
    // Note: This is a destructive operation
    const dbInstance = db.getDb();
    if (dbInstance) {
      dbInstance.exec('DELETE FROM memories');
      dbInstance.exec('DELETE FROM file_hashes');
    }

    // Re-sync all files
    const files = this.getAllMemoryFiles();
    for (const filePath of files) {
      try {
        const syncResult = await this.syncFileWithHashCheck(filePath);
        result.added += syncResult.added;
        result.removed += syncResult.removed;
        result.unchanged += syncResult.unchanged;
      } catch (error) {
        result.errors.push(`${filePath}: ${error}`);
      }
    }

    // Update sync state
    db.setSyncState({
      dirty: false,
      syncing: false,
      lastSyncTime: Date.now(),
    });

    log.info('[MemoryFileSync] Index rebuild complete:', result);
    this.emit('rebuild:complete', result);

    return result;
  }

  // ==================== File Operations ====================

  /**
   * Get all memory files
   */
  getAllMemoryFiles(): string[] {
    const files: string[] = [];

    // Core memory file
    const corePath = this.getCoreMemoryPath();
    if (fs.existsSync(corePath)) {
      files.push(corePath);
    }

    // Daily memory files
    const dailyDir = this.getDailyMemoryDir();
    if (fs.existsSync(dailyDir)) {
      const dailyFiles = fs.readdirSync(dailyDir)
        .filter(f => f.endsWith('.md') && /^\d{4}-\d{2}-\d{2}\.md$/.test(f))
        .map(f => path.join(dailyDir, f));
      files.push(...dailyFiles);
    }

    return files;
  }

  /**
   * Append to daily memory file and sync to database
   */
  appendToDailyMemory(content: string, title?: string): string {
    const filePath = this.getDailyMemoryPath();
    const now = new Date();
    const timeStr = now.toTimeString().slice(0, 5); // HH:MM
    const sessionTitle = title ?? '会话';

    // Build content to append
    const appendContent = `
---

### ${timeStr} ${sessionTitle}
${content}
`;

    // Create file if not exists
    if (!fs.existsSync(filePath)) {
      const dateStr = now.toISOString().split('T')[0];
      const header = `# ${dateStr}\n\n---\n`;
      fs.writeFileSync(filePath, header, 'utf8');
    }

    // Append content
    fs.appendFileSync(filePath, appendContent, 'utf8');

    log.info('[MemoryFileSync] Appended to daily memory:', filePath);

    // Immediately sync this file to database for real-time retrieval
    this.syncFileImmediate(filePath, content, sessionTitle);

    return filePath;
  }

  /**
   * Immediately sync appended content to database (without re-reading file)
   */
  private syncFileImmediate(filePath: string, content: string, title: string): void {
    if (!this.database) return;

    try {
      // Parse the appended content into individual memories
      const lines = content.split('\n').filter(line => line.trim().startsWith('- '));

      for (const line of lines) {
        const memoryText = line.replace(/^-\s*/, '').trim();
        if (!memoryText || memoryText.length < 2) continue;

        // Generate memory entry
        const now = Date.now();
        const fingerprint = calculateHash(memoryText);
        const relativePath = path.relative(this.workspaceDir, filePath).replace(/\\/g, '/');

        const entry = {
          id: `mem_${fingerprint}`,
          text: memoryText,
          fingerprint,
          category: 'fact' as const,
          confidence: 0.75,
          isExplicit: true,
          importance: 0.5,
          source: 'daily' as const,
          sourcePath: relativePath,
          status: 'active' as const,
          accessCount: 0,
          createdAt: now,
          updatedAt: now,
        };

        // Check if already exists
        const exists = this.database.existsByFingerprint(fingerprint);
        if (!exists) {
          this.database.insertMemory(entry);
          log.debug('[MemoryFileSync] Inserted memory to database:', memoryText.slice(0, 50));
        }
      }

      log.info('[MemoryFileSync] Synced %d memories to database from append', lines.length);
    } catch (error) {
      log.error('[MemoryFileSync] Failed to sync appended content to database:', error);
    }
  }

  /**
   * Read core memory file
   */
  readCoreMemory(): string {
    const filePath = this.getCoreMemoryPath();
    if (fs.existsSync(filePath)) {
      return fs.readFileSync(filePath, 'utf8');
    }
    return '';
  }

  /**
   * Write core memory file
   */
  writeCoreMemory(content: string): void {
    const filePath = this.getCoreMemoryPath();
    fs.writeFileSync(filePath, content, 'utf8');
    log.info('[MemoryFileSync] Wrote core memory:', filePath);
  }

  /**
   * Read daily memory files for recent days
   */
  readRecentDailyMemories(days: number = 2): Map<string, string> {
    const result = new Map<string, string>();

    for (let i = 0; i < days; i++) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      const filePath = this.getDailyMemoryPath(date);

      if (fs.existsSync(filePath)) {
        const content = fs.readFileSync(filePath, 'utf8');
        const dateStr = date.toISOString().split('T')[0];
        result.set(dateStr, content);
      }
    }

    return result;
  }

  /**
   * Delete old daily memory files
   */
  deleteOldDailyFiles(retentionDays: number): number {
    const dailyDir = this.getDailyMemoryDir();
    if (!fs.existsSync(dailyDir)) {
      return 0;
    }

    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - retentionDays);
    const cutoffStr = cutoffDate.toISOString().split('T')[0];

    let deleted = 0;
    const files = fs.readdirSync(dailyDir)
      .filter(f => f.endsWith('.md') && /^\d{4}-\d{2}-\d{2}\.md$/.test(f));

    for (const file of files) {
      const dateStr = file.replace('.md', '');
      if (dateStr < cutoffStr) {
        const filePath = path.join(dailyDir, file);
        fs.unlinkSync(filePath);

        // Also delete from database
        this.database?.deleteBySourcePath(file);

        deleted++;
        log.info('[MemoryFileSync] Deleted old daily file:', file);
      }
    }

    return deleted;
  }

  /**
   * Get sync state
   */
  getSyncState(): SyncState {
    return this.database?.getSyncState() ?? DEFAULT_SYNC_STATE;
  }
}

// Export singleton
export const memoryFileSync = new MemoryFileSync();
