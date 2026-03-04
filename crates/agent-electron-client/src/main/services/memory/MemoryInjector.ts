/**
 * Memory Injector Module
 *
 * Inject retrieved memories into system prompt
 * Based on specs/long-memory/long-memory.md
 */

import log from 'electron-log';
import type { InjectionOptions, MemorySearchResult } from './types';
import { MemoryRetriever } from './MemoryRetriever';

// ==================== Constants ====================

const DEFAULT_MAX_TOKENS = 2000;
const MEMORY_START_MARKER = '<!-- MEMORY_CONTEXT_START -->';
const MEMORY_END_MARKER = '<!-- MEMORY_CONTEXT_END -->';

// ==================== MemoryInjector Class ====================

export class MemoryInjector {
  private retriever: MemoryRetriever | null = null;
  private defaultMaxTokens: number = DEFAULT_MAX_TOKENS;

  /**
   * Initialize injector
   */
  init(retriever: MemoryRetriever): void {
    this.retriever = retriever;
    log.info('[MemoryInjector] Initialized');
  }

  /**
   * Configure injector
   */
  configure(options: { maxTokens?: number }): void {
    if (options.maxTokens !== undefined) {
      this.defaultMaxTokens = options.maxTokens;
    }
  }

  // ==================== Context Building ====================

  /**
   * Build memory context for injection
   */
  async buildContext(
    query: string,
    options?: InjectionOptions
  ): Promise<string> {
    if (!this.retriever) {
      log.debug('[MemoryInjector] buildContext: no retriever');
      return '';
    }

    const maxTokens = options?.maxTokens ?? this.defaultMaxTokens;
    const format = options?.format ?? 'xml';
    const includeScores = options?.includeScores ?? false;

    // Retrieve relevant memories
    log.debug('[MemoryInjector] buildContext: searching for query=', query.slice(0, 100));
    const results = await this.retriever.search(query);
    log.debug('[MemoryInjector] buildContext: found', results.length, 'results');

    if (results.length === 0) {
      return '';
    }

    // Truncate to max tokens
    const truncated = this.truncateToTokenLimit(results, maxTokens);

    // Format based on requested format
    if (format === 'xml') {
      return this.formatAsXml(truncated, includeScores);
    } else {
      return this.formatAsMarkdown(truncated, includeScores);
    }
  }

  /**
   * Build injection context without query (get all recent)
   */
  async buildRecentContext(
    options?: InjectionOptions
  ): Promise<string> {
    if (!this.retriever) {
      return '';
    }

    // Use a broad query to get recent memories
    const results = await this.retriever.search('', { limit: 10 });

    if (results.length === 0) {
      return '';
    }

    const maxTokens = options?.maxTokens ?? this.defaultMaxTokens;
    const format = options?.format ?? 'xml';
    const includeScores = options?.includeScores ?? false;

    const truncated = this.truncateToTokenLimit(results, maxTokens);

    if (format === 'xml') {
      return this.formatAsXml(truncated, includeScores);
    } else {
      return this.formatAsMarkdown(truncated, includeScores);
    }
  }

  // ==================== Injection Methods ====================

  /**
   * Inject memories into system prompt
   */
  async injectIntoPrompt(
    systemPrompt: string,
    query: string,
    options?: InjectionOptions
  ): Promise<string> {
    const memoryContext = await this.buildContext(query, options);

    if (!memoryContext) {
      return systemPrompt;
    }

    // Check if there's an existing memory section
    const startIndex = systemPrompt.indexOf(MEMORY_START_MARKER);
    const endIndex = systemPrompt.indexOf(MEMORY_END_MARKER);

    if (startIndex !== -1 && endIndex !== -1 && endIndex > startIndex) {
      // Replace existing memory section
      const before = systemPrompt.slice(0, startIndex + MEMORY_START_MARKER.length);
      const after = systemPrompt.slice(endIndex);

      return `${before}\n${memoryContext}\n${after}`;
    }

    // Check for placeholder
    if (systemPrompt.includes('{{MEMORY_CONTEXT}}')) {
      return systemPrompt.replace('{{MEMORY_CONTEXT}}', memoryContext);
    }

    // Append to end of system prompt
    return `${systemPrompt}\n\n${MEMORY_START_MARKER}\n${memoryContext}\n${MEMORY_END_MARKER}`;
  }

