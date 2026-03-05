/**
 * Memory Scheduler Module
 *
 * Cron-based daily consolidation and cleanup tasks
 * Based on specs/long-memory/long-memory.md
 */

import { EventEmitter } from 'events';
import * as cron from 'node-cron';
import log from 'electron-log';
import type { MemoryConfig, ConsolidationResult, CleanupResult, ModelConfig } from './types';
import { MemoryFileSync } from './MemoryFileSync';
import { MemoryDatabase } from './MemoryDatabase';
import { TranscriptWriter } from './TranscriptWriter';
import { LLM_CONSOLIDATION_PROMPT } from './constants';
import { callLlmApi } from './utils/llmClient';

// ==================== Types ====================

interface SchedulerConfig {
  consolidationCron: string;
  cleanupCron: string;
  consolidationEnabled: boolean;
  cleanupEnabled: boolean;
  dailyRetentionDays: number;
  transcriptRetentionDays: number;
  stalePendingHours: number;
  timezone: string;
}

// ==================== MemoryScheduler Class ====================

export class MemoryScheduler extends EventEmitter {
  private fileSync: MemoryFileSync | null = null;
  private database: MemoryDatabase | null = null;
  private transcriptWriter: TranscriptWriter | null = null;
  private consolidationJob: cron.ScheduledTask | null = null;
  private cleanupJob: cron.ScheduledTask | null = null;
  private running: boolean = false;

  /** Stored model config for cron-triggered consolidation */
  private storedModelConfig: ModelConfig | null = null;

  /** Provider for active session IDs (to protect from cleanup) */
  private activeSessionProvider: (() => Set<string>) | null = null;

  private config: SchedulerConfig = {
    consolidationCron: '0 0 * * *',  // 00:00 daily
    cleanupCron: '0 1 * * *',        // 01:00 daily
    consolidationEnabled: true,
    cleanupEnabled: true,
    dailyRetentionDays: 30,
    transcriptRetentionDays: 7,
    stalePendingHours: 24,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Shanghai',
  };

  /**
   * Initialize scheduler
   */
  init(fileSync: MemoryFileSync, database: MemoryDatabase, transcriptWriter?: TranscriptWriter): void {
    this.fileSync = fileSync;
    this.database = database;
    this.transcriptWriter = transcriptWriter ?? null;
    log.info('[MemoryScheduler] Initialized');
  }

  /**
   * Set model config for cron-triggered consolidation
   * This allows the cron job to use LLM consolidation instead of simple merge
   */
  setModelConfig(config: ModelConfig): void {
    this.storedModelConfig = config;
    log.debug('[MemoryScheduler] Model config stored for cron consolidation');
  }

  /**
   * Set active session provider for cleanup protection
   * Active sessions' transcript files will be skipped during cleanup
   */
  setActiveSessionProvider(provider: () => Set<string>): void {
    this.activeSessionProvider = provider;
  }

  /**
   * Destroy scheduler
   */
  destroy(): void {
    this.stop();
    this.fileSync = null;
    this.database = null;
    this.transcriptWriter = null;
    this.storedModelConfig = null;
    this.activeSessionProvider = null;
    log.info('[MemoryScheduler] Destroyed');
  }

  /**
   * Configure scheduler
   */
  configure(config: Partial<SchedulerConfig> & { dailyRetentionDays?: number }): void {
    if (config.consolidationCron !== undefined) {
      this.config.consolidationCron = config.consolidationCron;
    }
    if (config.cleanupCron !== undefined) {
      this.config.cleanupCron = config.cleanupCron;
    }
    if (config.consolidationEnabled !== undefined) {
      this.config.consolidationEnabled = config.consolidationEnabled;
    }
    if (config.cleanupEnabled !== undefined) {
      this.config.cleanupEnabled = config.cleanupEnabled;
    }
    if (config.dailyRetentionDays !== undefined) {
      this.config.dailyRetentionDays = config.dailyRetentionDays;
    }
    if (config.transcriptRetentionDays !== undefined) {
      this.config.transcriptRetentionDays = config.transcriptRetentionDays;
    }
    if (config.stalePendingHours !== undefined) {
      this.config.stalePendingHours = config.stalePendingHours;
    }
    if (config.timezone !== undefined) {
      this.config.timezone = config.timezone;
    }

    // Restart if running
    if (this.running) {
      this.stop();
      this.start();
    }
  }

