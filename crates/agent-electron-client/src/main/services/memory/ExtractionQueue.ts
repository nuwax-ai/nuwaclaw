/**
 * Extraction Queue Module
 *
 * Async queue for memory extraction with model config capture
 * IMPORTANT: Must capture full model config including API Key
 *
 * Based on specs/long-memory/long-memory.md
 */

import { EventEmitter } from 'events';
import log from 'electron-log';
import type { ExtractionTask, ExtractedMemory, ModelConfig, DeduplicationConfig } from './types';
import { MemoryExtractor } from './MemoryExtractor';
import { MemoryFileSync } from './MemoryFileSync';
import { MemoryDatabase } from './MemoryDatabase';
import { deduplicateMemories } from './utils/deduplicator';
import { callLlmApi } from './utils/llmClient';

// ==================== Types ====================

interface QueueOptions {
  maxRetries: number;
  processingInterval: number;  // ms
  maxQueueSize: number;
}

interface ExtractionResult {
  taskId: string;
  success: boolean;
  memories?: ExtractedMemory[];
  error?: string;
}

// ==================== ExtractionQueue Class ====================

export class ExtractionQueue extends EventEmitter {
  private queue: ExtractionTask[] = [];
  private processing: boolean = false;
  private paused: boolean = false;
  private extractor: MemoryExtractor;
  private fileSync: MemoryFileSync | null = null;
  private database: MemoryDatabase | null = null;
  private deduplicationConfig: DeduplicationConfig = {
    textSimilarityThreshold: 0.8,
    vectorSimilarityThreshold: 0.95,
  };
  private options: QueueOptions = {
    maxRetries: 2,
    processingInterval: 1000,
    maxQueueSize: 100,
  };
  private processTimer: NodeJS.Timeout | null = null;

  constructor(extractor: MemoryExtractor) {
    super();
    this.extractor = extractor;
  }

  /**
   * Initialize the queue
   */
  init(
    fileSync: MemoryFileSync,
    options?: Partial<QueueOptions>,
    database?: MemoryDatabase,
    deduplicationConfig?: DeduplicationConfig
  ): void {
    this.fileSync = fileSync;
    this.database = database ?? null;
    this.options = { ...this.options, ...options };
    if (deduplicationConfig) {
      this.deduplicationConfig = deduplicationConfig;
    }
    log.info('[ExtractionQueue] Initialized');
  }

  /**
   * Destroy the queue
   */
  destroy(): void {
    this.stop();
    this.queue = [];
    log.info('[ExtractionQueue] Destroyed');
  }

  /**
   * Start processing queue
   */
  start(): void {
    if (this.processTimer) return;

    this.paused = false;
    this.processTimer = setInterval(() => {
      this.processNext();
    }, this.options.processingInterval);

    log.info('[ExtractionQueue] Started');
  }

  /**
   * Stop processing queue
   */
  stop(): void {
    if (this.processTimer) {
      clearInterval(this.processTimer);
      this.processTimer = null;
    }
    this.paused = true;
    log.info('[ExtractionQueue] Stopped');
  }

  /**
   * Pause processing
   */
  pause(): void {
    this.paused = true;
  }

  /**
   * Resume processing
   */
  resume(): void {
    this.paused = false;
  }

  // ==================== Queue Operations ====================

  /**
   * Add extraction task to queue
   *
   * IMPORTANT: modelConfig must include apiKey!
   * Electron client has no global API key storage,
   * so we must capture it at enqueue time.
   */
  enqueue(
    sessionId: string,
    messageId: string,
    messages: Array<{ role: 'user' | 'assistant'; content: string }>,
    modelConfig: ModelConfig,
    segmentIndex?: number,
    startMsgIndex?: number,
    endMsgIndex?: number
  ): string {
    // Validate model config - API key is required!
    if (!modelConfig.apiKey) {
      const error = 'API Key is required in modelConfig for extraction queue';
      log.error('[ExtractionQueue]', error);
      throw new Error(error);
    }

    // Check queue size
    if (this.queue.length >= this.options.maxQueueSize) {
      log.warn('[ExtractionQueue] Queue is full, dropping oldest task');
      this.queue.shift();
    }

    const task: ExtractionTask = {
      sessionId,
      messageId,
      messages,
      modelConfig,  // Store full config including API key!
      timestamp: Date.now(),
      retryCount: 0,
      segmentIndex,
      startMsgIndex,
      endMsgIndex,
    };

    const taskId = this.generateTaskId(task);
    this.queue.push(task);
    log.info('[ExtractionQueue] Task enqueued:', taskId);

    this.emit('task:enqueued', task);

    // Try to process immediately if not busy
    if (!this.processing && !this.paused) {
      this.processNext();
    }

    return taskId;
  }

