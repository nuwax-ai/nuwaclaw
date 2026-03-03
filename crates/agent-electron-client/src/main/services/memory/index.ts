/**
 * Memory Service Module
 *
 * Long-term memory system for Electron client
 * Based on specs/long-memory/long-memory.md
 */

// ==================== Types ====================
export * from './types';

// ==================== Constants ====================
export * from './constants';

// ==================== Core Modules ====================
export { MemoryDatabase, memoryDatabase } from './MemoryDatabase';
export { MemoryFileSync, memoryFileSync } from './MemoryFileSync';
export { MemoryExtractor, memoryExtractor } from './MemoryExtractor';
export { ExtractionQueue } from './ExtractionQueue';
export { MemoryRetriever, memoryRetriever } from './MemoryRetriever';
export { MemoryInjector, memoryInjector } from './MemoryInjector';
export { MemoryScheduler, memoryScheduler } from './MemoryScheduler';

// ==================== Main Service ====================
export { MemoryService, memoryService } from './MemoryService';

// ==================== Utilities ====================
export * from './utils/hash';
export * from './utils/vector';
export * from './utils/chunker';
export * from './utils/signals';
