/**
 * Memory Retriever Module
 *
 * Three-tier retrieval: sqlite-vec -> JS vector -> FTS5
 * Based on specs/long-memory/long-memory.md
 */

import log from 'electron-log';
import type { MemorySearchResult, HybridSearchOptions, MemorySource } from './types';
import { MemoryDatabase } from './MemoryDatabase';

// ==================== Types ====================

interface EmbeddingProvider {
  getEmbedding(text: string): Promise<Float32Array | null>;
}

// ==================== MemoryRetriever Class ====================

export class MemoryRetriever {
  private database: MemoryDatabase | null = null;
  private embeddingProvider: EmbeddingProvider | null = null;
  private vectorWeight: number = 0.7;
  private ftsWeight: number = 0.3;
  private defaultLimit: number = 12;
  private defaultMinScore: number = 0.4;
  private dailyMemoryDays: number = 2;

  /**
   * Initialize retriever
   */
  init(database: MemoryDatabase): void {
    this.database = database;
    log.info('[MemoryRetriever] Initialized');
  }

  /**
   * Set embedding provider
   */
  setEmbeddingProvider(provider: EmbeddingProvider | null): void {
    this.embeddingProvider = provider;
  }

  /**
   * Configure retrieval parameters
   */
  configure(options: {
    vectorWeight?: number;
    ftsWeight?: number;
    limit?: number;
    minScore?: number;
    dailyMemoryDays?: number;
  }): void {
    if (options.vectorWeight !== undefined) this.vectorWeight = options.vectorWeight;
    if (options.ftsWeight !== undefined) this.ftsWeight = options.ftsWeight;
    if (options.limit !== undefined) this.defaultLimit = options.limit;
    if (options.minScore !== undefined) this.defaultMinScore = options.minScore;
    if (options.dailyMemoryDays !== undefined) this.dailyMemoryDays = options.dailyMemoryDays;
  }

  // ==================== Search Methods ====================

  /**
   * Search memories using hybrid retrieval
   */
  async search(query: string, options?: HybridSearchOptions): Promise<MemorySearchResult[]> {
    if (!this.database) {
      log.debug('[MemoryRetriever] search: no database');
      return [];
    }

    // Pre-retrieval dirty check (Spec 4.2 场景 5)
    // If index is dirty, log a warning - caller should use ensureMemoryReadyForSession() for proper sync
    if (options?.checkDirty !== false) {
      const { dirty } = this.database.getSyncState();
      if (dirty) {
        log.debug('[MemoryRetriever] Index is dirty, search results may be stale. ' +
          'Call memory.ensureReady() before session start for proper sync.');
      }
    }

    const limit = options?.limit ?? this.defaultLimit;
    const minScore = options?.minScore ?? this.defaultMinScore;
    const vectorWeight = options?.vectorWeight ?? this.vectorWeight;
    const ftsWeight = options?.ftsWeight ?? this.ftsWeight;

    // Layer 1: Always do FTS5 search
    log.debug('[MemoryRetriever] search: FTS query=', query.slice(0, 100));
    const ftsResults = this.database.searchFTS(query, limit * 2);
    log.debug('[MemoryRetriever] search: FTS returned', ftsResults.length, 'results');

    // Check if embedding is available
    const embeddingEnabled = this.embeddingProvider !== null;
    const vectorAvailable = this.database.isVectorAvailable() || embeddingEnabled;

    if (!vectorAvailable || !embeddingEnabled) {
      // Return FTS results only
      return ftsResults
        .filter(r => r.score >= minScore)
        .slice(0, limit);
    }

    // Get query embedding
    let queryEmbedding: Float32Array | null = null;
    try {
      queryEmbedding = await this.embeddingProvider!.getEmbedding(query);
    } catch (error) {
      log.warn('[MemoryRetriever] Failed to get query embedding:', error);
      return ftsResults.filter(r => r.score >= minScore).slice(0, limit);
    }

    if (!queryEmbedding) {
      return ftsResults.filter(r => r.score >= minScore).slice(0, limit);
    }

    // Layer 2: Vector search
    const vecResults = this.database.searchVector(queryEmbedding, limit * 2, 0);

    // Layer 3: Hybrid merge
    return this.mergeResults(ftsResults, vecResults, {
      vectorWeight,
      ftsWeight,
      limit,
      minScore,
    });
  }

  /**
   * Search using FTS5 only (no vector)
   */
  searchFTS(query: string, limit?: number): MemorySearchResult[] {
    if (!this.database) {
      return [];
    }

    return this.database.searchFTS(query, limit ?? this.defaultLimit);
  }