  /**
   * Get queue length
   */
  getLength(): number {
    return this.queue.length;
  }

  /**
   * Check if queue is empty
   */
  isEmpty(): boolean {
    return this.queue.length === 0;
  }

  /**
   * Clear all tasks
   */
  clear(): void {
    this.queue = [];
    log.info('[ExtractionQueue] Queue cleared');
  }

  /**
   * Get pending tasks (without sensitive data)
   */
  getPendingTasks(): Array<{
    taskId: string;
    sessionId: string;
    messageId: string;
    timestamp: number;
    retryCount: number;
  }> {
    return this.queue.map(task => ({
      taskId: this.generateTaskId(task),
      sessionId: task.sessionId,
      messageId: task.messageId,
      timestamp: task.timestamp,
      retryCount: task.retryCount,
    }));
  }

  // ==================== Processing ====================

  /**
   * Process next task in queue
   */
  private async processNext(): Promise<void> {
    if (this.processing || this.paused || this.queue.length === 0) {
      return;
    }

    this.processing = true;
    const task = this.queue.shift()!;
    const taskId = this.generateTaskId(task);

    try {
      const result = await this.processTask(task);
      this.emit('task:completed', result);
    } catch (error) {
      log.error('[ExtractionQueue] Task processing failed:', error);
      this.emit('task:error', { taskId, error });
    } finally {
      this.processing = false;
    }
  }

  /**
   * Process a single extraction task
   */
  private async processTask(task: ExtractionTask): Promise<ExtractionResult> {
    const taskId = this.generateTaskId(task);
    log.info('[ExtractionQueue] Processing task:', taskId);

    // Update progress to 'processing' if tracking segment
    if (task.segmentIndex !== undefined && this.database) {
      this.database.updateExtractionProgress(task.sessionId, task.segmentIndex, {
        status: 'processing',
      });
    }

    try {
      // Extract memories using stored model config
      let memories = await this.extractMemories(task);

      // Apply cross-segment deduplication
      if (memories.length > 0 && this.database) {
        const existingTexts = this.database.getRecentMemoryTexts(50);
        memories = deduplicateMemories(memories, existingTexts, this.deduplicationConfig);
      }

      if (memories.length > 0) {
        // Write to daily memory file
        await this.writeToDailyMemory(memories, task.sessionId);

        log.info('[ExtractionQueue] Extracted', memories.length, 'memories from task:', taskId);
      }

      // Update progress to 'completed' if tracking segment
      if (task.segmentIndex !== undefined && this.database) {
        this.database.updateExtractionProgress(task.sessionId, task.segmentIndex, {
          status: 'completed',
          memoriesExtracted: memories.length,
          completedAt: Date.now(),
        });
      }

      return {
        taskId,
        success: true,
        memories,
      };
    } catch (error) {
      // Retry logic
      if (task.retryCount < this.options.maxRetries) {
        task.retryCount++;
        this.queue.unshift(task);  // Put back at front
        log.warn(`[ExtractionQueue] Retrying task (${task.retryCount}/${this.options.maxRetries}):`, taskId);

        return {
          taskId,
          success: false,
          error: String(error),
        };
      }

      // Update progress to 'failed' if tracking segment
      if (task.segmentIndex !== undefined && this.database) {
        this.database.updateExtractionProgress(task.sessionId, task.segmentIndex, {
          status: 'failed',
          errorMessage: String(error),
        });
      }

      log.error('[ExtractionQueue] Task failed after max retries:', taskId);
      return {
        taskId,
        success: false,
        error: String(error),
      };
    }
  }

