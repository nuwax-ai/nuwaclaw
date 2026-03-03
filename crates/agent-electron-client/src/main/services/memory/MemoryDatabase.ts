/**
 * Memory Database Module
 *
 * SQLite + sqlite-vec management for long-term memory
 * Based on specs/long-memory/long-memory.md
 */

import * as path from 'path';
import * as fs from 'fs';
import Database from 'better-sqlite3';
import log from 'electron-log';
import type {
  MemoryEntry,
  MemoryEntryRow,
  MemoryConfig,
  SyncState,
  FileHashRecord,
  MemoryChunk,
  SyncResult,
  MemorySearchResult,
  MemorySource,
  VectorAvailability,
} from './types';
import {
  META_KEYS,
  SCHEMA_VERSION,
  MEMORY_STATUS,
  DEFAULT_SYNC_STATE,
} from './constants';
import { generateMemoryId, calculateHash } from './utils/hash';
import { float32ToBuffer, bufferToFloat32, cosineSimilarity } from './utils/vector';

// ==================== Schema SQL ====================

const SCHEMA_SQL = `
-- 1. Meta table (created first)
CREATE TABLE IF NOT EXISTS memory_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- 2. Core memories table
CREATE TABLE IF NOT EXISTS memories (
  id TEXT PRIMARY KEY,
  text TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'fact',
  confidence REAL NOT NULL DEFAULT 0.75,
  is_explicit INTEGER NOT NULL DEFAULT 0,
  importance REAL NOT NULL DEFAULT 0.5,
  source TEXT NOT NULL,
  source_path TEXT NOT NULL,
  start_line INTEGER,
  end_line INTEGER,
  embedding BLOB,
  embedding_model TEXT,
  embedding_dims INTEGER,
  status TEXT NOT NULL DEFAULT 'active',
  access_count INTEGER NOT NULL DEFAULT 0,
  last_accessed_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- 3. Indexes
CREATE INDEX IF NOT EXISTS idx_memories_source ON memories(source, source_path);
CREATE INDEX IF NOT EXISTS idx_memories_status ON memories(status);
CREATE INDEX IF NOT EXISTS idx_memories_fingerprint ON memories(fingerprint);
CREATE INDEX IF NOT EXISTS idx_memories_created ON memories(created_at DESC);

-- 4. FTS5 full-text index (unicode61 for Chinese support)
CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(
  text,
  content='memories',
  content_rowid='rowid',
  tokenize='unicode61'
);

-- 5. Embedding cache
CREATE TABLE IF NOT EXISTS embedding_cache (
  content_hash TEXT PRIMARY KEY,
  embedding BLOB NOT NULL,
  model TEXT NOT NULL,
  dims INTEGER NOT NULL,
  access_count INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  last_accessed_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_embedding_cache_accessed ON embedding_cache(last_accessed_at);

-- 6. File hash tracking
CREATE TABLE IF NOT EXISTS file_hashes (
  path TEXT PRIMARY KEY,
  hash TEXT NOT NULL,
  chunk_count INTEGER NOT NULL DEFAULT 0,
  last_modified INTEGER NOT NULL,
  synced_at INTEGER NOT NULL
);

-- 7. FTS5 sync triggers
CREATE TRIGGER IF NOT EXISTS memory_ai AFTER INSERT ON memories
WHEN NEW.status = 'active' BEGIN
  INSERT INTO memory_fts(rowid, text) VALUES (NEW.rowid, NEW.text);
END;

CREATE TRIGGER IF NOT EXISTS memory_ad AFTER DELETE ON memories BEGIN
  INSERT INTO memory_fts(memory_fts, rowid, text) VALUES ('delete', OLD.rowid, OLD.text);
END;

CREATE TRIGGER IF NOT EXISTS memory_au AFTER UPDATE ON memories
WHEN NEW.status = 'active' BEGIN
  INSERT INTO memory_fts(memory_fts, rowid, text) VALUES ('delete', OLD.rowid, OLD.text);
  INSERT INTO memory_fts(rowid, text) VALUES (NEW.rowid, NEW.text);
END;

CREATE TRIGGER IF NOT EXISTS memory_archive AFTER UPDATE OF status ON memories
WHEN OLD.status = 'active' AND NEW.status != 'active' BEGIN
  INSERT INTO memory_fts(memory_fts, rowid, text) VALUES ('delete', OLD.rowid, OLD.text);
END;

-- 8. Initialize meta data
INSERT OR IGNORE INTO memory_meta (key, value) VALUES
  ('schema_version', '${SCHEMA_VERSION}'),
  ('embedding_enabled', 'false'),
  ('embedding_model', 'text-embedding-3-small'),
  ('embedding_dims', '1536'),
  ('embedding_provider', 'openai'),
  ('vector_available', 'null'),
  ('dirty', 'false'),
  ('syncing', 'false'),
  ('sync_version', '0'),
  ('last_sync_time', '0'),
  ('consolidation_last_run', '0'),
  ('cleanup_last_run', '0');
`;