  /**
   * Remove memory section from prompt
   */
  removeFromPrompt(systemPrompt: string): string {
    const startIndex = systemPrompt.indexOf(MEMORY_START_MARKER);
    const endIndex = systemPrompt.indexOf(MEMORY_END_MARKER);

    if (startIndex === -1 || endIndex === -1 || endIndex <= startIndex) {
      return systemPrompt;
    }

    return systemPrompt.slice(0, startIndex) +
           systemPrompt.slice(endIndex + MEMORY_END_MARKER.length);
  }

  // ==================== Formatting ====================

  /**
   * Format memories as XML
   */
  private formatAsXml(
    results: MemorySearchResult[],
    includeScores: boolean
  ): string {
    const header = `<memory_context>
<!--
长期记忆上下文
以下是与当前对话相关的历史记忆，帮助 AI 更好地理解用户。
-->
<memories>`;

    const memories = results.map(r => {
      if (includeScores) {
        return `  <memory score="${r.score.toFixed(2)}" category="${r.entry.category}" source="${r.entry.source}">
    ${this.escapeXml(r.entry.text)}
  </memory>`;
      }
      return `  <memory category="${r.entry.category}">
    ${this.escapeXml(r.entry.text)}
  </memory>`;
    }).join('\n');

    return `${header}
${memories}
</memories>
</memory_context>`;
  }

  /**
   * Format memories as Markdown
   */
  private formatAsMarkdown(
    results: MemorySearchResult[],
    includeScores: boolean
  ): string {
    const lines: string[] = [
      '## 相关记忆',
      '',
      '> 以下是与当前对话相关的历史记忆',
      '',
    ];

    for (const r of results) {
      const prefix = `- **[${r.entry.category}]**`;
      if (includeScores) {
        lines.push(`${prefix} ${r.entry.text} *(相关度: ${(r.score * 100).toFixed(0)}%)*`);
      } else {
        lines.push(`${prefix} ${r.entry.text}`);
      }
    }

    return lines.join('\n');
  }

  /**
   * Escape XML special characters
   */
  private escapeXml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  // ==================== Token Management ====================

  /**
   * Truncate results to fit within token limit
   * Simple estimation: ~4 chars per token for mixed Chinese/English
   */
  private truncateToTokenLimit(
    results: MemorySearchResult[],
    maxTokens: number
  ): MemorySearchResult[] {
    const maxChars = maxTokens * 4;
    let totalChars = 0;
    const truncated: MemorySearchResult[] = [];

    for (const result of results) {
      const entryChars = result.entry.text.length;

      if (totalChars + entryChars > maxChars) {
        break;
      }

      truncated.push(result);
      totalChars += entryChars;
    }

    return truncated;
  }

  /**
   * Estimate token count for text
   */
  estimateTokens(text: string): number {
    // Simple estimation: ~4 chars per token for mixed content
    return Math.ceil(text.length / 4);
  }

  // ==================== Utility Methods ====================

  /**
   * Get memory statistics for display
   */
  getMemoryStats(results: MemorySearchResult[]): {
    count: number;
    avgScore: number;
    categories: Record<string, number>;
    sources: Record<string, number>;
  } {
    const stats = {
      count: results.length,
      avgScore: 0,
      categories: {} as Record<string, number>,
      sources: {} as Record<string, number>,
    };

    if (results.length === 0) {
      return stats;
    }

    let totalScore = 0;

    for (const r of results) {
      totalScore += r.score;

      const cat = r.entry.category;
      stats.categories[cat] = (stats.categories[cat] ?? 0) + 1;

      const src = r.entry.source;
      stats.sources[src] = (stats.sources[src] ?? 0) + 1;
    }

    stats.avgScore = totalScore / results.length;

    return stats;
  }
}

// Export singleton
export const memoryInjector = new MemoryInjector();
