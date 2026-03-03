/**
 * Memory Service - Main Orchestrator
 *
 * Coordinates all memory modules for the long-term memory system
 * Based on specs/long-memory/long-memory.md
 */

import { EventEmitter } from 'events';
import log from 'electron-log';
import type {
  MemoryConfig,
  MemoryEntry,
  ExtractedMemory,
  MemorySearchResult,
  SyncResult,
  MemoryServiceStatus,
  ModelConfig,
  InjectionOptions,
  HybridSearchOptions,
} from './types';
import { DEFAULT_CONFIG } from './constants';
import { MemoryDatabase, memoryDatabase } from './MemoryDatabase';
import { MemoryFileSync, memoryFileSync } from './MemoryFileSync';
import { MemoryExtractor, memoryExtractor } from './MemoryExtractor';
import { ExtractionQueue } from './ExtractionQueue';
import { MemoryRetriever, memoryRetriever } from './MemoryRetriever';
import { MemoryInjector, memoryInjector } from './MemoryInjector';
import { MemoryScheduler, memoryScheduler } from './MemoryScheduler';

// ==================== MemoryService Class ====================

export class MemoryService extends EventEmitter {
  private config: MemoryConfig;
  private initialized: boolean = false;
  private workspaceDir: string | null = null;

  // Module instances
  private database: MemoryDatabase;
  private fileSync: MemoryFileSync;
  private extractor: MemoryExtractor;
  private extractionQueue: ExtractionQueue;
  private retriever: MemoryRetriever;
  private injector: MemoryInjector;
  private scheduler: MemoryScheduler;

  // Batch extraction tracking (Spec 5.3 方式 2)
  private messageWindow: Array<{ role: 'user' | 'assistant'; content: string }> = [];
  private turnCount: number = 0;

  constructor() {
    super();
    this.config = { ...DEFAULT_CONFIG };

    // Initialize modules
    this.database = memoryDatabase;
    this.fileSync = memoryFileSync;
    this.extractor = memoryExtractor;
    this.extractionQueue = new ExtractionQueue(this.extractor);
    this.retriever = memoryRetriever;
    this.injector = memoryInjector;
    this.scheduler = memoryScheduler;
  }

  // ==================== Lifecycle ====================

  /**
   * Initialize memory service
   */
  async init(workspaceDir: string, config?: Partial<MemoryConfig>): Promise<boolean> {
    if (this.initialized) {
      log.warn('[MemoryService] Already initialized');
      return true;
    }

    try {
      // Merge config
      if (config) {
        this.config = this.mergeConfig(config);
      }
      this.config.storage.workspacePath = workspaceDir;
      this.workspaceDir = workspaceDir;

      log.info('[MemoryService] Initializing with workspace:', workspaceDir);

      // Initialize database
      await this.database.init(workspaceDir, this.config);

      // Initialize file sync
      await this.fileSync.init({
        workspaceDir,
        database: this.database,
      });

      // Configure extractor
      this.extractor.configure({
        explicitEnabled: this.config.extraction.explicitEnabled,
        implicitEnabled: this.config.extraction.implicitEnabled,
        guardLevel: this.config.extraction.guardLevel,
      });

      // Initialize extraction queue
      this.extractionQueue.init(this.fileSync, {
        maxRetries: this.config.extraction.llm.maxRetries,
        processingInterval: 1000,
        maxQueueSize: 100,
      });

      // Initialize retriever
      this.retriever.init(this.database);
      this.retriever.configure({
        vectorWeight: this.config.retrieval.vectorWeight,
        ftsWeight: this.config.retrieval.ftsWeight,
        limit: this.config.retrieval.limit,
        minScore: this.config.retrieval.minScore,
        dailyMemoryDays: this.config.retrieval.dailyMemoryDays,
      });

      // Initialize injector
      this.injector.init(this.retriever);

      // Initialize scheduler
      this.scheduler.init(this.fileSync, this.database);
      this.scheduler.configure({
        consolidationCron: this.config.scheduler.consolidationCron,
        cleanupCron: this.config.scheduler.cleanupCron,
        consolidationEnabled: this.config.scheduler.consolidationEnabled,
        cleanupEnabled: this.config.scheduler.cleanupEnabled,
        dailyRetentionDays: this.config.storage.dailyRetentionDays,
      });

      // Start scheduler
      this.scheduler.start();

      // Start extraction queue
      this.extractionQueue.start();

      // Run startup sync (async, non-blocking)
      this.fileSync.syncOnStartup().catch(err => {
        log.error('[MemoryService] Startup sync failed:', err);
      });

      this.initialized = true;
      log.info('[MemoryService] Initialized successfully');

      this.emit('initialized');
      return true;

    } catch (error) {
      log.error('[MemoryService] Initialization failed:', error);
      this.emit('error', error);
      return false;
    }
  }

