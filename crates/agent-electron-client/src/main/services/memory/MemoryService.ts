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
  ExtractionProgressRecord,
} from './types';
import { DEFAULT_CONFIG } from './constants';
import { MemoryDatabase, memoryDatabase } from './MemoryDatabase';
import { MemoryFileSync, memoryFileSync } from './MemoryFileSync';
import { MemoryExtractor, memoryExtractor } from './MemoryExtractor';
import { ExtractionQueue } from './ExtractionQueue';
import { MemoryRetriever, memoryRetriever } from './MemoryRetriever';
import { MemoryInjector, memoryInjector } from './MemoryInjector';
import { MemoryScheduler, memoryScheduler } from './MemoryScheduler';
import { TranscriptWriter, transcriptWriter } from './TranscriptWriter';
import { buildSegments, buildSegmentsFromIndex } from './utils/segmenter';

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
  private transcriptWriter: TranscriptWriter;

  // Per-session segment tracking: sessionId → message count since last segment
  private segmentCounters: Map<string, number> = new Map();
  // Per-session segment index tracking: sessionId → next segment index
  private segmentIndexCounters: Map<string, number> = new Map();
  // Per-session idle timers: sessionId → timer handle
  private idleTimers: Map<string, NodeJS.Timeout> = new Map();
  // Per-session model config for idle timeout extraction
  private sessionModelConfigs: Map<string, ModelConfig> = new Map();

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
    this.transcriptWriter = transcriptWriter;
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

      // Initialize transcript writer
      this.transcriptWriter.init(workspaceDir);

      // Initialize extraction queue (with database for progress tracking)
      this.extractionQueue.init(this.fileSync, {
        maxRetries: this.config.extraction.llm.maxRetries,
        processingInterval: 1000,
        maxQueueSize: 100,
      }, this.database, this.config.deduplication);

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
      this.scheduler.init(this.fileSync, this.database, this.transcriptWriter);
      this.scheduler.configure({
        consolidationCron: this.config.scheduler.consolidationCron,
        cleanupCron: this.config.scheduler.cleanupCron,
        consolidationEnabled: this.config.scheduler.consolidationEnabled,
        cleanupEnabled: this.config.scheduler.cleanupEnabled,
        dailyRetentionDays: this.config.storage.dailyRetentionDays,
        transcriptRetentionDays: this.config.transcript.retentionDays,
        stalePendingHours: 24,
      });

      // Set active session provider so cleanup skips active sessions
      this.scheduler.setActiveSessionProvider(
        () => new Set(this.segmentCounters.keys())
      );

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

    // Destroy transcript writer
    this.transcriptWriter.destroy();

    // Close file sync
    this.fileSync.destroy();

    // Close database
    this.database.close();

    this.initialized = false;
    this.workspaceDir = null;
    this.segmentCounters.clear();
    this.segmentIndexCounters.clear();

    // Clear all idle timers
    for (const timer of this.idleTimers.values()) {
      clearTimeout(timer);
    }
    this.idleTimers.clear();
    this.sessionModelConfigs.clear();

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
      transcriptRetentionDays: this.config.transcript.retentionDays,
      stalePendingHours: 24,
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
      segmentation: {
        ...this.config.segmentation,
        ...partial.segmentation,
      },
      transcript: {
        ...this.config.transcript,
        ...partial.transcript,
      },
      deduplication: {
        ...this.config.deduplication,
        ...partial.deduplication,
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

  // ==================== Segmented Extraction (Spec 5.3-5.5) ====================

  /**
   * Handle a new conversation message
   *
   * 1. Writes to transcript (JSONL persistence)
   * 2. Checks for explicit memory commands (instant extraction)
   * 3. Tracks segment counter and triggers segment-full extraction
   *
   * @param sessionId - Session / project ID
   * @param message - The message to process
   * @param modelConfig - Model config (MUST include apiKey!)
   */
  handleMessage(
    sessionId: string,
    message: { role: 'user' | 'assistant'; content: string },
    modelConfig: ModelConfig
  ): void {
    if (!this.initialized || !this.config.extraction.enabled) {
      return;
    }

    log.debug('[MemoryService] handleMessage:', { sessionId, role: message.role, contentLen: message.content.length });

    // 1. Persist to transcript
    if (this.config.transcript.enabled) {
      this.transcriptWriter.appendMessage(
        sessionId,
        message.role,
        message.content,
        `msg-${Date.now()}`
      );
    }

    // 2. Check for explicit commands (user messages only, instant extraction)
    if (message.role === 'user' && this.config.extraction.explicitEnabled) {
      if (this.extractor.hasExtractableContent(message.content, {
        explicitEnabled: true,
        implicitEnabled: false,
      })) {
        // Skip extraction if no API key (required for LLM-based extraction)
        if (!modelConfig.apiKey) {
          log.debug('[MemoryService] Skipping explicit extraction: no API key configured');
        } else {
          log.info('[MemoryService] Explicit extraction triggered for session:', sessionId);
          // Instant extraction for explicit commands
          this.extractionQueue.enqueue(
            sessionId,
            `explicit-${Date.now()}`,
            [message],
            modelConfig
          );
        }
      }
    }

    // 3. Segment tracking
    if (!this.config.extraction.trigger.onSegmentFull) {
      return;
    }

    const counter = (this.segmentCounters.get(sessionId) ?? 0) + 1;
    this.segmentCounters.set(sessionId, counter);

    // Store model config for idle timeout extraction
    this.sessionModelConfigs.set(sessionId, modelConfig);

    const segmentSize = this.config.segmentation.segmentSize;

    if (counter >= segmentSize) {
      // Segment full - trigger extraction immediately
      this.triggerSegmentExtraction(sessionId, modelConfig);
      // Clear idle timer since we just extracted
      this.clearIdleTimer(sessionId);
    } else {
      // Not full yet - start/reset idle timer
      this.resetIdleTimer(sessionId);
    }
  }

  /**
   * Clear idle timer for a session
   */
  private clearIdleTimer(sessionId: string): void {
    const timer = this.idleTimers.get(sessionId);
    if (timer) {
      clearTimeout(timer);
      this.idleTimers.delete(sessionId);
    }
  }

  /**
   * Reset idle timer for a session
   * If idle timeout is enabled, starts a timer that will trigger extraction
   * after idleTimeoutMs milliseconds of no new messages
   */
  private resetIdleTimer(sessionId: string): void {
    // Skip if idle timeout is disabled
    if (!this.config.extraction.trigger.onIdleTimeout) {
      return;
    }

    // Clear existing timer
    this.clearIdleTimer(sessionId);

    const idleTimeoutMs = this.config.extraction.trigger.idleTimeoutMs ?? 60000;

    // Start new timer
    const timer = setTimeout(() => {
      this.onIdleTimeout(sessionId);
    }, idleTimeoutMs);

    this.idleTimers.set(sessionId, timer);
    log.debug(`[MemoryService] Idle timer reset for session ${sessionId}, timeout: ${idleTimeoutMs}ms`);
  }

  /**
   * Handle idle timeout - trigger extraction for accumulated messages
   */
  private onIdleTimeout(sessionId: string): void {
    try {
      log.info(`[MemoryService] Idle timeout triggered for session ${sessionId}`);

      // Remove timer from map
      this.idleTimers.delete(sessionId);

      // Get accumulated message count
      const counter = this.segmentCounters.get(sessionId) ?? 0;
      if (counter === 0) {
        log.debug(`[MemoryService] No messages to extract for session ${sessionId}`);
        return;
      }

      // Get stored model config
      const modelConfig = this.sessionModelConfigs.get(sessionId);
      if (!modelConfig) {
        log.warn(`[MemoryService] No model config for session ${sessionId}, skipping idle extraction`);
        return;
      }

      // Skip if no API key
      if (!modelConfig.apiKey) {
        log.debug(`[MemoryService] Skipping idle extraction: no API key for session ${sessionId}`);
        return;
      }

      // Check if there's extractable content in pending messages
      const totalMessages = this.transcriptWriter.countMessages(sessionId);
      if (totalMessages === 0) {
        return;
      }

      // Read recent messages to check for extractable content
      const startIndex = Math.max(0, totalMessages - counter);
      const entries = this.transcriptWriter.readTranscriptRange(sessionId, startIndex, totalMessages);

      const hasExtractable = entries.some(e =>
        e.role === 'user' && this.extractor.hasExtractableContent(e.content)
      );

      if (!hasExtractable) {
        log.debug(`[MemoryService] No extractable content in pending messages for session ${sessionId}`);
        return;
      }

      // Trigger extraction for accumulated messages
      log.info(`[MemoryService] Triggering idle extraction for ${counter} messages in session ${sessionId}`);
      this.triggerSegmentExtraction(sessionId, modelConfig);
    } catch (error) {
      log.error(`[MemoryService] Idle timeout error for session ${sessionId}:`, error);
    }
  }

  /**
   * Trigger extraction for a full segment
   */
  private triggerSegmentExtraction(sessionId: string, modelConfig: ModelConfig): void {
    // Skip if no API key (required for LLM-based extraction)
    if (!modelConfig.apiKey) {
      log.debug('[MemoryService] Skipping segment extraction: no API key configured');
      return;
    }

    const segmentSize = this.config.segmentation.segmentSize;
    const overlap = this.config.segmentation.segmentOverlap;

    // Get current total message count from transcript
    const totalMessages = this.transcriptWriter.countMessages(sessionId);
    if (totalMessages === 0) return;

    // Calculate segment boundaries (recover from DB if counter is lost after restart)
    let segmentIndex = this.segmentIndexCounters.get(sessionId);
    if (segmentIndex === undefined) {
      segmentIndex = this.database.getNextSegmentIndex(sessionId);
      this.segmentIndexCounters.set(sessionId, segmentIndex);
    }
    const endIndex = totalMessages;
    const startIndex = Math.max(0, endIndex - segmentSize);

    // Read the segment messages from transcript
    const entries = this.transcriptWriter.readTranscriptRange(sessionId, startIndex, endIndex);
    if (entries.length === 0) return;

    const messages = entries.map(e => ({ role: e.role, content: e.content }));

    try {
      // Record progress in database
      this.database.insertExtractionProgress({
        sessionId,
        segmentIndex,
        startMsgIndex: startIndex,
        endMsgIndex: endIndex,
        status: 'pending',
        memoriesExtracted: 0,
        createdAt: Date.now(),
        completedAt: null,
        errorMessage: null,
      });

      // Enqueue extraction task
      this.extractionQueue.enqueue(
        sessionId,
        `seg-${segmentIndex}`,
        messages,
        modelConfig,
        segmentIndex,
        startIndex,
        endIndex
      );

      // Reset counter only after successful enqueue (keep overlap messages in next segment)
      this.segmentCounters.set(sessionId, overlap);
      this.segmentIndexCounters.set(sessionId, segmentIndex + 1);

      log.debug(`[MemoryService] Segment ${segmentIndex} triggered for session ${sessionId}`);
    } catch (error) {
      log.error(`[MemoryService] Segment extraction failed for session ${sessionId}, segment ${segmentIndex}:`, error);
      // Mark progress as failed if it was inserted
      try {
        this.database.updateExtractionProgress(sessionId, segmentIndex, {
          status: 'failed',
          errorMessage: String(error),
        });
      } catch { /* best effort */ }
      // Do NOT reset counter on failure - allow retry on next message
    }
  }

  /**
   * Handle session end - extract remaining unprocessed messages
   *
   * Reads from transcript file and extraction_progress to determine
   * which messages haven't been processed yet, then creates segments
   * for the remaining messages.
   *
   * @param sessionId - Session / project ID
   * @param modelConfig - Model config (MUST include apiKey!)
   */
  async onSessionEnd(
    sessionId: string,
    modelConfig: ModelConfig
  ): Promise<string> {
    if (!this.initialized || !this.config.extraction.enabled) {
      return '';
    }

    if (!this.config.extraction.trigger.onSessionEnd) {
      // Still cleanup session state even if extraction is disabled
      this.cleanupSessionState(sessionId);
      return '';
    }

    // Skip if no API key (required for LLM-based extraction)
    if (!modelConfig.apiKey) {
      log.debug('[MemoryService] Skipping session end extraction: no API key configured');
      this.cleanupSessionState(sessionId);
      return '';
    }

    log.info('[MemoryService] Session end extraction for session:', sessionId);

    try {
      // Get the max completed message index
      const maxCompletedIndex = this.database.getMaxCompletedMsgIndex(sessionId);

      // Read remaining messages from transcript
      const startFrom = maxCompletedIndex >= 0 ? maxCompletedIndex : 0;
      const totalMessages = this.transcriptWriter.countMessages(sessionId);

      if (startFrom >= totalMessages) {
        log.debug('[MemoryService] All messages already processed for session:', sessionId);
        return '';
      }

      // Read remaining transcript entries
      const remainingEntries = this.transcriptWriter.readTranscriptRange(
        sessionId,
        startFrom,
        totalMessages
      );

      if (remainingEntries.length === 0) {
        return '';
      }

      // Check if any remaining messages have extractable content
      const hasExtractable = remainingEntries.some(e =>
        e.role === 'user' && this.extractor.hasExtractableContent(e.content)
      );

      if (!hasExtractable) {
        return '';
      }

      // Build segments from remaining messages
      const segments = buildSegmentsFromIndex(
        remainingEntries,
        0,  // Already sliced to remaining
        this.config.segmentation
      );

      // Get current segment index counter (recover from DB if needed)
      let segmentIndex = this.segmentIndexCounters.get(sessionId);
      if (segmentIndex === undefined) {
        segmentIndex = this.database.getNextSegmentIndex(sessionId);
      }

      // Enqueue each segment
      let lastTaskId = '';
      for (const segment of segments) {
        const adjustedStartIndex = segment.startMsgIndex + startFrom;
        const adjustedEndIndex = segment.endMsgIndex + startFrom;

        // Record progress
        this.database.insertExtractionProgress({
          sessionId,
          segmentIndex,
          startMsgIndex: adjustedStartIndex,
          endMsgIndex: adjustedEndIndex,
          status: 'pending',
          memoriesExtracted: 0,
          createdAt: Date.now(),
          completedAt: null,
          errorMessage: null,
        });

        lastTaskId = this.extractionQueue.enqueue(
          sessionId,
          `session-end-seg-${segmentIndex}`,
          segment.messages,
          modelConfig,
          segmentIndex,
          adjustedStartIndex,
          adjustedEndIndex
        );

        segmentIndex++;
      }

      return lastTaskId;
    } catch (error) {
      log.error(`[MemoryService] Session end extraction failed for session ${sessionId}:`, error);
      return '';
    } finally {
      // Always cleanup session state, even on error
      this.cleanupSessionState(sessionId);
    }
  }

  /**
   * Clean up per-session tracking state
   */
  private cleanupSessionState(sessionId: string): void {
    this.segmentCounters.delete(sessionId);
    this.segmentIndexCounters.delete(sessionId);
    this.clearIdleTimer(sessionId);
    this.sessionModelConfigs.delete(sessionId);
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
      log.debug('[MemoryService] getInjectionContext: not initialized');
      return '';
    }

    log.debug('[MemoryService] getInjectionContext: query=', query.slice(0, 100));
    const context = await this.injector.buildContext(query, options);
    log.debug('[MemoryService] getInjectionContext: result length=', context.length);
    return context;
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
   * Set model config for scheduler's cron-triggered consolidation
   * This allows the cron job to use LLM consolidation instead of simple merge
   */
  setSchedulerModelConfig(config: ModelConfig): void {
    this.scheduler.setModelConfig(config);
  }

  /**
   * Run consolidation manually
   * @param modelConfig - Optional model config for LLM-based consolidation
   */
  async runConsolidation(modelConfig?: {
    provider: string;
    model: string;
    apiKey: string;
    baseUrl?: string;
    apiProtocol?: string;
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
   * Get extraction progress for a session
   */
  getExtractionProgress(sessionId: string): ExtractionProgressRecord[] {
    if (!this.initialized) {
      return [];
    }
    return this.database.getExtractionProgress(sessionId);
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