// ==================== MemoryDatabase Class ====================

export class MemoryDatabase {
  private db: Database.Database | null = null;
  private dbPath: string = '';
  private workspaceDir: string = '';
  private vecAvailable: VectorAvailability = 'unknown';
  private config: MemoryConfig | null = null;

  /**
   * Initialize database
   */
  async init(workspaceDir: string, config: MemoryConfig): Promise<void> {
    this.workspaceDir = workspaceDir;
    this.config = config;

    // Create .memory directory
    const memoryDir = path.join(workspaceDir, '.memory');
    if (!fs.existsSync(memoryDir)) {
      fs.mkdirSync(memoryDir, { recursive: true });
    }

    // Database path
    this.dbPath = path.join(memoryDir, 'index.sqlite');

    try {
      // Open database
      this.db = new Database(this.dbPath);
      this.db.pragma('journal_mode = WAL');

      // Create schema
      this.db.exec(SCHEMA_SQL);

      log.info('[MemoryDatabase] Initialized at:', this.dbPath);

      // Try to load sqlite-vec if embedding is enabled
      if (config.embedding.enabled) {
        await this.loadVectorExtension();
      }
    } catch (error) {
      log.error('[MemoryDatabase] Initialization failed:', error);
      throw error;
    }
  }

  /**
   * Close database connection
   */
  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
      log.info('[MemoryDatabase] Closed');
    }
  }

  /**
   * Get database instance
   */
  getDb(): Database.Database | null {
    return this.db;
  }

  /**
   * Get database path
   */
  getDbPath(): string {
    return this.dbPath;
  }

  // ==================== Vector Extension ====================

  /**
   * Load sqlite-vec extension
   */
  async loadVectorExtension(): Promise<boolean> {
    if (this.vecAvailable !== 'unknown') {
      return this.vecAvailable === 'available';
    }

    if (!this.db) {
      return false;
    }

    try {
      // Try to load sqlite-vec
      // Note: This requires the sqlite-vec npm package
      // The extension path needs to be resolved based on platform
      const sqliteVec = require('sqlite-vec');

      // Enable extension loading
      this.db.loadExtension(sqliteVec.getLoadablePath());

      // Test vector functionality
      this.db.exec('SELECT vec_version();');

      // Create vector table
      const dims = this.config?.embedding.dimensions ?? 1536;
      this.createVectorTable(dims);

      this.vecAvailable = 'available';
      this.setMeta(META_KEYS.VECTOR_AVAILABLE, 'true');
      log.info('[MemoryDatabase] sqlite-vec loaded successfully');

      return true;
    } catch (error) {
      this.vecAvailable = 'unavailable';
      this.setMeta(META_KEYS.VECTOR_AVAILABLE, 'false');
      log.warn('[MemoryDatabase] sqlite-vec not available, using JS fallback:', error);
      return false;
    }
  }

  /**
   * Check if vector search is available
   */
  isVectorAvailable(): boolean {
    return this.vecAvailable === 'available';
  }

  /**
   * Get vector availability status
   */
  getVectorAvailability(): VectorAvailability {
    return this.vecAvailable;
  }

  /**
   * Create vector table with specified dimensions
   */
  private createVectorTable(dims: number): void {
    if (!this.db) return;

    // Drop existing table if dimensions changed
    this.db.exec(`DROP TABLE IF EXISTS memory_vec;`);

    // Create new vector table
    this.db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS memory_vec USING vec0(
        memory_id TEXT PRIMARY KEY,
        embedding FLOAT[${dims}]
      );
    `);

    log.info(`[MemoryDatabase] Created vector table with ${dims} dimensions`);
  }

  // ==================== Meta Operations ====================

  /**
   * Get meta value
   */
  getMeta(key: string): string | null {
    if (!this.db) return null;

    const row = this.db.prepare('SELECT value FROM memory_meta WHERE key = ?').get(key) as { value: string } | undefined;
    return row?.value ?? null;
  }

  /**
   * Set meta value
   */
  setMeta(key: string, value: string): void {
    if (!this.db) return;

    this.db.prepare('INSERT OR REPLACE INTO memory_meta (key, value) VALUES (?, ?)').run(key, value);
  }

  /**
   * Get sync state
   */
  getSyncState(): SyncState {
    return {
      dirty: this.getMeta(META_KEYS.DIRTY) === 'true',
      syncing: this.getMeta(META_KEYS.SYNCING) === 'true',
      lastSyncTime: parseInt(this.getMeta(META_KEYS.LAST_SYNC_TIME) ?? '0', 10),
      syncVersion: parseInt(this.getMeta(META_KEYS.SYNC_VERSION) ?? '0', 10),
    };
  }

  /**
   * Set sync state
   */
  setSyncState(state: Partial<SyncState>): void {
    if (state.dirty !== undefined) {
      this.setMeta(META_KEYS.DIRTY, state.dirty ? 'true' : 'false');
    }
    if (state.syncing !== undefined) {
      this.setMeta(META_KEYS.SYNCING, state.syncing ? 'true' : 'false');
    }
    if (state.lastSyncTime !== undefined) {
      this.setMeta(META_KEYS.LAST_SYNC_TIME, state.lastSyncTime.toString());
    }
    if (state.syncVersion !== undefined) {
      this.setMeta(META_KEYS.SYNC_VERSION, state.syncVersion.toString());
    }
  }

  // ==================== File Hash Operations ====================

  /**
   * Get file hash record
   */
  getFileHash(filePath: string): FileHashRecord | null {
    if (!this.db) return null;

    const row = this.db.prepare(`
      SELECT path, hash, chunk_count, last_modified, synced_at
      FROM file_hashes
      WHERE path = ?
    `).get(filePath);

    return row as FileHashRecord | null;
  }

  /**
   * Set file hash record
   */
  setFileHash(record: FileHashRecord): void {
    if (!this.db) return;

    this.db.prepare(`
      INSERT OR REPLACE INTO file_hashes (path, hash, chunk_count, last_modified, synced_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(record.path, record.hash, record.chunkCount, record.lastModified, record.syncedAt);
  }

  /**
   * Delete file hash record
   */
  deleteFileHash(filePath: string): void {
    if (!this.db) return;

    this.db.prepare('DELETE FROM file_hashes WHERE path = ?').run(filePath);
  }

  /**
   * Get all file hash records
   */
  getAllFileHashes(): FileHashRecord[] {
    if (!this.db) return [];

    return this.db.prepare('SELECT * FROM file_hashes').all() as FileHashRecord[];
  }

  // ==================== Memory CRUD Operations ====================

  /**
   * Insert memory entry
   */
  insertMemory(entry: MemoryEntry): void {
    if (!this.db) return;

    const now = Date.now();
    this.db.prepare(`
      INSERT INTO memories (
        id, text, fingerprint, category, confidence, is_explicit, importance,
        source, source_path, start_line, end_line,
        embedding, embedding_model, embedding_dims,
        status, access_count, last_accessed_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      entry.id,
      entry.text,
      entry.fingerprint,
      entry.category,
      entry.confidence,
      entry.isExplicit ? 1 : 0,
      entry.importance,
      entry.source,
      entry.sourcePath,
      entry.startLine ?? null,
      entry.endLine ?? null,
      entry.embedding ? float32ToBuffer(entry.embedding) : null,
      entry.embeddingModel ?? null,
      entry.embeddingDims ?? null,
      entry.status,
      entry.accessCount,
      entry.lastAccessedAt ?? null,
      entry.createdAt ?? now,
      entry.updatedAt ?? now
    );

    // Insert into vector table if embedding exists and vector is available
    if (entry.embedding && this.isVectorAvailable()) {
      try {
        this.db.prepare(`
          INSERT INTO memory_vec (memory_id, embedding)
          VALUES (?, ?)
        `).run(entry.id, float32ToBuffer(entry.embedding));
      } catch (error) {
        log.warn('[MemoryDatabase] Failed to insert vector:', error);
      }
    }
  }

  /**
   * Insert multiple memory entries (batch)
   */
  insertMemories(entries: MemoryEntry[]): void {
    if (!this.db || entries.length === 0) return;

    const insertMem = this.db.prepare(`
      INSERT INTO memories (
        id, text, fingerprint, category, confidence, is_explicit, importance,
        source, source_path, start_line, end_line,
        embedding, embedding_model, embedding_dims,
        status, access_count, last_accessed_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertVec = this.isVectorAvailable()
      ? this.db.prepare('INSERT INTO memory_vec (memory_id, embedding) VALUES (?, ?)')
      : null;

    const now = Date.now();

    const insertMany = this.db.transaction((items: MemoryEntry[]) => {
      for (const entry of items) {
        insertMem.run(
          entry.id,
          entry.text,
          entry.fingerprint,
          entry.category,
          entry.confidence,
          entry.isExplicit ? 1 : 0,
          entry.importance,
          entry.source,
          entry.sourcePath,
          entry.startLine ?? null,
          entry.endLine ?? null,
          entry.embedding ? float32ToBuffer(entry.embedding) : null,
          entry.embeddingModel ?? null,
          entry.embeddingDims ?? null,
          entry.status,
          entry.accessCount,
          entry.lastAccessedAt ?? null,
          entry.createdAt ?? now,
          entry.updatedAt ?? now
        );

        if (entry.embedding && insertVec) {
          try {
            insertVec.run(entry.id, float32ToBuffer(entry.embedding));
          } catch (error) {
            log.warn('[MemoryDatabase] Failed to insert vector:', error);
          }
        }
      }
    });

    insertMany(entries);
  }

  /**
   * Update memory entry
   */
  updateMemory(id: string, updates: Partial<MemoryEntry>): void {
    if (!this.db) return;

    const fields: string[] = [];
    const values: unknown[] = [];

    if (updates.text !== undefined) {
      fields.push('text = ?');
      values.push(updates.text);
    }
    if (updates.confidence !== undefined) {
      fields.push('confidence = ?');
      values.push(updates.confidence);
    }
    if (updates.importance !== undefined) {
      fields.push('importance = ?');
      values.push(updates.importance);
    }
    if (updates.status !== undefined) {
      fields.push('status = ?');
      values.push(updates.status);
    }
    if (updates.embedding !== undefined) {
      fields.push('embedding = ?');
      values.push(updates.embedding ? float32ToBuffer(updates.embedding) : null);
    }
    if (updates.accessCount !== undefined) {
      fields.push('access_count = ?');
      values.push(updates.accessCount);
    }
    if (updates.lastAccessedAt !== undefined) {
      fields.push('last_accessed_at = ?');
      values.push(updates.lastAccessedAt);
    }

    fields.push('updated_at = ?');
    values.push(Date.now());

    values.push(id);

    this.db.prepare(`UPDATE memories SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  }

  /**
   * Delete memory by ID
   */
  deleteMemory(id: string): void {
    if (!this.db) return;

    this.db.prepare('DELETE FROM memories WHERE id = ?').run(id);

    if (this.isVectorAvailable()) {
      try {
        this.db.prepare('DELETE FROM memory_vec WHERE memory_id = ?').run(id);
      } catch (error) {
        // Ignore if vector doesn't exist
      }
    }
  }

  /**
   * Delete memories by source path
   */
  deleteBySourcePath(sourcePath: string): number {
    if (!this.db) return 0;

    // Get IDs first for vector cleanup
    const ids = this.db.prepare('SELECT id FROM memories WHERE source_path = ?')
      .all(sourcePath) as { id: string }[];

    // Delete from memories (FTS trigger handles cleanup)
    const result = this.db.prepare('DELETE FROM memories WHERE source_path = ?').run(sourcePath);

    // Delete from vector table
    if (this.isVectorAvailable() && ids.length > 0) {
      const deleteVec = this.db.prepare('DELETE FROM memory_vec WHERE memory_id = ?');
      for (const { id } of ids) {
        try {
          deleteVec.run(id);
        } catch (error) {
          // Ignore
        }
      }
    }

    return result.changes;
  }

  /**
   * Get memory by ID
   */
  getMemory(id: string): MemoryEntry | null {
    if (!this.db) return null;

    const row = this.db.prepare('SELECT * FROM memories WHERE id = ?').get(id) as MemoryEntryRow | undefined;
    return row ? this.rowToEntry(row) : null;
  }

  /**
   * Check if memory exists by fingerprint
   */
  existsByFingerprint(fingerprint: string): boolean {
    if (!this.db) return false;

    const row = this.db.prepare('SELECT 1 FROM memories WHERE fingerprint = ? AND status = ?')
      .get(fingerprint, MEMORY_STATUS.ACTIVE);
    return !!row;
  }

  /**
   * Get all memories (with optional filters)
   */
  getMemories(options?: {
    status?: string;
    source?: MemorySource;
    limit?: number;
  }): MemoryEntry[] {
    if (!this.db) return [];

    let sql = 'SELECT * FROM memories WHERE 1=1';
    const params: unknown[] = [];

    if (options?.status) {
      sql += ' AND status = ?';
      params.push(options.status);
    }
    if (options?.source) {
      sql += ' AND source = ?';
      params.push(options.source);
    }

    sql += ' ORDER BY created_at DESC';

    if (options?.limit) {
      sql += ' LIMIT ?';
      params.push(options.limit);
    }

    const rows = this.db.prepare(sql).all(...params) as MemoryEntryRow[];
    return rows.map(row => this.rowToEntry(row));
  }

  /**
   * Count memories
   */
  countMemories(status?: string): number {
    if (!this.db) return 0;

    if (status) {
      const row = this.db.prepare('SELECT COUNT(*) as count FROM memories WHERE status = ?')
        .get(status) as { count: number };
      return row.count;
    }

    const row = this.db.prepare('SELECT COUNT(*) as count FROM memories').get() as { count: number };
    return row.count;
  }

  // ==================== Search Operations ====================

  /**
   * FTS5 full-text search
   */
  searchFTS(query: string, limit: number = 12): MemorySearchResult[] {
    if (!this.db) return [];

    // Clean query for FTS5
    const cleanQuery = this.cleanFTSQuery(query);

    try {
      const rows = this.db.prepare(`
        SELECT m.*, bm25(memory_fts) as score
        FROM memories m
        JOIN memory_fts fts ON m.rowid = fts.rowid
        WHERE memory_fts MATCH ?
        AND m.status = ?
        ORDER BY score
        LIMIT ?
      `).all(cleanQuery, MEMORY_STATUS.ACTIVE, limit) as (MemoryEntryRow & { score: number })[];

      // BM25 returns negative scores, convert to positive and normalize
      const maxScore = Math.max(...rows.map(r => Math.abs(r.score)), 1);

      return rows.map(row => ({
        entry: this.rowToEntry(row),
        score: Math.abs(row.score) / maxScore,
        source: 'fts' as const,
      }));
    } catch (error) {
      log.error('[MemoryDatabase] FTS search failed:', error);
      return [];
    }
  }

  /**
   * Vector search using sqlite-vec or JS fallback
   */
  searchVector(embedding: Float32Array, limit: number = 12, minScore: number = 0): MemorySearchResult[] {
    if (!this.db) return [];

    if (this.isVectorAvailable()) {
      // Use sqlite-vec for native vector search
      try {
        const rows = this.db.prepare(`
          SELECT m.*, vec_distance_cosine(v.embedding, ?) as distance
          FROM memories m
          JOIN memory_vec v ON m.id = v.memory_id
          WHERE m.status = ?
          ORDER BY distance ASC
          LIMIT ?
        `).all(float32ToBuffer(embedding), MEMORY_STATUS.ACTIVE, limit) as (MemoryEntryRow & { distance: number })[];

        // Convert distance to similarity score (cosine distance = 1 - similarity)
        return rows
          .map(row => ({
            entry: this.rowToEntry(row),
            score: 1 - row.distance,
            source: 'vector' as const,
          }))
          .filter(r => r.score >= minScore);
      } catch (error) {
        log.warn('[MemoryDatabase] Native vector search failed, using JS fallback:', error);
      }
    }

    // JS fallback: load all embeddings and compute cosine similarity
    return this.searchVectorJS(embedding, limit, minScore);
  }

  /**
   * Pure JavaScript vector search (fallback)
   */
  private searchVectorJS(embedding: Float32Array, limit: number, minScore: number): MemorySearchResult[] {
    if (!this.db) return [];

    // Get all memories with embeddings
    const rows = this.db.prepare(`
      SELECT * FROM memories
      WHERE status = ? AND embedding IS NOT NULL
    `).all(MEMORY_STATUS.ACTIVE) as MemoryEntryRow[];

    // Calculate similarities
    const results: MemorySearchResult[] = [];

    for (const row of rows) {
      if (!row.embedding) continue;

      try {
        const memEmbedding = bufferToFloat32(row.embedding);
        const score = cosineSimilarity(embedding, memEmbedding);

        if (score >= minScore) {
          results.push({
            entry: this.rowToEntry(row),
            score,
            source: 'vector',
          });
        }
      } catch (error) {
        // Skip invalid embeddings
      }
    }

    // Sort by score descending and return top K
    results.sort((a, b) => b.score - a.score);
    return results.slice(0, limit);
  }

  /**
   * Clean query string for FTS5
   */
  private cleanFTSQuery(query: string): string {
    // Remove special FTS5 characters
    let cleaned = query.replace(/["'*^(){}[\]\\|~!@#%&+=;:<>?]/g, ' ');

    // Split into words and join with AND
    const words = cleaned.split(/\s+/).filter(w => w.length > 0);

    // Escape each word and join
    return words.map(w => `"${w}"`).join(' AND ');
  }

  // ==================== Embedding Cache ====================

  /**
   * Get cached embedding
   */
  getCachedEmbedding(contentHash: string, model: string): Float32Array | null {
    if (!this.db) return null;

    const row = this.db.prepare(`
      SELECT embedding, dims FROM embedding_cache
      WHERE content_hash = ? AND model = ?
    `).get(contentHash, model) as { embedding: Buffer; dims: number } | undefined;

    if (!row) return null;

    // Update access stats
    this.db.prepare(`
      UPDATE embedding_cache
      SET access_count = access_count + 1, last_accessed_at = ?
      WHERE content_hash = ? AND model = ?
    `).run(Date.now(), contentHash, model);

    return bufferToFloat32(row.embedding);
  }

  /**
   * Cache embedding
   */
  cacheEmbedding(contentHash: string, embedding: Float32Array, model: string): void {
    if (!this.db) return;

    const now = Date.now();
    this.db.prepare(`
      INSERT OR REPLACE INTO embedding_cache (content_hash, embedding, model, dims, access_count, created_at, last_accessed_at)
      VALUES (?, ?, ?, ?, 1, ?, ?)
    `).run(contentHash, float32ToBuffer(embedding), model, embedding.length, now, now);
  }

  // ==================== Utility Methods ====================

  /**
   * Convert database row to MemoryEntry
   */
  private rowToEntry(row: MemoryEntryRow): MemoryEntry {
    return {
      id: row.id,
      text: row.text,
      fingerprint: row.fingerprint,
      category: row.category as MemoryEntry['category'],
      confidence: row.confidence,
      isExplicit: row.is_explicit === 1,
      importance: row.importance,
      source: row.source as MemoryEntry['source'],
      sourcePath: row.source_path,
      startLine: row.start_line ?? undefined,
      endLine: row.end_line ?? undefined,
      embedding: row.embedding ? bufferToFloat32(row.embedding) : undefined,
      embeddingModel: row.embedding_model ?? undefined,
      embeddingDims: row.embedding_dims ?? undefined,
      status: row.status as MemoryEntry['status'],
      accessCount: row.access_count,
      lastAccessedAt: row.last_accessed_at ?? undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  /**
   * Create MemoryEntry from chunk
   */
  createEntryFromChunk(
    chunk: MemoryChunk,
    source: MemorySource,
    sourcePath: string,
    options?: {
      category?: MemoryEntry['category'];
      confidence?: number;
      isExplicit?: boolean;
    }
  ): MemoryEntry {
    const now = Date.now();
    return {
      id: generateMemoryId(chunk.text),
      text: chunk.text,
      fingerprint: chunk.hash,
      category: options?.category ?? 'fact',
      confidence: options?.confidence ?? 0.75,
      isExplicit: options?.isExplicit ?? false,
      importance: 0.5,
      source,
      sourcePath,
      startLine: chunk.startLine,
      endLine: chunk.endLine,
      status: MEMORY_STATUS.ACTIVE,
      accessCount: 0,
      createdAt: now,
      updatedAt: now,
    };
  }
}

// Export singleton
export const memoryDatabase = new MemoryDatabase();
