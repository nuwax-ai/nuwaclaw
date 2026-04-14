/**
 * Long-Term Memory Constants
 *
 * Default values and constants based on specs/long-memory/long-memory.md
 */

import * as path from "path";
import type { MemoryConfig, SyncState } from "./types";

// ==================== File Names ====================

export const CORE_MEMORY_FILE = "MEMORY.md";

// Memory directory structure:
// memory/
//   ├── index.sqlite      (database)
//   ├── transcripts/      (session transcripts)
//   └── daily/            (daily memory files)
export const MEMORY_ROOT_DIR = "memory";
export const DAILY_MEMORY_DIR = path.join("memory", "daily"); // Daily memory files: memory/daily/
export const MEMORY_DB_DIR = "memory"; // Database: memory/index.sqlite
export const MEMORY_DB_FILE = "index.sqlite";
export const TRANSCRIPT_DIR = path.join("memory", "transcripts"); // Transcripts: memory/transcripts/

// ==================== Default Configuration ====================

export const DEFAULT_CONFIG: MemoryConfig = {
  enabled: true,

  extraction: {
    enabled: true,
    implicitEnabled: true,
    explicitEnabled: true,
    guardLevel: "standard",
    trigger: {
      onEveryTurn: true,
      onSegmentFull: true,
      onSessionEnd: true,
      onIdleTimeout: true, // Extract after idle timeout
      idleTimeoutMs: 60000, // 60 seconds idle timeout
    },
    llm: {
      maxTokensPerExtract: 800,
      temperature: 0.3,
      maxRetries: 2,
    },
  },

  storage: {
    workspacePath: "",
    dailyRetentionDays: 30,
    maxMemories: 500,
  },

  embedding: {
    enabled: false,
    backend: "auto",
    provider: "openai",
    model: "text-embedding-3-small",
    dimensions: 1536,
    cacheMaxEntries: 10000,
  },

  retrieval: {
    vectorWeight: 0.7,
    ftsWeight: 0.3,
    limit: 12,
    minScore: 0.4,
    dailyMemoryDays: 2,
  },

  scheduler: {
    consolidationCron: "0 0 * * *", // 00:00 daily
    cleanupCron: "0 1 * * *", // 01:00 daily
    consolidationEnabled: true,
    cleanupEnabled: true,
  },

  segmentation: {
    segmentSize: 5, // Changed from 5 to 1 for testing - triggers extraction after each message
    segmentOverlap: 0, // Changed from 2 to 0 for testing
    maxSegmentTokens: 4000,
    maxContentPerMessage: 1500,
  },

  transcript: {
    enabled: true,
    retentionDays: 7,
  },

  deduplication: {
    textSimilarityThreshold: 0.8,
    vectorSimilarityThreshold: 0.95,
  },
};

// ==================== Sync State Defaults ====================

export const DEFAULT_SYNC_STATE: SyncState = {
  dirty: false,
  syncing: false,
  lastSyncTime: 0,
  syncVersion: 0,
};

// ==================== Chunking Constants ====================

export const CHUNK_MAX_CHARS = 1000;
export const CHUNK_OVERLAP_CHARS = 100;

// ==================== File Watching Constants ====================

export const WATCH_DEBOUNCE_MS = 1500; // 1.5 seconds

// ==================== Vector Loading Constants ====================

export const VECTOR_LOAD_TIMEOUT_MS = 30000; // 30 seconds

// ==================== Session Sync Constants ====================

export const SESSION_SYNC_WAIT_TIMEOUT_MS = 5000; // 5 seconds max wait

// ==================== Scoring Constants ====================

// Positive scoring rules
export const SCORE_PERSONAL_FACT = 0.3; // Contains personal fact
export const SCORE_APPROPRIATE_LENGTH = 0.1; // Length 10-200 chars
export const SCORE_CLEAR_PREFERENCE = 0.2; // Clear preference expression

