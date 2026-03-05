/**
 * Memory Extractor Module
 *
 * Extract memories from conversations using regex signals and rule-based scoring
 * Based on specs/long-memory/long-memory.md
 */

import { EventEmitter } from 'events';
import log from 'electron-log';
import type {
  ExtractedMemory,
  SignalMatch,
  ValidationResult,
  ModelConfig,
  MemoryCategory,
} from './types';
import {
  SCORE_PERSONAL_FACT,
  SCORE_APPROPRIATE_LENGTH,
  SCORE_CLEAR_PREFERENCE,
  SCORE_QUESTION,
  SCORE_TEMPORARY,
  SCORE_CODE,
  SCORE_SPECIFIC_TIME,
  SCORE_MIN_ACCEPT,
  SCORE_LLM_THRESHOLD_LOW,
  SCORE_LLM_THRESHOLD_HIGH,
  LLM_EXTRACTION_PROMPT,
  LLM_VALIDATION_PROMPT,
} from './constants';
import {
  detectSignals,
  extractExplicitContent,
  hasExplicitCommand,
  hasImplicitSignals,
  isQuestion,
  isTemporary,
  isCode,
  countSignalStrength,
} from './utils/signals';
import { calculateHash } from './utils/hash';

// ==================== Types ====================

interface ExtractionOptions {
  explicitEnabled: boolean;
  implicitEnabled: boolean;
  guardLevel: 'strict' | 'standard' | 'relaxed';
}

interface ScoringResult {
  score: number;
  breakdown: {
    personalFact: number;
    appropriateLength: number;
    clearPreference: number;
    question: number;
    temporary: number;
    code: number;
    specificTime: number;
  };
}

// ==================== MemoryExtractor Class ====================

export class MemoryExtractor extends EventEmitter {
  private options: ExtractionOptions = {
    explicitEnabled: true,
    implicitEnabled: true,
    guardLevel: 'standard',
  };

  /**
   * Configure extractor
   */
  configure(options: Partial<ExtractionOptions>): void {
    this.options = { ...this.options, ...options };
  }

  /**
   * Extract memories from conversation
   */
  async extract(
    messages: Array<{ role: string; content: string }>,
    options?: Partial<ExtractionOptions>
  ): Promise<ExtractedMemory[]> {
    const opts = { ...this.options, ...options };
    const results: ExtractedMemory[] = [];

    for (const message of messages) {
      // Only process user messages for memory extraction
      if (message.role !== 'user') continue;

      const extracted = await this.extractFromMessage(message.content, opts);
      results.push(...extracted);
    }

    // Deduplicate by text hash
    return this.deduplicate(results);
  }

  /**
   * Extract memories from a single message
   */
  private async extractFromMessage(
    text: string,
    options: ExtractionOptions
  ): Promise<ExtractedMemory[]> {
    const results: ExtractedMemory[] = [];

    // Preprocess: extract user content from system prompts
    const cleanText = this.preprocessText(text);

    // Detect signals
    const signals = detectSignals(cleanText);
    log.info('[MemoryExtractor] extractFromMessage: signals=' + signals.length +
      ', cleanText="' + cleanText.slice(0, 50) + '"');

    if (signals.length === 0) {
      return results;
    }

    log.info('[MemoryExtractor] Signal types: ' + signals.map(s => s.pattern).join(', '));

    // Process explicit commands
    if (options.explicitEnabled) {
      const explicitSignals = signals.filter(s => s.type === 'explicit');
      for (const signal of explicitSignals) {
        const memory = this.processExplicitSignal(signal, cleanText);
        if (memory) {
          results.push(memory);
        }
      }
    }

    // Process implicit signals
    if (options.implicitEnabled) {
      const implicitSignals = signals.filter(s => s.type === 'implicit');
      if (implicitSignals.length > 0) {
        const memory = this.processImplicitSignals(implicitSignals, cleanText, options.guardLevel);
        if (memory) {
          log.info('[MemoryExtractor] Extracted implicit memory: "' + memory.text.slice(0, 50) + '"');
          results.push(memory);
        }
      }
    }

    return results;
  }

  /**
   * Process explicit signal (e.g., "记住: xxx")
   */
  private processExplicitSignal(signal: SignalMatch, text: string): ExtractedMemory | null {
    const explicitContent = extractExplicitContent(text);

    if (!explicitContent || !explicitContent.content) {
      return null;
    }

    // Skip "forget" commands for now (handled separately)
    if (explicitContent.command === 'forget') {
      this.emit('forget:requested', explicitContent.content);
      return null;
    }

    return {
      text: explicitContent.content,
      category: this.inferCategory(explicitContent.content),
      confidence: 0.95,  // High confidence for explicit commands
      isExplicit: true,
    };
  }

