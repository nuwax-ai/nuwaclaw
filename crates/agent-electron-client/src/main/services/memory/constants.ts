/**
 * Long-Term Memory Constants
 *
 * Default values and constants based on specs/long-memory/long-memory.md
 */

import * as path from 'path';
import type { MemoryConfig, SyncState } from './types';

// ==================== File Names ====================

export const CORE_MEMORY_FILE = 'MEMORY.md';

// Memory directory structure:
// memory/
//   ├── index.sqlite      (database)
//   ├── transcripts/      (session transcripts)
//   └── daily/            (daily memory files)
export const MEMORY_ROOT_DIR = 'memory';
export const DAILY_MEMORY_DIR = path.join('memory', 'daily');  // Daily memory files: memory/daily/
export const MEMORY_DB_DIR = 'memory';  // Database: memory/index.sqlite
export const MEMORY_DB_FILE = 'index.sqlite';
export const TRANSCRIPT_DIR = path.join('memory', 'transcripts');  // Transcripts: memory/transcripts/

// ==================== Default Configuration ====================

export const DEFAULT_CONFIG: MemoryConfig = {
  enabled: true,

  extraction: {
    enabled: true,
    implicitEnabled: true,
    explicitEnabled: true,
    guardLevel: 'standard',
    trigger: {
      onEveryTurn: true,
      onSegmentFull: true,
      onSessionEnd: true,
      onIdleTimeout: true,       // Extract after idle timeout
      idleTimeoutMs: 60000,      // 60 seconds idle timeout
    },
    llm: {
      maxTokensPerExtract: 800,
      temperature: 0.3,
      maxRetries: 2,
    },
  },

  storage: {
    workspacePath: '',
    dailyRetentionDays: 30,
    maxMemories: 500,
  },

  embedding: {
    enabled: false,
    backend: 'auto',
    provider: 'openai',
    model: 'text-embedding-3-small',
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
    consolidationCron: '0 0 * * *',   // 00:00 daily
    cleanupCron: '0 1 * * *',         // 01:00 daily
    consolidationEnabled: true,
    cleanupEnabled: true,
  },

  segmentation: {
    segmentSize: 5,  // Changed from 5 to 1 for testing - triggers extraction after each message
    segmentOverlap: 0,  // Changed from 2 to 0 for testing
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

export const WATCH_DEBOUNCE_MS = 1500;  // 1.5 seconds

// ==================== Vector Loading Constants ====================

export const VECTOR_LOAD_TIMEOUT_MS = 30000;  // 30 seconds

// ==================== Session Sync Constants ====================

export const SESSION_SYNC_WAIT_TIMEOUT_MS = 5000;  // 5 seconds max wait

// ==================== Scoring Constants ====================

// Positive scoring rules
export const SCORE_PERSONAL_FACT = 0.3;      // Contains personal fact
export const SCORE_APPROPRIATE_LENGTH = 0.1; // Length 10-200 chars
export const SCORE_CLEAR_PREFERENCE = 0.2;   // Clear preference expression

// Negative scoring rules
export const SCORE_QUESTION = -0.2;          // Is a question
export const SCORE_TEMPORARY = -0.2;         // Temporary information
export const SCORE_CODE = -0.3;              // Pure code/instruction
export const SCORE_SPECIFIC_TIME = -0.1;     // Too specific time point

// Validation thresholds
export const SCORE_MIN_ACCEPT = 0.6;         // Minimum score to accept
export const SCORE_LLM_THRESHOLD_LOW = 0.5;  // Below this: reject
export const SCORE_LLM_THRESHOLD_HIGH = 0.7; // Above this: accept without LLM

// ==================== Meta Keys ====================

export const META_KEYS = {
  SCHEMA_VERSION: 'schema_version',
  EMBEDDING_ENABLED: 'embedding_enabled',
  EMBEDDING_MODEL: 'embedding_model',
  EMBEDDING_DIMS: 'embedding_dims',
  EMBEDDING_PROVIDER: 'embedding_provider',
  VECTOR_AVAILABLE: 'vector_available',
  DIRTY: 'dirty',
  SYNCING: 'syncing',
  SYNC_VERSION: 'sync_version',
  LAST_SYNC_TIME: 'last_sync_time',
  CONSOLIDATION_LAST_RUN: 'consolidation_last_run',
  CLEANUP_LAST_RUN: 'cleanup_last_run',
} as const;

// ==================== Schema Version ====================

export const SCHEMA_VERSION = '2';

// ==================== Memory Status ====================

export const MEMORY_STATUS = {
  ACTIVE: 'active',
  ARCHIVED: 'archived',
  DELETED: 'deleted',
} as const;

// ==================== Memory Categories ====================

export const MEMORY_CATEGORIES = {
  FACT: 'fact',
  PREFERENCE: 'preference',
  EVENT: 'event',
  SKILL: 'skill',
  DECISION: 'decision',
} as const;

// ==================== Memory Sources ====================

export const MEMORY_SOURCES = {
  CORE: 'core',
  DAILY: 'daily',
} as const;

// ==================== LLM Prompts ====================

export const LLM_EXTRACTION_PROMPT = `你是一个记忆提取助手。请从以下对话片段中提取值得长期记忆的信息。

## 对话片段 {segment_info}
{conversation_history}

## 已知记忆 (避免重复)
{existing_memories}

## 提取规则
1. 只提取关于用户的个人事实、偏好、习惯、重要决策
2. 忽略:
   - 临时性信息 (如"我今天很累")
   - 纯粹的问题或指令
   - 已知的重复信息
   - 代码片段本身 (但代码相关的偏好/决策可以提取)
3. 每条记忆应该是独立的、完整的陈述

## 输出格式
返回 JSON 数组，每条记忆包含:
{
  "text": "记忆文本",
  "category": "fact|preference|event|skill|decision",
  "confidence": 0.0-1.0
}

如果没有值得记忆的信息，返回空数组 []`;

export const LLM_VALIDATION_PROMPT = `你是一个记忆验证助手。请判断以下候选记忆是否值得保存。

## 候选记忆
{candidate_memory}

## 现有记忆
{existing_memories}

## 判断规则
1. 是否与现有记忆冲突或重复?
2. 是否具有长期价值?
3. 是否是用户个人信息而非通用知识?

## 输出
{
  "accept": true/false,
  "reason": "拒绝或接受的原因",
  "merged_text": "如果需要合并，提供合并后的文本"
}`;

export const LLM_CONSOLIDATION_PROMPT = `你是一个记忆整合助手。请将最近的每日记忆整合到核心长期记忆中。

## 最近 2 天的记忆
{daily_memories}

## 当前核心记忆
{core_memories}

## 整合规则
1. 提取每日记忆中的重要信息
2. 与核心记忆合并，去重
3. 保持核心记忆的结构和格式
4. 按类别整理：用户档案、偏好、项目相关、重要决策

## 输出
输出更新后的完整 MEMORY.md 内容，保持 Markdown 格式。`;

// ==================== Cleanup Constants ====================

export const DEFAULT_TRANSCRIPT_RETENTION_DAYS = 7;
export const DEFAULT_STALE_PENDING_HOURS = 24;