  /**
   * Destroy memory service
   */
  async destroy(): Promise<void> {
    if (!this.initialized) {
      return;
    }

    log.info('[MemoryService] Destroying...');

    // Stop scheduler
    this.scheduler.stop();
    this.scheduler.destroy();

    // Stop extraction queue
    this.extractionQueue.stop();
    this.extractionQueue.destroy();

    // Close file sync
    this.fileSync.destroy();

    // Close database
    this.database.close();

    this.initialized = false;
    this.workspaceDir = null;

    log.info('[MemoryService] Destroyed');
    this.emit('destroyed');
  }

  /**
   * Check if service is initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Ensure memory is ready for a new session
   * Called before starting an agent session to ensure memory index is up-to-date
   * Based on Spec 4.2 场景 2
   */
  async ensureMemoryReadyForSession(): Promise<{ ready: boolean; synced: boolean }> {
    if (!this.initialized) {
      return { ready: false, synced: false };
    }

    const { dirty, syncing } = this.database.getSyncState();

    // Fast path: index is up-to-date
    if (!dirty) {
      log.debug('[MemoryService] Memory index is up-to-date');
      return { ready: true, synced: false };
    }

    log.info('[MemoryService] Memory index is dirty, ensuring sync before session...');

    // Wait if sync is in progress (max 5 seconds)
    if (syncing) {
      const waitSuccess = await this.waitForSyncComplete({ timeout: 5000 });
      if (waitSuccess) {
        return { ready: true, synced: true };
      }
      // Timeout waiting for sync, but still proceed
      log.warn('[MemoryService] Sync wait timeout, proceeding with potentially stale index');
      return { ready: true, synced: false };
    }

    // Trigger incremental sync
    try {
      await this.fileSync.syncOnStartup();
      log.info('[MemoryService] Memory sync completed for session');
      return { ready: true, synced: true };
    } catch (error) {
      log.error('[MemoryService] Failed to sync memory before session:', error);
      // Still proceed, just with potentially stale data
      return { ready: true, synced: false };
    }
  }