  /**
   * Process implicit signals
   */
  private processImplicitSignals(
    signals: SignalMatch[],
    text: string,
    guardLevel: 'strict' | 'standard' | 'relaxed'
  ): ExtractedMemory | null {
    // Score the candidate
    const scoring = this.scoreCandidate(text, signals);
    log.debug('[MemoryExtractor] processImplicitSignals: score=', scoring.score, 'breakdown=', scoring.breakdown);

    // Determine threshold based on guard level
    let threshold = SCORE_MIN_ACCEPT;
    if (guardLevel === 'strict') {
      threshold = 0.7;
    } else if (guardLevel === 'relaxed') {
      threshold = 0.5;
    }

    // Check if score meets threshold
    if (scoring.score < threshold) {
      log.debug('[MemoryExtractor] processImplicitSignals: score', scoring.score, '< threshold', threshold, '- rejected');
      return null;
    }

    // Extract the relevant text
    const extractedText = this.extractRelevantText(text, signals);

    return {
      text: extractedText,
      category: this.inferCategoryFromSignals(signals),
      confidence: scoring.score,
      isExplicit: false,
    };
  }

  /**
   * Score a memory candidate
   */
  scoreCandidate(text: string, signals: SignalMatch[]): ScoringResult {
    const breakdown = {
      personalFact: 0,
      appropriateLength: 0,
      clearPreference: 0,
      question: 0,
      temporary: 0,
      code: 0,
      specificTime: 0,
    };

    // Positive scores
    if (signals.some(s => s.pattern === 'personal_info' || s.pattern === 'fact')) {
      breakdown.personalFact = SCORE_PERSONAL_FACT;
    }

    if (signals.some(s => s.pattern === 'preference')) {
      breakdown.clearPreference = SCORE_CLEAR_PREFERENCE;
    }

    // Check length (10-200 chars is ideal)
    const cleanText = text.trim();
    if (cleanText.length >= 10 && cleanText.length <= 200) {
      breakdown.appropriateLength = SCORE_APPROPRIATE_LENGTH;
    }

    // Negative scores
    if (isQuestion(cleanText)) {
      breakdown.question = SCORE_QUESTION;
    }

    if (isTemporary(cleanText)) {
      breakdown.temporary = SCORE_TEMPORARY;
    }

    if (isCode(cleanText)) {
      breakdown.code = SCORE_CODE;
    }

    // Check for specific time references
    if (/\d{1,2}:\d{2}|\d{4}年\d{1,2}月\d{1,2}日/.test(cleanText)) {
      breakdown.specificTime = SCORE_SPECIFIC_TIME;
    }

    // Calculate total score
    let score = 0.5; // Base score
    score += breakdown.personalFact;
    score += breakdown.appropriateLength;
    score += breakdown.clearPreference;
    score += breakdown.question;
    score += breakdown.temporary;
    score += breakdown.code;
    score += breakdown.specificTime;

    // Clamp to 0-1
    score = Math.max(0, Math.min(1, score));

    return { score, breakdown };
  }

  /**
   * Preprocess text for memory extraction
   * Currently returns the text as-is, waiting for new API field for pure user input
   */
  private preprocessText(text: string): string {
    if (!text) return '';
    log.info('[MemoryExtractor] preprocessText: length=' + text.length);
    return text.trim();
  }

  /**
   * Extract relevant text from message based on signals
   */
  private extractRelevantText(text: string, signals: SignalMatch[]): string {
    // For implicit signals, extract the sentence containing the signal
    const sentences = text.split(/[。！？\n]/).filter(s => s.trim());

    for (const sentence of sentences) {
      for (const signal of signals) {
        if (sentence.includes(signal.matchedText.replace(/[:：]\s*.*/, ''))) {
          // Clean up the extracted sentence
          return this.cleanExtractedText(sentence.trim());
        }
      }
    }

    // Fallback: return the whole text if it's not too long
    if (text.length <= 200) {
      return this.cleanExtractedText(text.trim());
    }

    // Return first 200 chars
    return this.cleanExtractedText(text.trim().slice(0, 200));
  }