  /**
   * Extract memories from task messages
   *
   * Pipeline:
   * 1. Regex + rules extraction (existing, no API call)
   * 2. LLM segmented extraction (new, API call)
   * 3. Merge + deduplicate results
   * 4. LLM validation for uncertain candidates (existing)
   */
  private async extractMemories(task: ExtractionTask): Promise<ExtractedMemory[]> {
    log.info('[ExtractionQueue] extractMemories: starting extraction for task');

    // Step 1: Regex + rules extraction (no API call needed)
    const regexMemories = await this.extractor.extract(task.messages);
    log.info('[ExtractionQueue] Step 1 - Regex extraction: ' + regexMemories.length + ' memories');

    // Step 2: LLM segmented extraction (requires API key)
    let llmMemories: ExtractedMemory[] = [];
    if (task.modelConfig.apiKey) {
      log.info('[ExtractionQueue] Step 2 - Calling LLM for extraction (apiKey present)');
      try {
        llmMemories = await this.callLlmForExtraction(task);
        log.info('[ExtractionQueue] Step 2 - LLM extraction returned: ' + llmMemories.length + ' memories');
        if (llmMemories.length > 0) {
          log.info('[ExtractionQueue] LLM memories: ' + llmMemories.map(m => m.text.slice(0, 30)).join(', '));
        }
      } catch (error) {
        log.warn('[ExtractionQueue] LLM extraction failed, using regex results only:', error);
      }
    } else {
      log.info('[ExtractionQueue] Step 2 - Skipping LLM extraction (no apiKey)');
    }

    // Step 3: Merge and deduplicate regex + LLM results
    let memories = this.mergeExtractionResults(regexMemories, llmMemories);
    log.info('[ExtractionQueue] Step 3 - After merge: ' + memories.length + ' memories');

    // Step 4: LLM validation for medium-confidence candidates
    if (task.modelConfig.apiKey) {
      const needsValidation = memories.filter(m =>
        this.extractor.needsLlmValidation?.(m.confidence) ?? this.defaultNeedsLlmValidation(m.confidence)
      );

      if (needsValidation.length > 0) {
        log.info('[ExtractionQueue] Step 4 - ' + needsValidation.length + ' memories need LLM validation');
        try {
          const validatedMemories = await this.callLlmForValidation(task, needsValidation);

          // Merge validated results - keep high confidence, update validated ones
          memories = memories.map(m => {
            const validated = validatedMemories.find(v => v.text === m.text);
            return validated ?? m;
          }).filter(m => m.confidence >= 0.5);  // Filter out rejected ones
        } catch (error) {
          log.warn('[ExtractionQueue] LLM validation failed, using original results:', error);
          // Continue with original extraction results
        }
      }
    }

    log.info('[ExtractionQueue] extractMemories: final result = ' + memories.length + ' memories');
    return memories;
  }

  /**
   * Call LLM for segmented extraction
   * Uses MemoryExtractor's buildExtractionPrompt/parseExtractionResponse
   */
  private async callLlmForExtraction(task: ExtractionTask): Promise<ExtractedMemory[]> {
    const { provider, model, apiKey, baseUrl, apiProtocol } = task.modelConfig;

    if (!apiKey) {
      log.info('[ExtractionQueue] callLlmForExtraction: no API key, returning empty');
      return [];
    }

    log.info('[ExtractionQueue] callLlmForExtraction: provider=' + provider + ', model=' + model + ', apiProtocol=' + (apiProtocol ?? 'auto'));

    // Get existing memories for deduplication context
    const existingMemories = this.database
      ? this.database.getRecentMemoryTexts(30)
      : (this.fileSync?.readCoreMemory() ?? '').split('\n').filter(l => l.startsWith('- ')).map(l => l.slice(2));

    log.info('[ExtractionQueue] callLlmForExtraction: ' + existingMemories.length + ' existing memories for context');

    // Build segment metadata if available
    const segmentMeta = task.segmentIndex !== undefined
      ? { index: task.segmentIndex, total: task.segmentIndex + 1 }
      : undefined;

    // Build extraction prompt
    const prompt = this.extractor.buildExtractionPrompt(
      task.messages,
      segmentMeta,
      existingMemories
    );

    log.info('[ExtractionQueue] callLlmForExtraction: prompt length=' + prompt.length);

    // Call LLM API
    const response = await this.callLlmApiInternal(provider, model, apiKey, baseUrl, apiProtocol, prompt);
    log.info('[ExtractionQueue] callLlmForExtraction: response length=' + response.length);

    // Parse response
    const memories = this.extractor.parseExtractionResponse(response);
    log.info('[ExtractionQueue] callLlmForExtraction: parsed ' + memories.length + ' memories');

    return memories;
  }