  /**
   * Start scheduled tasks
   */
  start(): void {
    if (this.running) return;

    // Consolidation job (00:00)
    if (this.config.consolidationEnabled) {
      try {
        this.consolidationJob = cron.schedule(
          this.config.consolidationCron,
          () => this.runConsolidation(this.storedModelConfig ?? undefined),
          { timezone: this.config.timezone }
        );
        log.info('[MemoryScheduler] Consolidation job scheduled:', this.config.consolidationCron);
      } catch (error) {
        log.error('[MemoryScheduler] Failed to schedule consolidation:', error);
      }
    }

    // Cleanup job (01:00)
    if (this.config.cleanupEnabled) {
      try {
        this.cleanupJob = cron.schedule(
          this.config.cleanupCron,
          () => this.runCleanup(),
          { timezone: this.config.timezone }
        );
        log.info('[MemoryScheduler] Cleanup job scheduled:', this.config.cleanupCron);
      } catch (error) {
        log.error('[MemoryScheduler] Failed to schedule cleanup:', error);
      }
    }

    this.running = true;
    log.info('[MemoryScheduler] Started');
  }

  /**
   * Stop scheduled tasks
   */
  stop(): void {
    if (this.consolidationJob) {
      this.consolidationJob.stop();
      this.consolidationJob = null;
    }

    if (this.cleanupJob) {
      this.cleanupJob.stop();
      this.cleanupJob = null;
    }

    this.running = false;
    log.info('[MemoryScheduler] Stopped');
  }

  /**
   * Check if scheduler is running
   */
  isRunning(): boolean {
    return this.running;
  }

  // ==================== Consolidation ====================

  /**
   * Run consolidation task
   *
   * Merges recent daily memories into core MEMORY.md
   * Uses LLM consolidation if modelConfig is provided, otherwise falls back to simple merge
   *
   * @param modelConfig - Optional model config for LLM-based consolidation
   */
  async runConsolidation(modelConfig?: {
    provider: string;
    model: string;
    apiKey: string;
    baseUrl?: string;
    apiProtocol?: string;
  }): Promise<ConsolidationResult> {
    log.info('[MemoryScheduler] Running consolidation...');

    const result: ConsolidationResult = {
      success: false,
      memoriesProcessed: 0,
      memoriesAdded: 0,
      memoriesMerged: 0,
    };

    if (!this.fileSync || !this.database) {
      result.error = 'Scheduler not initialized';
      return result;
    }

    try {
      // Read recent daily memories (last 2 days)
      const dailyMemories = this.fileSync.readRecentDailyMemories(2);

      if (dailyMemories.size === 0) {
        log.info('[MemoryScheduler] No daily memories to consolidate');
        result.success = true;
        return result;
      }

      // Read current core memory
      const coreMemory = this.fileSync.readCoreMemory();

      // Count memories to process
      for (const content of dailyMemories.values()) {
        const lines = content.split('\n').filter(l => l.startsWith('- '));
        result.memoriesProcessed += lines.length;
      }

      // Use LLM consolidation if model config is provided, otherwise use simple merge
      let consolidatedContent: string;
      if (modelConfig?.apiKey) {
        log.info('[MemoryScheduler] Using LLM consolidation with', modelConfig.provider);
        try {
          consolidatedContent = await this.llmConsolidation(dailyMemories, coreMemory, modelConfig);
        } catch (error) {
          log.warn('[MemoryScheduler] LLM consolidation failed, falling back to simple merge:', error);
          consolidatedContent = this.simpleConsolidation(dailyMemories, coreMemory);
        }
      } else {
        log.debug('[MemoryScheduler] Using simple consolidation (no LLM config provided)');
        consolidatedContent = this.simpleConsolidation(dailyMemories, coreMemory);
      }

      // Write updated core memory
      this.fileSync.writeCoreMemory(consolidatedContent);

      // Update meta
      this.database.setMeta('consolidation_last_run', Date.now().toString());

      result.success = true;
      result.memoriesAdded = result.memoriesProcessed;  // Simplified

      log.info('[MemoryScheduler] Consolidation complete:', result);
      this.emit('consolidation:complete', result);

    } catch (error) {
      result.error = String(error);
      log.error('[MemoryScheduler] Consolidation failed:', error);
      this.emit('consolidation:error', result);
    }

    return result;
  }