  /**
   * Wait for current sync to complete
   * @param options.timeout - Maximum time to wait in milliseconds
   * @returns true if sync completed, false if timeout
   */
  private async waitForSyncComplete(options: { timeout: number }): Promise<boolean> {
    const startTime = Date.now();

    while (Date.now() - startTime < options.timeout) {
      const { syncing } = this.database.getSyncState();
      if (!syncing) {
        return true;
      }
      // Wait 100ms before checking again
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    return false;
  }

  // ==================== Configuration ====================

  /**
   * Get current configuration
   */
  getConfig(): MemoryConfig {
    return { ...this.config };
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<MemoryConfig>): void {
    this.config = this.mergeConfig(config);

    // Update modules
    this.extractor.configure({
      explicitEnabled: this.config.extraction.explicitEnabled,
      implicitEnabled: this.config.extraction.implicitEnabled,
      guardLevel: this.config.extraction.guardLevel,
    });

    this.retriever.configure({
      vectorWeight: this.config.retrieval.vectorWeight,
      ftsWeight: this.config.retrieval.ftsWeight,
      limit: this.config.retrieval.limit,
      minScore: this.config.retrieval.minScore,
      dailyMemoryDays: this.config.retrieval.dailyMemoryDays,
    });

    this.scheduler.configure({
      consolidationCron: this.config.scheduler.consolidationCron,
      cleanupCron: this.config.scheduler.cleanupCron,
      consolidationEnabled: this.config.scheduler.consolidationEnabled,
      cleanupEnabled: this.config.scheduler.cleanupEnabled,
      dailyRetentionDays: this.config.storage.dailyRetentionDays,
    });

    log.info('[MemoryService] Configuration updated');
    this.emit('config:updated', this.config);
  }

  /**
   * Merge partial config with defaults
   */
  private mergeConfig(partial: Partial<MemoryConfig>): MemoryConfig {
    return {
      ...this.config,
      ...partial,
      extraction: {
        ...this.config.extraction,
        ...partial.extraction,
        trigger: {
          ...this.config.extraction.trigger,
          ...partial.extraction?.trigger,
        },
        llm: {
          ...this.config.extraction.llm,
          ...partial.extraction?.llm,
        },
      },
      storage: {
        ...this.config.storage,
        ...partial.storage,
      },
      embedding: {
        ...this.config.embedding,
        ...partial.embedding,
      },
      retrieval: {
        ...this.config.retrieval,
        ...partial.retrieval,
      },
      scheduler: {
        ...this.config.scheduler,
        ...partial.scheduler,
      },
    };
  }

  // ==================== Memory Extraction ====================

  /**
   * Extract memories from conversation
   *
   * @param sessionId - Session ID
   * @param messageId - Trigger message ID
   * @param messages - Conversation messages
   * @param modelConfig - Model config (MUST include apiKey!)
   */
  extractFromConversation(
    sessionId: string,
    messageId: string,
    messages: Array<{ role: 'user' | 'assistant'; content: string }>,
    modelConfig: ModelConfig
  ): string {
    if (!this.initialized || !this.config.enabled) {
      return '';
    }

    // Quick check if there's extractable content
    const hasExtractable = messages.some(m =>
      this.extractor.hasExtractableContent(m.content)
    );

    if (!hasExtractable) {
      return '';
    }

    // Add to extraction queue
    // IMPORTANT: modelConfig must include apiKey!
    const taskId = this.extractionQueue.enqueue(
      sessionId,
      messageId,
      messages,
      modelConfig
    );

    log.debug('[MemoryService] Extraction task queued:', taskId);
    return taskId;
  }

  /**
   * Manually append memory to daily file
   */
  appendMemory(content: string, title?: string): void {
    if (!this.initialized) {
      return;
    }

    this.fileSync.appendToDailyMemory(content, title);
  }

  // ==================== Batch Extraction (Spec 5.3 方式 2) ====================

  /**
   * Add message to sliding window and check for batch extraction
   * Call this after each conversation turn
   *
   * @param message - The message to add
   * @param sessionId - Session ID
   * @param modelConfig - Model config (MUST include apiKey!)
   */
  addMessageToWindow(
    message: { role: 'user' | 'assistant'; content: string },
    sessionId: string,
    modelConfig: ModelConfig
  ): void {
    if (!this.initialized || !this.config.extraction.enabled) {
      return;
    }

    // Add to window
    this.messageWindow.push(message);
    this.turnCount++;

    // Keep window size limited (last 10 messages)
    const maxWindowSize = 10;
    if (this.messageWindow.length > maxWindowSize) {
      this.messageWindow.shift();
    }

    // Check if batch extraction should trigger
    const batchInterval = this.config.extraction.trigger?.batchInterval ?? 3;
    if (this.turnCount % batchInterval === 0) {
      this.triggerBatchExtraction(sessionId, modelConfig);
    }
  }

  /**
   * Trigger batch extraction for implicit memories
   * Analyzes messages in the sliding window for extractable content
   */
  private triggerBatchExtraction(sessionId: string, modelConfig: ModelConfig): void {
    if (!this.config.extraction.implicitEnabled) {
      return;
    }

    const messages = [...this.messageWindow];

    // Check if any messages have implicit signals
    const hasImplicitSignals = messages.some(m =>
      this.extractor.hasExtractableContent(m.content, {
        explicitEnabled: false,
        implicitEnabled: true,
      })
    );

    if (hasImplicitSignals) {
      const taskId = this.extractFromConversation(
        sessionId,
        `batch-${Date.now()}`,
        messages,
        modelConfig
      );
      log.debug('[MemoryService] Batch extraction triggered:', taskId);
    }
  }

  /**
   * Get current turn count for session
   */
  getTurnCount(): number {
    return this.turnCount;
  }

  /**
   * Reset message window for new session
   */
  resetMessageWindow(): void {
    this.messageWindow = [];
    this.turnCount = 0;
    log.debug('[MemoryService] Message window reset');
  }

  /**
   * Trigger extraction when session ends (Spec 5.3 方式 3)
   * Analyzes all session messages for final extraction
   *
   * @param sessionId - Session ID
   * @param messages - All session messages
   * @param modelConfig - Model config (MUST include apiKey!)
   */
  async onSessionEnd(
    sessionId: string,
    messages: Array<{ role: 'user' | 'assistant'; content: string }>,
    modelConfig: ModelConfig
  ): Promise<string> {
    if (!this.initialized || !this.config.extraction.enabled) {
      return '';
    }

    // Check if session end extraction is enabled
    if (!this.config.extraction.trigger?.onSessionEnd) {
      return '';
    }

    // Check if any messages have extractable content
    const hasExtractable = messages.some(m =>
      this.extractor.hasExtractableContent(m.content)
    );

    if (!hasExtractable) {
      return '';
    }

    log.info('[MemoryService] Session end extraction for session:', sessionId);

    // Extract from all session messages
    const taskId = this.extractFromConversation(
      sessionId,
      'session-end',
      messages,
      modelConfig
    );

    // Reset window for next session
    this.resetMessageWindow();

    return taskId;
  }

  // ==================== Memory Retrieval ====================

  /**
   * Search memories
   */
  async search(query: string, options?: HybridSearchOptions): Promise<MemorySearchResult[]> {
    if (!this.initialized) {
      return [];
    }

    return this.retriever.search(query, options);
  }

  /**
   * Get memory context for injection
   */
  async getInjectionContext(query: string, options?: InjectionOptions): Promise<string> {
    if (!this.initialized) {
      return '';
    }

    return this.injector.buildContext(query, options);
  }

  /**
   * Inject memories into system prompt
   */
  async injectIntoPrompt(
    systemPrompt: string,
    query: string,
    options?: InjectionOptions
  ): Promise<string> {
    if (!this.initialized) {
      return systemPrompt;
    }

    return this.injector.injectIntoPrompt(systemPrompt, query, options);
  }

  // ==================== Memory Management ====================

  /**
   * Add memory manually
   */
  addMemory(entry: Partial<MemoryEntry>): string | null {
    if (!this.initialized) {
      return null;
    }

    const now = Date.now();
    const fullEntry: MemoryEntry = {
      id: entry.id ?? `mem_${now}`,
      text: entry.text ?? '',
      fingerprint: entry.fingerprint ?? '',
      category: entry.category ?? 'fact',
      confidence: entry.confidence ?? 0.75,
      isExplicit: entry.isExplicit ?? true,
      importance: entry.importance ?? 0.5,
      source: entry.source ?? 'core',
      sourcePath: entry.sourcePath ?? 'MEMORY.md',
      status: entry.status ?? 'active',
      accessCount: entry.accessCount ?? 0,
      createdAt: entry.createdAt ?? now,
      updatedAt: entry.updatedAt ?? now,
    };

    this.database.insertMemory(fullEntry);
    return fullEntry.id;
  }

  /**
   * Update memory
   */
  updateMemory(id: string, updates: Partial<MemoryEntry>): void {
    if (!this.initialized) {
      return;
    }

    this.database.updateMemory(id, updates);
  }

  /**
   * Delete memory
   */
  deleteMemory(id: string): void {
    if (!this.initialized) {
      return;
    }

    this.database.deleteMemory(id);
  }

  /**
   * List memories
   */
  listMemories(options?: { status?: string; source?: string; limit?: number }): MemoryEntry[] {
    if (!this.initialized) {
      return [];
    }

    return this.database.getMemories(options as any);
  }

  // ==================== File Operations ====================

  /**
   * Sync workspace files
   */
  async syncWorkspace(): Promise<SyncResult> {
    if (!this.initialized) {
      return { added: 0, removed: 0, unchanged: 0, errors: ['Not initialized'] };
    }

    return this.fileSync.syncOnStartup();
  }

  /**
   * Rebuild entire index
   */
  async rebuildIndex(): Promise<SyncResult> {
    if (!this.initialized) {
      return { added: 0, removed: 0, unchanged: 0, errors: ['Not initialized'] };
    }

    return this.fileSync.rebuildIndex();
  }

  /**
   * Get memory files
   */
  getMemoryFiles(): string[] {
    if (!this.initialized) {
      return [];
    }

    return this.fileSync.getAllMemoryFiles();
  }

  // ==================== Scheduled Tasks ====================

  /**
   * Run consolidation manually
   */
  /**
   * Run consolidation manually
   * @param modelConfig - Optional model config for LLM-based consolidation
   */
  async runConsolidation(modelConfig?: {
    provider: string;
    model: string;
    apiKey: string;
    baseUrl?: string;
  }) {
    if (!this.initialized) {
      return { success: false, error: 'Not initialized' };
    }

    return this.scheduler.runConsolidation(modelConfig);
  }

  /**
   * Run cleanup manually
   */
  async runCleanup() {
    if (!this.initialized) {
      return { success: false, error: 'Not initialized' };
    }

    return this.scheduler.runCleanup();
  }

  // ==================== Vector Operations ====================

  /**
   * Check vector support
   */
  async checkVectorSupport(): Promise<{
    available: boolean;
    backend: string;
  }> {
    if (!this.initialized) {
      return { available: false, backend: 'none' };
    }

    const available = this.database.isVectorAvailable();
    return {
      available,
      backend: available ? 'sqlite-vec' : 'js',
    };
  }

  /**
   * Set embedding configuration
   */
  setEmbeddingConfig(config: {
    enabled: boolean;
    provider?: string;
    model?: string;
    dimensions?: number;
    apiKey?: string;
  }): void {
    this.updateConfig({
      embedding: {
        ...this.config.embedding,
        enabled: config.enabled,
        provider: (config.provider as any) ?? this.config.embedding.provider,
        model: config.model ?? this.config.embedding.model,
        dimensions: config.dimensions ?? this.config.embedding.dimensions,
        apiKey: config.apiKey,
      },
    });

    // Try to load vector extension if enabled
    if (config.enabled) {
      this.database.loadVectorExtension();
    }
  }

  // ==================== Status ====================

  /**
   * Get service status
   */
  getStatus(): MemoryServiceStatus {
    const vecAvailability = this.database.getVectorAvailability();
    return {
      initialized: this.initialized,
      workspacePath: this.workspaceDir,
      databasePath: this.database.getDbPath(),
      vectorAvailable: vecAvailability === 'unknown' ? null : vecAvailability === 'available',
      totalMemories: this.initialized ? this.database.countMemories() : 0,
      activeMemories: this.initialized ? this.database.countMemories('active') : 0,
      syncState: this.fileSync.getSyncState(),
      config: this.getConfig(),
    };
  }

  /**
   * Get extraction queue status
   */
  getQueueStatus(): {
    length: number;
    pending: Array<{
      taskId: string;
      sessionId: string;
      messageId: string;
      timestamp: number;
      retryCount: number;
    }>;
  } {
    return {
      length: this.extractionQueue.getLength(),
      pending: this.extractionQueue.getPendingTasks(),
    };
  }

  /**
   * Get scheduler status
   */
  getSchedulerStatus(): ReturnType<MemoryScheduler['getStatus']> {
    return this.scheduler.getStatus();
  }
}

// Export singleton
export const memoryService = new MemoryService();
