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
  ExtractionProgressRecord,
  ExtractionProgressRow,
} from './types';
import {
  META_KEYS,
  SCHEMA_VERSION,
  MEMORY_STATUS,
  DEFAULT_SYNC_STATE,
  MEMORY_DB_DIR,
  MEMORY_DB_FILE,
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
  created_at,
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

-- 6b. Extraction progress tracking
CREATE TABLE IF NOT EXISTS extraction_progress (
  session_id TEXT NOT NULL,
  segment_index INTEGER NOT NULL,
  start_msg_index INTEGER NOT NULL,
  end_msg_index INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  memories_extracted INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL,
  completed_at INTEGER,
  error_message TEXT,
  PRIMARY KEY (session_id, segment_index)
);

CREATE INDEX IF NOT EXISTS idx_extraction_progress_session
  ON extraction_progress(session_id, status);

-- 7. File hash tracking
CREATE TABLE IF NOT EXISTS file_hashes (
  path TEXT PRIMARY KEY,
  hash TEXT NOT NULL,
  chunk_count INTEGER NOT NULL DEFAULT 0,
  last_modified INTEGER NOT NULL,
  synced_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

-- 7. FTS5 sync triggers
CREATE TRIGGER IF NOT EXISTS memory_ai AFTER INSERT ON memories
WHEN NEW.status = 'active' BEGIN
  INSERT INTO memory_fts(rowid, text, created_at) VALUES (NEW.rowid, NEW.text, NEW.created_at);
END;

CREATE TRIGGER IF NOT EXISTS memory_ad AFTER DELETE ON memories BEGIN
  INSERT INTO memory_fts(memory_fts, rowid, text, created_at) VALUES ('delete', OLD.rowid, OLD.text, OLD.created_at);
END;

CREATE TRIGGER IF NOT EXISTS memory_au AFTER UPDATE ON memories
WHEN NEW.status = 'active' AND NEW.text != OLD.text BEGIN
  INSERT INTO memory_fts(memory_fts, rowid, text, created_at) VALUES ('delete', OLD.rowid, OLD.text, OLD.created_at);
  INSERT INTO memory_fts(rowid, text, created_at) VALUES (NEW.rowid, NEW.text, NEW.created_at);
END;

CREATE TRIGGER IF NOT EXISTS memory_reactivate AFTER UPDATE OF status ON memories
WHEN OLD.status != 'active' AND NEW.status = 'active' BEGIN
  INSERT INTO memory_fts(rowid, text, created_at) VALUES (NEW.rowid, NEW.text, NEW.created_at);
END;

CREATE TRIGGER IF NOT EXISTS memory_archive AFTER UPDATE OF status ON memories
WHEN OLD.status = 'active' AND NEW.status != 'active' BEGIN
  INSERT INTO memory_fts(memory_fts, rowid, text, created_at) VALUES ('delete', OLD.rowid, OLD.text, OLD.created_at);
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

    // Create memory directory (use MEMORY_DB_DIR constant for cross-platform compatibility)
    const memoryDir = path.join(workspaceDir, MEMORY_DB_DIR);
    if (!fs.existsSync(memoryDir)) {
      fs.mkdirSync(memoryDir, { recursive: true });
    }

    // Database path
    this.dbPath = path.join(memoryDir, MEMORY_DB_FILE);

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

    const now = Date.now();
    this.db.prepare(`
      INSERT OR REPLACE INTO file_hashes (path, hash, chunk_count, last_modified, synced_at, created_at)
      VALUES (?, ?, ?, ?, ?, COALESCE((SELECT created_at FROM file_hashes WHERE path = ?), ?))
    `).run(record.path, record.hash, record.chunkCount, record.lastModified, record.syncedAt, record.path, now);
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
   * FTS5 full-text search with LIKE fallback for Chinese
   */
  searchFTS(query: string, limit: number = 12): MemorySearchResult[] {
    if (!this.db) return [];

    // Check if query contains Chinese characters
    const hasChinese = /[\u4e00-\u9fff]/.test(query);
    log.debug(`[MemoryDatabase] searchFTS: query="${query.slice(0, 50)}", hasChinese=${hasChinese}`);

    // For Chinese queries, use LIKE directly (FTS5 unicode61 doesn't support Chinese segmentation)
    if (hasChinese) {
      log.debug('[MemoryDatabase] searchFTS: using LIKE for Chinese query');
      return this.searchLike(query, limit);
    }

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

      // If FTS returns no results, fall back to LIKE
      if (rows.length === 0) {
        return this.searchLike(query, limit);
      }

      // BM25 returns negative scores, convert to positive and normalize
      const maxScore = Math.max(...rows.map(r => Math.abs(r.score)), 1);

      return rows.map(row => ({
        entry: this.rowToEntry(row),
        score: Math.abs(row.score) / maxScore,
        source: 'fts' as const,
      }));
    } catch (error) {
      log.error('[MemoryDatabase] FTS search failed:', error);
      // Fall back to LIKE on error
      return this.searchLike(query, limit);
    }
  }

  /**
   * LIKE-based search as fallback for Chinese and when FTS fails
   */
  private searchLike(query: string, limit: number): MemorySearchResult[] {
    if (!this.db) return [];

    try {
      // Extract key terms from Chinese query for better matching
      const keyTerms = this.extractChineseKeyTerms(query);
      log.debug(`[MemoryDatabase] searchLike: key terms="${keyTerms.join(', ')}"`);

      // Build OR conditions for each key term
      const conditions = keyTerms.map(() => 'text LIKE ?').join(' OR ');
      const params = [...keyTerms.map(t => `%${t}%`), MEMORY_STATUS.ACTIVE, limit];

      const rows = this.db.prepare(`
        SELECT * FROM memories
        WHERE (${conditions})
        AND status = ?
        ORDER BY updated_at DESC
        LIMIT ?
      `).all(...params) as MemoryEntryRow[];

      log.debug(`[MemoryDatabase] searchLike: found ${rows.length} results`);

      // Assign scores based on match quality
      return rows.map((row, index) => ({
        entry: this.rowToEntry(row),
        // Simple scoring: earlier results get higher scores, base 0.5
        score: Math.max(0.5, 0.9 - (index * 0.1)),
        source: 'fts' as const,
      }));
    } catch (error) {
      log.error('[MemoryDatabase] LIKE search failed:', error);
      return [];
    }
  }

  /**
   * Extract key terms from Chinese text for search
   * Returns meaningful 2-4 character ngrams
   */
  private extractChineseKeyTerms(text: string): string[] {
    // Remove punctuation and common question words
    const cleanText = text
      .replace(/[？?！!。，,、]/g, '')
      .replace(/什么|怎么|如何|为什么|哪|谁|是否|能不能|可以|吗|呢|呀|啊|吗/g, '');

    const terms: string[] = [];

    // Extract 2-4 character ngrams that contain Chinese characters
    for (let len = 4; len >= 2; len--) {
      for (let i = 0; i <= cleanText.length - len; i++) {
        const ngram = cleanText.slice(i, i + len);
        // Only include if it contains Chinese characters
        if (/[\u4e00-\u9fff]/.test(ngram)) {
          terms.push(ngram);
        }
      }
    }

    // Also include the full cleaned text if it's short enough
    if (cleanText.length <= 10 && /[\u4e00-\u9fff]/.test(cleanText)) {
      terms.unshift(cleanText);
    }

    // Remove duplicates and return top terms
    return [...new Set(terms)].slice(0, 5);
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

  // ==================== Extraction Progress Operations ====================

  /**
   * Insert extraction progress record
   */
  insertExtractionProgress(record: ExtractionProgressRecord): void {
    if (!this.db) return;

    this.db.prepare(`
      INSERT OR REPLACE INTO extraction_progress (
        session_id, segment_index, start_msg_index, end_msg_index,
        status, memories_extracted, created_at, completed_at, error_message
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      record.sessionId,
      record.segmentIndex,
      record.startMsgIndex,
      record.endMsgIndex,
      record.status,
      record.memoriesExtracted,
      record.createdAt,
      record.completedAt,
      record.errorMessage
    );
  }

  /**
   * Update extraction progress record
   */
  updateExtractionProgress(
    sessionId: string,
    segmentIndex: number,
    updates: Partial<ExtractionProgressRecord>
  ): void {
    if (!this.db) return;

    const fields: string[] = [];
    const values: unknown[] = [];

    if (updates.status !== undefined) {
      fields.push('status = ?');
      values.push(updates.status);
    }
    if (updates.memoriesExtracted !== undefined) {
      fields.push('memories_extracted = ?');
      values.push(updates.memoriesExtracted);
    }
    if (updates.completedAt !== undefined) {
      fields.push('completed_at = ?');
      values.push(updates.completedAt);
    }
    if (updates.errorMessage !== undefined) {
      fields.push('error_message = ?');
      values.push(updates.errorMessage);
    }

    if (fields.length === 0) return;

    values.push(sessionId, segmentIndex);
    this.db.prepare(
      `UPDATE extraction_progress SET ${fields.join(', ')} WHERE session_id = ? AND segment_index = ?`
    ).run(...values);
  }

  /**
   * Get extraction progress for a session
   */
  getExtractionProgress(sessionId: string): ExtractionProgressRecord[] {
    if (!this.db) return [];

    const rows = this.db.prepare(
      'SELECT * FROM extraction_progress WHERE session_id = ? ORDER BY segment_index'
    ).all(sessionId) as ExtractionProgressRow[];

    return rows.map(row => this.progressRowToRecord(row));
  }

  /**
   * Get the maximum completed end_msg_index for a session
   * Returns -1 if no completed segments exist
   */
  getMaxCompletedMsgIndex(sessionId: string): number {
    if (!this.db) return -1;

    const row = this.db.prepare(
      `SELECT MAX(end_msg_index) as max_index FROM extraction_progress
       WHERE session_id = ? AND status = 'completed'`
    ).get(sessionId) as { max_index: number | null } | undefined;

    return row?.max_index ?? -1;
  }

  /**
   * Get all pending extraction progress records (for breakpoint recovery)
   */
  getPendingExtractionProgress(): ExtractionProgressRecord[] {
    if (!this.db) return [];

    const rows = this.db.prepare(
      `SELECT * FROM extraction_progress WHERE status IN ('pending', 'processing') ORDER BY created_at`
    ).all() as ExtractionProgressRow[];

    return rows.map(row => this.progressRowToRecord(row));
  }

  /**
   * Cleanup old extraction progress records
   * - Delete completed records older than retentionDays
   * - Delete failed records older than retentionDays
   * - Mark stale pending records (older than stalePendingHours) as failed
   */
  cleanupExtractionProgress(
    retentionDays: number,
    stalePendingHours: number
  ): { deleted: number; markedFailed: number } {
    if (!this.db) return { deleted: 0, markedFailed: 0 };

    const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
    const staleCutoff = Date.now() - stalePendingHours * 60 * 60 * 1000;

    // Delete old completed records
    const deleteCompleted = this.db.prepare(
      `DELETE FROM extraction_progress WHERE status = 'completed' AND completed_at < ?`
    ).run(cutoff);

    // Delete old failed records
    const deleteFailed = this.db.prepare(
      `DELETE FROM extraction_progress WHERE status = 'failed' AND created_at < ?`
    ).run(cutoff);

    // Mark stale pending/processing as failed
    const markStale = this.db.prepare(
      `UPDATE extraction_progress SET status = 'failed', error_message = 'stale'
       WHERE status IN ('pending', 'processing') AND created_at < ?`
    ).run(staleCutoff);

    return {
      deleted: deleteCompleted.changes + deleteFailed.changes,
      markedFailed: markStale.changes,
    };
  }

  /**
   * Get recent memory texts for deduplication
   * Returns texts of recently created memories (for a given session's timeframe)
   */
  getRecentMemoryTexts(limit: number = 50): string[] {
    if (!this.db) return [];

    const rows = this.db.prepare(
      `SELECT text FROM memories WHERE status = 'active' ORDER BY created_at DESC LIMIT ?`
    ).all(limit) as { text: string }[];

    return rows.map(row => row.text);
  }

  /**
   * Get the next segment index for a session
   * Returns MAX(segment_index) + 1, or 0 if no segments exist
   * Used for recovering segment index counters after restart
   */
  getNextSegmentIndex(sessionId: string): number {
    if (!this.db) return 0;

    const row = this.db.prepare(
      `SELECT MAX(segment_index) as max_idx FROM extraction_progress WHERE session_id = ?`
    ).get(sessionId) as { max_idx: number | null } | undefined;

    return (row?.max_idx ?? -1) + 1;
  }

  /**
   * Convert extraction progress row to record
   */
  private progressRowToRecord(row: ExtractionProgressRow): ExtractionProgressRecord {
    return {
      sessionId: row.session_id,
      segmentIndex: row.segment_index,
      startMsgIndex: row.start_msg_index,
      endMsgIndex: row.end_msg_index,
      status: row.status as ExtractionProgressRecord['status'],
      memoriesExtracted: row.memories_extracted,
      createdAt: row.created_at,
      completedAt: row.completed_at,
      errorMessage: row.error_message,
    };
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