  /**
   * Merge regex and LLM extraction results, deduplicating by normalized text
   * When duplicates are found, keep the one with higher confidence
   */
  private mergeExtractionResults(
    regexResults: ExtractedMemory[],
    llmResults: ExtractedMemory[]
  ): ExtractedMemory[] {
    if (llmResults.length === 0) return regexResults;
    if (regexResults.length === 0) return llmResults;

    const merged = new Map<string, ExtractedMemory>();

    // Index regex results by normalized text
    for (const mem of regexResults) {
      const key = mem.text.toLowerCase().replace(/\s+/g, ' ').trim();
      merged.set(key, mem);
    }

    // Merge LLM results, preferring higher confidence
    for (const mem of llmResults) {
      const key = mem.text.toLowerCase().replace(/\s+/g, ' ').trim();
      const existing = merged.get(key);
      if (!existing || mem.confidence > existing.confidence) {
        merged.set(key, mem);
      }
    }

    return Array.from(merged.values());
  }

  /**
   * Default LLM validation check
   * Returns true if confidence is in the "uncertain" range (0.5-0.7)
   */
  private defaultNeedsLlmValidation(confidence: number): boolean {
    return confidence >= 0.5 && confidence < 0.75;
  }

  /**
   * Call LLM for extraction validation
   * Based on Spec 5.4 LLM 提取 Prompt
   */
  private async callLlmForValidation(
    task: ExtractionTask,
    candidates: ExtractedMemory[]
  ): Promise<ExtractedMemory[]> {
    const { provider, model, apiKey, baseUrl, apiProtocol } = task.modelConfig;

    if (!apiKey) {
      log.warn('[ExtractionQueue] No API key available for LLM validation');
      return candidates;
    }

    // Build validation prompt
    const existingMemories = this.fileSync?.readCoreMemory() ?? '';
    const prompt = this.extractor.buildValidationPrompt?.(
      candidates.map(c => c.text).join('\n'),
      existingMemories.split('\n').filter(l => l.startsWith('- '))
    ) ?? this.buildDefaultValidationPrompt(candidates, existingMemories);

    try {
      // Call LLM API based on provider
      const response = await this.callLlmApiInternal(provider, model, apiKey, baseUrl, apiProtocol, prompt);
      const validation = this.parseValidationResponse(response);

      if (!validation.accept) {
        return [];
      }

      return [{
        text: validation.mergedText ?? candidates[0].text,
        category: candidates[0].category,
        confidence: validation.confidence,
        isExplicit: false,
      }];
    } catch (error) {
      log.error('[ExtractionQueue] LLM validation call failed:', error);
      return candidates; // Fallback to original candidates
    }
  }

  /**
   * Build default validation prompt
   */
  private buildDefaultValidationPrompt(
    candidates: ExtractedMemory[],
    existingMemories: string
  ): string {
    return `你是一个记忆验证助手。请判断以下候选记忆是否值得保存。

## 候选记忆
${candidates.map(c => c.text).join('\n')}

## 现有记忆
${existingMemories || '(无)'}

## 判断规则
1. 是否与现有记忆冲突或重复?
2. 是否具有长期价值?
3. 是否是用户个人信息而非通用知识?

## 输出
返回 JSON:
{
  "accept": true/false,
  "reason": "拒绝或接受的原因",
  "merged_text": "如果需要合并，提供合并后的文本",
  "confidence": 0.0-1.0
}`;
  }

