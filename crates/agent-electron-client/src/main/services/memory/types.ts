/**
 * Long-Term Memory Type Definitions
 *
 * Based on specs/long-memory/long-memory.md
 */

// ==================== Configuration Types ====================

export type GuardLevel = 'strict' | 'standard' | 'relaxed';
export type EmbeddingBackend = 'auto' | 'sqlite-vec' | 'js' | 'none';
export type EmbeddingProvider = 'openai' | 'ollama' | 'custom';
export type MemoryCategory = 'fact' | 'preference' | 'event' | 'skill';
export type MemorySource = 'core' | 'daily';
export type MemoryStatus = 'active' | 'archived' | 'deleted';

export interface ExtractionTriggerConfig {
  onEveryTurn: boolean;      // Check after every conversation turn
  batchInterval: number;     // Batch extract every N turns (default: 3)
  onSessionEnd: boolean;     // Extract on session end
}

export interface ExtractionLlmConfig {
  maxTokensPerExtract: number;  // Max tokens per extraction (default: 500)
  temperature: number;          // LLM temperature (default: 0.3)
  maxRetries: number;           // Max retry attempts (default: 2)
}

export interface ExtractionConfig {
  enabled: boolean;
  implicitEnabled: boolean;     // Enable implicit signal detection
  explicitEnabled: boolean;     // Enable explicit command detection
  guardLevel: GuardLevel;
  trigger: ExtractionTriggerConfig;
  llm: ExtractionLlmConfig;
}

export interface StorageConfig {
  workspacePath: string;
  dailyRetentionDays: number;   // Days to keep daily memory files (default: 30)
  maxMemories: number;          // Max memory entries (default: 500)
}

export interface EmbeddingConfig {
  enabled: boolean;
  backend: EmbeddingBackend;
  provider: EmbeddingProvider;
  model: string;                // e.g., 'text-embedding-3-small'
  dimensions: number;           // Vector dimensions (default: 1536)
  apiKey?: string;              // API key for embedding provider
  baseUrl?: string;             // Custom API endpoint
  cacheMaxEntries: number;      // Max cache entries (default: 10000)
}

export interface RetrievalConfig {
  vectorWeight: number;         // Vector search weight (default: 0.7)
  ftsWeight: number;            // FTS search weight (default: 0.3)
  limit: number;                // Max results (default: 12)
  minScore: number;             // Minimum score threshold (default: 0.4)
  dailyMemoryDays: number;      // Search recent N days of daily memories (default: 2)
}

export interface SchedulerConfig {
  consolidationCron: string;    // Consolidation task cron (default: '0 0 * * *')
  cleanupCron: string;          // Cleanup task cron (default: '0 1 * * *')
  consolidationEnabled: boolean;
  cleanupEnabled: boolean;
}

export interface MemoryConfig {
  enabled: boolean;
  extraction: ExtractionConfig;
  storage: StorageConfig;
  embedding: EmbeddingConfig;
  retrieval: RetrievalConfig;
  scheduler: SchedulerConfig;
}

// ==================== Memory Entry Types ====================

export interface MemoryEntry {
  id: string;
  text: string;
  fingerprint: string;          // SHA256 hash for deduplication
  category: MemoryCategory;
  confidence: number;           // 0-1 extraction confidence
  isExplicit: boolean;          // Explicit user command
  importance: number;           // 0-1 user-defined importance
  source: MemorySource;         // 'core' (MEMORY.md) or 'daily' (memory/*.md)
  sourcePath: string;           // Relative file path
  startLine?: number;           // Markdown start line (1-indexed)
  endLine?: number;             // Markdown end line (1-indexed)
  embedding?: Float32Array;     // Vector embedding
  embeddingModel?: string;
  embeddingDims?: number;
  status: MemoryStatus;
  accessCount: number;
  lastAccessedAt?: number;
  createdAt: number;
  updatedAt: number;
}

// Database representation (BLOB fields as Buffer)
export interface MemoryEntryRow {
  id: string;
  text: string;
  fingerprint: string;
  category: string;
  confidence: number;
  is_explicit: number;
  importance: number;
  source: string;
  source_path: string;
  start_line: number | null;
  end_line: number | null;
  embedding: Buffer | null;
  embedding_model: string | null;
  embedding_dims: number | null;
  status: string;
  access_count: number;
  last_accessed_at: number | null;
  created_at: number;
  updated_at: number;
}

// ==================== Extraction Types ====================

export interface ModelConfig {
  provider: string;
  model: string;
  apiKey: string;               // Required! Electron has no global storage
  baseUrl?: string;
}

export interface ExtractionTask {
  sessionId: string;
  messageId: string;
  messages: Array<{
    role: 'user' | 'assistant';
    content: string;
  }>;
  modelConfig: ModelConfig;     // Must capture full model config including API key
  timestamp: number;
  retryCount: number;
}

export interface ExtractedMemory {
  text: string;
  category: MemoryCategory;
  confidence: number;
  isExplicit: boolean;
}

export interface SignalMatch {
  type: 'explicit' | 'implicit';
  pattern: string;
  matchedText: string;
  extractedText?: string;       // For explicit commands
}

export interface ValidationResult {
  accept: boolean;
  reason?: string;
  mergedText?: string;          // If merging with existing memory
  confidence: number;
}

// ==================== Search Types ====================

export interface SearchOptions {
  limit?: number;
  minScore?: number;
  categories?: MemoryCategory[];
  sources?: MemorySource[];
  includeVector?: boolean;
  checkDirty?: boolean;          // Whether to check dirty state before search (default: true)
}

export interface MemorySearchResult {
  entry: MemoryEntry;
  score: number;
  source: 'vector' | 'fts' | 'hybrid';
}

export interface HybridSearchOptions extends SearchOptions {
  vectorWeight?: number;
  ftsWeight?: number;
}

// ==================== Injection Types ====================

export interface InjectionOptions {
  maxTokens?: number;
  format?: 'xml' | 'markdown';
  includeScores?: boolean;
}

// ==================== Sync Types ====================

export interface SyncState {
  dirty: boolean;               // Has pending file changes
  syncing: boolean;             // Sync in progress
  lastSyncTime: number;
  syncVersion: number;          // For concurrency control
}

export interface FileHashRecord {
  path: string;                 // Relative file path
  hash: string;                 // SHA256 of file content
  chunkCount: number;
  lastModified: number;
  syncedAt: number;
}

export interface MemoryChunk {
  text: string;
  hash: string;
  startLine: number;
  endLine: number;
}

export interface SyncResult {
  added: number;
  removed: number;
  unchanged: number;
  errors: string[];
}

// ==================== Scheduler Types ====================

export interface ConsolidationResult {
  success: boolean;
  memoriesProcessed: number;
  memoriesAdded: number;
  memoriesMerged: number;
  error?: string;
}

export interface CleanupResult {
  success: boolean;
  filesDeleted: number;
  memoriesDeleted: number;
  error?: string;
}

// ==================== Status Types ====================

export interface MemoryServiceStatus {
  initialized: boolean;
  workspacePath: string | null;
  databasePath: string | null;
  vectorAvailable: boolean | null;  // null = not tested
  totalMemories: number;
  activeMemories: number;
  syncState: SyncState;
  config: MemoryConfig;
}

// ==================== Utility Types ====================

export type VectorAvailability = 'unknown' | 'available' | 'unavailable';

export interface EmbeddingCacheEntry {
  contentHash: string;
  embedding: Float32Array;
  model: string;
  dims: number;
  accessCount: number;
  createdAt: number;
  lastAccessedAt: number;
}