  /**
   * LLM-based consolidation
   * Uses LLM to intelligently merge and deduplicate memories
   */
  private async llmConsolidation(
    dailyMemories: Map<string, string>,
    coreMemory: string,
    modelConfig: {
      provider: string;
      model: string;
      apiKey: string;
      baseUrl?: string;
      apiProtocol?: string;
    }
  ): Promise<string> {
    const prompt = this.buildConsolidationPrompt(dailyMemories, coreMemory);

    try {
      const response = await callLlmApi(prompt, {
        provider: modelConfig.provider,
        model: modelConfig.model,
        apiKey: modelConfig.apiKey,
        baseUrl: modelConfig.baseUrl,
        apiProtocol: modelConfig.apiProtocol,
        maxTokens: 2000,
      });
      return this.parseConsolidationResponse(response, coreMemory);
    } catch (error) {
      log.error('[MemoryScheduler] LLM consolidation call failed:', error);
      throw error;
    }
  }

  /**
   * Parse consolidation response from LLM
   * Extracts the new MEMORY.md content from the response
   */
  private parseConsolidationResponse(response: string, originalCoreMemory: string): string {
    // Try to extract content between markdown code blocks
    const codeBlockMatch = response.match(/```markdown\n?([\s\S]*?)\n?```/);
    if (codeBlockMatch) {
      return codeBlockMatch[1].trim();
    }

    // Try to find content that starts with "# 长期记忆" or "# Long-term Memory"
    const headerMatch = response.match(/(#\s*(?:长期记忆|Long-term Memory)[\s\S]*)/);
    if (headerMatch) {
      return headerMatch[1].trim();
    }

    // If response looks like valid markdown, use it directly
    if (response.includes('## ') && response.includes('- ')) {
      return response.trim();
    }

    // Fallback to original
    log.warn('[MemoryScheduler] Could not parse LLM consolidation response, keeping original');
    return originalCoreMemory;
  }

  /**
   * Build consolidation prompt for LLM
   */
  buildConsolidationPrompt(
    dailyMemories: Map<string, string>,
    coreMemory: string
  ): string {
    const dailyContent = Array.from(dailyMemories.entries())
      .map(([date, content]) => `### ${date}\n${content}`)
      .join('\n\n');

    return LLM_CONSOLIDATION_PROMPT
      .replace('{daily_memories}', dailyContent)
      .replace('{core_memories}', coreMemory || '(空)');
  }

  /**
   * Simple consolidation without LLM
   */
  private simpleConsolidation(
    dailyMemories: Map<string, string>,
    coreMemory: string
  ): string {
    // Extract new facts from daily memories
    const newFacts: string[] = [];

    for (const [date, content] of dailyMemories.entries()) {
      const lines = content.split('\n')
        .filter(l => l.trim().startsWith('- '))
        .map(l => l.trim().slice(2));

      for (const line of lines) {
        // Check if this fact already exists in core memory
        if (!coreMemory.includes(line)) {
          newFacts.push(line);
        }
      }
    }

    // If no new facts, return original
    if (newFacts.length === 0) {
      return coreMemory;
    }

    // Categorize facts by keyword matching
    const categorized: Record<string, string[]> = {
      '偏好': [],
      '用户档案': [],
      '项目相关': [],
      '重要决策': [],
    };

    for (const fact of newFacts) {
      const lowerFact = fact.toLowerCase();
      if (/喜欢|偏好|习惯|倾向|prefer|like|usually|favorite|favourite/.test(lowerFact)) {
        categorized['偏好'].push(fact);
      } else if (/名字|职业|住在|年龄|邮箱|电话|name|work|live|age|email|phone|occupation/.test(lowerFact)) {
        categorized['用户档案'].push(fact);
      } else if (/项目|repo|仓库|project|codebase|代码库|技术栈|框架/.test(lowerFact)) {
        categorized['项目相关'].push(fact);
      } else {
        categorized['重要决策'].push(fact);
      }
    }

    const today = new Date().toISOString().split('T')[0];
    let updated = coreMemory;

    // Append to each section that has new facts
    for (const [section, facts] of Object.entries(categorized)) {
      if (facts.length === 0) continue;

      const newSection = facts.map(f => `- ${f}`).join('\n');
      const sectionHeader = `## ${section}`;

      if (updated.includes(sectionHeader)) {
        // Append to existing section (after the header line, handle both \n and \r\n)
        updated = updated.replace(
          new RegExp(`(${sectionHeader.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\r?\\n)`),
          `$1\n### ${today}\n${newSection}\n\n`
        );
      } else {
        // Add new section at end
        updated += `\n\n${sectionHeader}\n\n### ${today}\n${newSection}\n`;
      }
    }

    // Update footer
    updated = updated.replace(
      /\*最后更新:.*\*/,
      `*最后更新: ${today}*`
    );

    return updated;
  }

  // ==================== Cleanup ====================

  /**
   * Run cleanup task
   *
   * Three-part cleanup:
   * 1. Daily memory files older than dailyRetentionDays
   * 2. Transcript files older than transcriptRetentionDays
   * 3. Extraction progress records (completed/failed older than transcriptRetentionDays, stale pending)
   */
  async runCleanup(): Promise<CleanupResult> {
    log.info('[MemoryScheduler] Running cleanup...');

    const result: CleanupResult = {
      success: false,
      filesDeleted: 0,
      memoriesDeleted: 0,
      transcriptsDeleted: 0,
      progressRecordsCleaned: 0,
    };

    if (!this.fileSync || !this.database) {
      result.error = 'Scheduler not initialized';
      return result;
    }

    try {
      // Cleanup 1: Delete old daily memory files
      const filesDeleted = this.fileSync.deleteOldDailyFiles(this.config.dailyRetentionDays);
      result.filesDeleted = filesDeleted;

      // Cleanup 2: Delete old transcript files (skip active sessions)
      if (this.transcriptWriter) {
        const activeSessionIds = this.activeSessionProvider?.() ?? undefined;
        const transcriptsDeleted = this.transcriptWriter.cleanupOldTranscripts(
          this.config.transcriptRetentionDays,
          activeSessionIds
        );
        result.transcriptsDeleted = transcriptsDeleted;
      }

      // Cleanup 3: Cleanup extraction progress records
      const progressCleanup = this.database.cleanupExtractionProgress(
        this.config.transcriptRetentionDays,
        this.config.stalePendingHours
      );
      result.progressRecordsCleaned = progressCleanup.deleted + progressCleanup.markedFailed;

      // Update meta
      this.database.setMeta('cleanup_last_run', Date.now().toString());

      result.success = true;

      log.info('[MemoryScheduler] Cleanup complete:', result);
      this.emit('cleanup:complete', result);

    } catch (error) {
      result.error = String(error);
      log.error('[MemoryScheduler] Cleanup failed:', error);
      this.emit('cleanup:error', result);
    }

    return result;
  }

  // ==================== Status ====================

  /**
   * Get scheduler status
   */
  getStatus(): {
    running: boolean;
    consolidationEnabled: boolean;
    cleanupEnabled: boolean;
    lastConsolidation: number;
    lastCleanup: number;
  } {
    const lastConsolidation = parseInt(
      this.database?.getMeta('consolidation_last_run') ?? '0',
      10
    );
    const lastCleanup = parseInt(
      this.database?.getMeta('cleanup_last_run') ?? '0',
      10
    );

    return {
      running: this.running,
      consolidationEnabled: this.config.consolidationEnabled,
      cleanupEnabled: this.config.cleanupEnabled,
      lastConsolidation,
      lastCleanup,
    };
  }
}

// Export singleton
export const memoryScheduler = new MemoryScheduler();