  /**
   * Parse validation response from LLM
   */
  private parseValidationResponse(response: string): {
    accept: boolean;
    reason: string;
    mergedText?: string;
    confidence: number;
  } {
    try {
      // Try to extract JSON from response
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          accept: parsed.accept ?? false,
          reason: parsed.reason ?? '',
          mergedText: parsed.merged_text,
          confidence: parsed.confidence ?? 0.5,
        };
      }
    } catch (error) {
      log.warn('[ExtractionQueue] Failed to parse validation response:', error);
    }

    // Default to accepting with lower confidence
    return {
      accept: true,
      reason: 'Failed to parse LLM response',
      confidence: 0.5,
    };
  }

  /**
   * Call LLM API (delegates to shared llmClient)
   */
  private async callLlmApiInternal(
    provider: string,
    model: string,
    apiKey: string,
    baseUrl: string | undefined,
    apiProtocol: string | undefined,
    prompt: string
  ): Promise<string> {
    return callLlmApi(prompt, { provider, model, apiKey, baseUrl, apiProtocol, maxTokens: 500 });
  }

  /**
   * Write extracted memories to daily memory file
   */
  private async writeToDailyMemory(
    memories: ExtractedMemory[],
    sessionId: string
  ): Promise<void> {
    if (!this.fileSync) {
      log.warn('[ExtractionQueue] FileSync not initialized');
      return;
    }

    // Format memories as markdown
    const content = this.extractor.formatForDailyMemory(memories);

    // Append to daily memory file
    this.fileSync.appendToDailyMemory(
      content,
      `会话 (${sessionId.slice(0, 8)})`
    );
  }

  // ==================== Breakpoint Recovery ====================

  /**
   * Resume pending tasks from extraction_progress table
   * Called during initialization to recover from interruptions
   */
  resumePendingTasks(transcriptReader: {
    readTranscriptRange: (sessionId: string, start: number, end: number) => Array<{ role: 'user' | 'assistant'; content: string }>;
  }, modelConfig: ModelConfig): void {
    if (!this.database) {
      log.warn('[ExtractionQueue] Cannot resume: database not available');
      return;
    }

    const pendingRecords = this.database.getPendingExtractionProgress();
    if (pendingRecords.length === 0) {
      return;
    }

    log.info(`[ExtractionQueue] Resuming ${pendingRecords.length} pending extraction tasks`);

    for (const record of pendingRecords) {
      try {
        const messages = transcriptReader.readTranscriptRange(
          record.sessionId,
          record.startMsgIndex,
          record.endMsgIndex
        );

        if (messages.length === 0) {
          // Transcript no longer available
          this.database.updateExtractionProgress(record.sessionId, record.segmentIndex, {
            status: 'failed',
            errorMessage: 'transcript_expired',
          });
          continue;
        }

        this.enqueue(
          record.sessionId,
          `resume-seg-${record.segmentIndex}`,
          messages,
          modelConfig,
          record.segmentIndex,
          record.startMsgIndex,
          record.endMsgIndex
        );
      } catch (error) {
        log.error(`[ExtractionQueue] Failed to resume task for session ${record.sessionId}:`, error);
      }
    }
  }

  // ==================== Utility Methods ====================

  /**
   * Generate unique task ID
   */
  private generateTaskId(task: ExtractionTask): string {
    return `${task.sessionId}:${task.messageId}:${task.timestamp}`;
  }

  /**
   * Create extraction task with validation
   *
   * Helper to create a properly typed task
   */
  static createTask(
    sessionId: string,
    messageId: string,
    messages: Array<{ role: 'user' | 'assistant'; content: string }>,
    modelConfig: ModelConfig
  ): ExtractionTask {
    if (!modelConfig.apiKey) {
      throw new Error('API Key is required for extraction task');
    }

    return {
      sessionId,
      messageId,
      messages,
      modelConfig,
      timestamp: Date.now(),
      retryCount: 0,
    };
  }
}

// We'll create the singleton after MemoryExtractor is defined