// Negative scoring rules
export const SCORE_QUESTION = -0.2; // Is a question
export const SCORE_TEMPORARY = -0.2; // Temporary information
export const SCORE_CODE = -0.3; // Pure code/instruction
export const SCORE_SPECIFIC_TIME = -0.1; // Too specific time point

// Validation thresholds
export const SCORE_MIN_ACCEPT = 0.6; // Minimum score to accept
export const SCORE_LLM_THRESHOLD_LOW = 0.5; // Below this: reject
export const SCORE_LLM_THRESHOLD_HIGH = 0.7; // Above this: accept without LLM

// ==================== Meta Keys ====================

export const META_KEYS = {
  SCHEMA_VERSION: "schema_version",
  EMBEDDING_ENABLED: "embedding_enabled",
  EMBEDDING_MODEL: "embedding_model",
  EMBEDDING_DIMS: "embedding_dims",
  EMBEDDING_PROVIDER: "embedding_provider",
  VECTOR_AVAILABLE: "vector_available",
  DIRTY: "dirty",
  SYNCING: "syncing",
  SYNC_VERSION: "sync_version",
  LAST_SYNC_TIME: "last_sync_time",
  CONSOLIDATION_LAST_RUN: "consolidation_last_run",
  CLEANUP_LAST_RUN: "cleanup_last_run",
} as const;

// ==================== Schema Version ====================

export const SCHEMA_VERSION = "2";

// ==================== Memory Status ====================

export const MEMORY_STATUS = {
  ACTIVE: "active",
  ARCHIVED: "archived",
  DELETED: "deleted",
} as const;

// ==================== Memory Categories ====================

export const MEMORY_CATEGORIES = {
  FACT: "fact",
  PREFERENCE: "preference",
  EVENT: "event",
  SKILL: "skill",
  DECISION: "decision",
} as const;

// ==================== Memory Sources ====================

export const MEMORY_SOURCES = {
  CORE: "core",
  DAILY: "daily",
} as const;

// ==================== LLM Prompts ====================

export const LLM_EXTRACTION_PROMPT = `You are a memory extraction assistant. From the conversation excerpt below, extract information worth remembering long-term.

## Conversation excerpt {segment_info}
{conversation_history}

## Known memories (avoid duplicates)
{existing_memories}

## Extraction rules
1. Only extract personal facts, preferences, habits, and important decisions about the user.
2. Ignore:
   - Ephemeral state (e.g. "I'm tired today")
   - Pure questions or instructions
   - Information that clearly duplicates known memories
   - The code itself (but preferences or decisions about code may be extracted)
3. Each memory should be a standalone, complete statement.

## Output format
Return a JSON array; each item has:
{
  "text": "memory text",
  "category": "fact|preference|event|skill|decision",
  "confidence": 0.0-1.0
}

If nothing is worth remembering, return an empty array [].`;

export const LLM_VALIDATION_PROMPT = `You are a memory validation assistant. Decide whether the candidate memory below is worth saving.

## Candidate memory
{candidate_memory}

## Existing memories
{existing_memories}

## Rules
1. Does it conflict with or duplicate existing memories?
2. Does it have long-term value?
3. Is it personal information about the user rather than general knowledge?

## Output
{
  "accept": true/false,
  "reason": "why accepted or rejected",
  "merged_text": "if merging is needed, the merged text"
}`;

export const LLM_CONSOLIDATION_PROMPT = `You are a memory consolidation assistant. Merge recent daily memories into the core long-term memory.

## Daily memories (last ~2 days)
{daily_memories}

## Current core memory
{core_memories}

## Rules
1. Pull important facts from the daily memories.
2. Merge with core memory and deduplicate.
3. Preserve structure and Markdown formatting.
4. Organize under: User profile, Preferences, Project-related, Important decisions.

## Output
Return the full updated MEMORY.md content in Markdown.`;

// ==================== Cleanup Constants ====================

export const DEFAULT_TRANSCRIPT_RETENTION_DAYS = 7;
export const DEFAULT_STALE_PENDING_HOURS = 24;
