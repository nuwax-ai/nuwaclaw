/**
 * Memory Scheduler Module
 *
 * Cron-based daily consolidation and cleanup tasks
 * Based on specs/long-memory/long-memory.md
 */

import { EventEmitter } from 'events';
import * as cron from 'node-cron';
import log from 'electron-log';
import type { MemoryConfig, ConsolidationResult, CleanupResult } from './types';
import { MemoryFileSync } from './MemoryFileSync';
import { MemoryDatabase } from './MemoryDatabase';
import { LLM_CONSOLIDATION_PROMPT } from './constants';

// ==================== Types ====================

interface SchedulerConfig {
  consolidationCron: string;
  cleanupCron: string;
  consolidationEnabled: boolean;
  cleanupEnabled: boolean;
  dailyRetentionDays: number;
}

// ==================== MemoryScheduler Class ====================

export class MemoryScheduler extends EventEmitter {
  private fileSync: MemoryFileSync | null = null;
  private database: MemoryDatabase | null = null;
  private consolidationJob: cron.ScheduledTask | null = null;
  private cleanupJob: cron.ScheduledTask | null = null;
  private running: boolean = false;

  private config: SchedulerConfig = {
    consolidationCron: '0 0 * * *',  // 00:00 daily
    cleanupCron: '0 1 * * *',        // 01:00 daily
    consolidationEnabled: true,
    cleanupEnabled: true,
    dailyRetentionDays: 30,
  };

  /**
   * Initialize scheduler
   */
  init(fileSync: MemoryFileSync, database: MemoryDatabase): void {
    this.fileSync = fileSync;
    this.database = database;
    log.info('[MemoryScheduler] Initialized');
  }

  /**
   * Destroy scheduler
   */
  destroy(): void {
    this.stop();
    this.fileSync = null;
    this.database = null;
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
          () => this.runConsolidation(),
          { timezone: 'Asia/Shanghai' }
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
          { timezone: 'Asia/Shanghai' }
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
    }
  ): Promise<string> {
    const prompt = this.buildConsolidationPrompt(dailyMemories, coreMemory);

    try {
      const response = await this.callLlmApi(
        modelConfig.provider,
        modelConfig.model,
        modelConfig.apiKey,
        modelConfig.baseUrl,
        prompt
      );
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
   * Call LLM API (supports Anthropic and OpenAI)
   */
  private async callLlmApi(
    provider: string,
    model: string,
    apiKey: string,
    baseUrl: string | undefined,
    prompt: string
  ): Promise<string> {
    const isAnthropic = provider.toLowerCase().includes('anthropic') ||
                        model.toLowerCase().includes('claude');

    if (isAnthropic) {
      return this.callAnthropicApi(apiKey, baseUrl, model, prompt);
    } else {
      return this.callOpenAiApi(apiKey, baseUrl, model, prompt);
    }
  }

  /**
   * Call Anthropic API
   */
  private async callAnthropicApi(
    apiKey: string,
    baseUrl: string | undefined,
    model: string,
    prompt: string
  ): Promise<string> {
    const url = baseUrl ?? 'https://api.anthropic.com/v1/messages';

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: model || 'claude-3-5-sonnet-20241022',
        max_tokens: 2000,
        messages: [
          { role: 'user', content: prompt }
        ],
      }),
    });

    if (!response.ok) {
      throw new Error(`Anthropic API error: ${response.status}`);
    }

    const data = await response.json() as { content?: Array<{ text?: string }> };
    return data.content?.[0]?.text ?? '';
  }

  /**
   * Call OpenAI API
   */
  private async callOpenAiApi(
    apiKey: string,
    baseUrl: string | undefined,
    model: string,
    prompt: string
  ): Promise<string> {
    const url = baseUrl ?? 'https://api.openai.com/v1/chat/completions';

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: model || 'gpt-4o-mini',
        max_tokens: 2000,
        messages: [
          { role: 'user', content: prompt }
        ],
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenAI API error: ${response.status}`);
    }

    const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    return data.choices?.[0]?.message?.content ?? '';
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

    // Append new facts to core memory
    const today = new Date().toISOString().split('T')[0];
    const newSection = newFacts.map(f => `- ${f}`).join('\n');

    // Find or create "重要决策" section
    let updated = coreMemory;

    if (updated.includes('## 重要决策')) {
      // Append to existing section
      updated = updated.replace(
        /(## 重要决策\n)/,
        `$1\n### ${today}\n${newSection}\n\n`
      );
    } else {
      // Add new section at end
      updated += `\n\n## 重要决策\n\n### ${today}\n${newSection}\n`;
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
   * Deletes daily memory files older than retention days
   */
  async runCleanup(): Promise<CleanupResult> {
    log.info('[MemoryScheduler] Running cleanup...');

    const result: CleanupResult = {
      success: false,
      filesDeleted: 0,
      memoriesDeleted: 0,
    };

    if (!this.fileSync || !this.database) {
      result.error = 'Scheduler not initialized';
      return result;
    }

    try {
      // Delete old daily files
      const filesDeleted = this.fileSync.deleteOldDailyFiles(this.config.dailyRetentionDays);
      result.filesDeleted = filesDeleted;

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