  /**
   * Search using vector similarity
   */
  async searchVector(query: string, limit?: number, minScore?: number): Promise<MemorySearchResult[]> {
    if (!this.database || !this.embeddingProvider) {
      return [];
    }

    try {
      const embedding = await this.embeddingProvider.getEmbedding(query);
      if (!embedding) {
        return [];
      }

      return this.database.searchVector(
        embedding,
        limit ?? this.defaultLimit,
        minScore ?? this.defaultMinScore
      );
    } catch (error) {
      log.error('[MemoryRetriever] Vector search failed:', error);
      return [];
    }
  }

  // ==================== Hybrid Merge ====================

  /**
   * Merge FTS and vector results using weighted combination
   */
  private mergeResults(
    ftsResults: MemorySearchResult[],
    vecResults: MemorySearchResult[],
    options: {
      vectorWeight: number;
      ftsWeight: number;
      limit: number;
      minScore: number;
    }
  ): MemorySearchResult[] {
    const { vectorWeight, ftsWeight, limit, minScore } = options;

    // Normalize scores for each result set
    const normalizedFts = this.normalizeScores(ftsResults);
    const normalizedVec = this.normalizeScores(vecResults);

    // Create map for combining scores
    const scoreMap = new Map<string, {
      entry: MemorySearchResult['entry'];
      ftsScore: number;
      vecScore: number;
    }>();

    // Add FTS results
    for (const result of normalizedFts) {
      scoreMap.set(result.entry.id, {
        entry: result.entry,
        ftsScore: result.score,
        vecScore: 0,
      });
    }

    // Add/update with vector results
    for (const result of normalizedVec) {
      const existing = scoreMap.get(result.entry.id);
      if (existing) {
        existing.vecScore = result.score;
      } else {
        scoreMap.set(result.entry.id, {
          entry: result.entry,
          ftsScore: 0,
          vecScore: result.score,
        });
      }
    }

    // Calculate final scores
    const merged: MemorySearchResult[] = [];

    for (const [id, data] of scoreMap) {
      // Weighted combination
      const finalScore =
        vectorWeight * data.vecScore +
        ftsWeight * data.ftsScore;

      if (finalScore >= minScore) {
        merged.push({
          entry: data.entry,
          score: finalScore,
          source: data.ftsScore > 0 && data.vecScore > 0 ? 'hybrid' :
                  data.vecScore > 0 ? 'vector' : 'fts',
        });
      }
    }

    // Sort by score descending
    merged.sort((a, b) => b.score - a.score);

    return merged.slice(0, limit);
  }

  /**
   * Normalize scores to 0-1 range using min-max normalization
   */
  private normalizeScores(results: MemorySearchResult[]): MemorySearchResult[] {
    if (results.length === 0) {
      return results;
    }

    const scores = results.map(r => r.score);
    const min = Math.min(...scores);
    const max = Math.max(...scores);
    const range = max - min;

    if (range === 0) {
      // All scores are the same
      return results.map(r => ({ ...r, score: 1 }));
    }

    return results.map(r => ({
      ...r,
      score: (r.score - min) / range,
    }));
  }

  // ==================== Context Building ====================

  /**
   * Get memory context for query
   */
  async getContext(
    query: string,
    options?: HybridSearchOptions
  ): Promise<string> {
    const results = await this.search(query, options);

    if (results.length === 0) {
      return '';
    }

    // Format as XML
    const memories = results.map((r, i) =>
      `  <memory score="${r.score.toFixed(2)}" source="${r.source}">
    ${r.entry.text}
  </memory>`
    ).join('\n');

    return `<memories>
${memories}
</memories>`;
  }

  /**
   * Get memory context formatted as markdown
   */
  async getContextMarkdown(
    query: string,
    options?: HybridSearchOptions
  ): Promise<string> {
    const results = await this.search(query, options);

    if (results.length === 0) {
      return '';
    }

    return results.map(r =>
      `- ${r.entry.text} (相关度: ${r.score.toFixed(2)})`
    ).join('\n');
  }

  // ==================== Filtering ====================

  /**
   * Get recent daily memory sources for search scope
   */
  getRecentDailySources(): string[] {
    const sources: string[] = [];
    const today = new Date();

    for (let i = 0; i < this.dailyMemoryDays; i++) {
      const date = new Date(today);
      date.setDate(date.getDate() - i);
      const dateStr = date.toISOString().split('T')[0];
      sources.push(`memory/${dateStr}.md`);
    }

    return sources;
  }

  /**
   * Filter results by source
   */
  filterBySource(
    results: MemorySearchResult[],
    sources: MemorySource[]
  ): MemorySearchResult[] {
    const sourceSet = new Set(sources);
    return results.filter(r => sourceSet.has(r.entry.source));
  }
}

// Export singleton
export const memoryRetriever = new MemoryRetriever();