  /**
   * Clean extracted text by removing tone particles and irrelevant suffixes
   */
  private cleanExtractedText(text: string): string {
    let cleaned = text;

    // Remove common Chinese tone particles and suffixes that aren't part of the memory
    // e.g., "你记住下" should just be the preceding content
    cleaned = cleaned.replace(/[，,]?你?(?:记住|记得)[下吧了啊]?/g, '');

    // Remove trailing punctuation that looks incomplete
    cleaned = cleaned.replace(/[，,;；\s]+$/g, '');

    // Remove markdown headers
    cleaned = cleaned.replace(/#+\s*$/g, '');

    return cleaned.trim();
  }

  /**
   * Infer memory category from text content
   */
  private inferCategory(text: string): MemoryCategory {
    const lowerText = text.toLowerCase();

    // Check for preference indicators
    if (/喜欢|偏好|习惯|倾向|prefer|like|usually/.test(lowerText)) {
      return 'preference';
    }

    // Check for decision indicators
    if (/决定|选择|采用|使用|方案|decide|choose|adopt|approach/.test(lowerText)) {
      return 'decision';
    }

    // Check for event indicators
    if (/昨天|今天|明天|上周|下周|yesterday|tomorrow|next|last/.test(lowerText)) {
      return 'event';
    }

    // Check for skill indicators
    if (/会|能|擅长|skill|can|able|expert/.test(lowerText)) {
      return 'skill';
    }

    // Default to fact
    return 'fact';
  }

  /**
   * Infer category from signal types
   */
  private inferCategoryFromSignals(signals: SignalMatch[]): MemoryCategory {
    if (signals.some(s => s.pattern === 'preference')) {
      return 'preference';
    }

    if (signals.some(s => s.pattern === 'personal_info' || s.pattern === 'ownership')) {
      return 'fact';
    }

    return 'fact';
  }

  /**
   * Deduplicate extracted memories
   */
  private deduplicate(memories: ExtractedMemory[]): ExtractedMemory[] {
    const seen = new Set<string>();
    const result: ExtractedMemory[] = [];

    for (const memory of memories) {
      const hash = calculateHash(memory.text);
      if (!seen.has(hash)) {
        seen.add(hash);
        result.push(memory);
      }
    }

    return result;
  }

  // ==================== LLM Integration ====================

  /**
   * Check if LLM validation is needed based on score
   */
  needsLlmValidation(score: number): boolean {
    return score >= SCORE_LLM_THRESHOLD_LOW && score <= SCORE_LLM_THRESHOLD_HIGH;
  }

  /**
   * Build LLM extraction prompt
   *
   * @param messages - Conversation messages to extract from
   * @param segmentMeta - Optional segment metadata for segmented extraction
   * @param existingMemories - Optional list of existing memories to avoid duplicates
   */
  buildExtractionPrompt(
    messages: Array<{ role: string; content: string }>,
    segmentMeta?: { index: number; total: number },
    existingMemories?: string[]
  ): string {
    const conversationHistory = messages
      .map(m => `${m.role === 'user' ? '用户' : '助手'}: ${m.content}`)
      .join('\n\n');

    const segmentInfo = segmentMeta
      ? `(第 ${segmentMeta.index + 1}/${segmentMeta.total} 段)`
      : '';

    const existingMems = existingMemories && existingMemories.length > 0
      ? existingMemories.map(m => `- ${m}`).join('\n')
      : '(无)';

    return LLM_EXTRACTION_PROMPT
      .replace('{segment_info}', segmentInfo)
      .replace('{conversation_history}', conversationHistory)
      .replace('{existing_memories}', existingMems);
  }

  /**
   * Build LLM validation prompt
   */
  buildValidationPrompt(
    candidateMemory: string,
    existingMemories: string[]
  ): string {
    return LLM_VALIDATION_PROMPT
      .replace('{candidate_memory}', candidateMemory)
      .replace('{existing_memories}', existingMemories.join('\n') || '(无)');
  }

  /**
   * Parse LLM extraction response
   */
  parseExtractionResponse(response: string): ExtractedMemory[] {
    try {
      // Try to extract JSON array from response
      const jsonMatch = response.match(/\[[\s\S]*\]/);
      if (!jsonMatch) {
        return [];
      }

      const parsed = JSON.parse(jsonMatch[0]);

      if (!Array.isArray(parsed)) {
        return [];
      }

      return parsed.map(item => ({
        text: item.text || '',
        category: item.category || 'fact',
        confidence: typeof item.confidence === 'number' ? item.confidence : 0.75,
        isExplicit: false,
      })).filter(m => m.text.length > 0);
    } catch (error) {
      log.warn('[MemoryExtractor] Failed to parse LLM response:', error);
      return [];
    }
  }

  /**
   * Parse LLM validation response
   */
  parseValidationResponse(response: string): ValidationResult {
    try {
      // Try to extract JSON from response
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        return { accept: false, reason: 'Failed to parse response', confidence: 0 };
      }

      const parsed = JSON.parse(jsonMatch[0]);

      return {
        accept: parsed.accept === true,
        reason: parsed.reason,
        mergedText: parsed.merged_text,
        confidence: parsed.accept ? 0.9 : 0.1,
      };
    } catch (error) {
      log.warn('[MemoryExtractor] Failed to parse validation response:', error);
      return { accept: false, reason: 'Parse error', confidence: 0 };
    }
  }

  // ==================== Utility Methods ====================

  /**
   * Quick check if message contains extractable content
   */
  hasExtractableContent(text: string, options?: Partial<ExtractionOptions>): boolean {
    const opts = { ...this.options, ...options };

    if (opts.explicitEnabled && hasExplicitCommand(text)) {
      return true;
    }

    if (opts.implicitEnabled && hasImplicitSignals(text)) {
      return true;
    }

    return false;
  }

  /**
   * Get signal count for message
   */
  getSignalCount(text: string): number {
    return countSignalStrength(text);
  }

  /**
   * Format memories for daily memory file
   */
  formatForDailyMemory(memories: ExtractedMemory[]): string {
    return memories
      .map(m => `- ${m.text}`)
      .join('\n');
  }
}

// Export singleton
export const memoryExtractor = new MemoryExtractor();
