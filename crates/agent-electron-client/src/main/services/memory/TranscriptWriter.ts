/**
 * Transcript Writer Module
 *
 * Manages JSONL session transcript files for memory extraction.
 * Each session's messages are appended to a JSONL file in .memory/transcripts/.
 *
 * Based on specs/long-memory/long-memory.md Section 5.2
 */

import * as fs from 'fs';
import * as path from 'path';
import log from 'electron-log';
import type { TranscriptEntry } from './types';
import { MEMORY_DB_DIR, TRANSCRIPT_DIR } from './constants';

// ==================== Sensitive Data Patterns ====================

const SENSITIVE_PATTERNS = [
  // API keys
  /(?:api[_-]?key|apikey|secret[_-]?key)\s*[:=]\s*['"]?[\w\-]{20,}['"]?/gi,
  // Bearer tokens
  /Bearer\s+[\w\-\.]{20,}/gi,
  // Generic tokens
  /(?:token|authorization)\s*[:=]\s*['"]?[\w\-\.]{20,}['"]?/gi,
  // AWS keys
  /AKIA[\w]{16}/g,
  // Base64-encoded credentials
  /(?:password|passwd|pwd)\s*[:=]\s*['"]?[^\s'"]{8,}['"]?/gi,
];

const SENSITIVE_REPLACEMENT = '[REDACTED]';

// ==================== TranscriptWriter Class ====================

export class TranscriptWriter {
  private workspaceDir: string = '';
  private transcriptsDir: string = '';
  private initialized: boolean = false;

  /**
   * Initialize transcript writer
   */
  init(workspaceDir: string): void {
    this.workspaceDir = workspaceDir;
    this.transcriptsDir = path.join(workspaceDir, MEMORY_DB_DIR, TRANSCRIPT_DIR);

    // Ensure transcripts directory exists
    if (!fs.existsSync(this.transcriptsDir)) {
      fs.mkdirSync(this.transcriptsDir, { recursive: true });
    }

    this.initialized = true;
    log.info('[TranscriptWriter] Initialized at:', this.transcriptsDir);
  }

  /**
   * Destroy transcript writer
   */
  destroy(): void {
    this.initialized = false;
    this.workspaceDir = '';
    this.transcriptsDir = '';
  }

  // ==================== Write Operations ====================

  /**
   * Append a message to session transcript (JSONL)
   *
   * Writes are append-only and atomic (single line).
   * Content is sanitized to remove sensitive data before writing.
   */
  appendMessage(
    sessionId: string,
    role: 'user' | 'assistant',
    content: string,
    msgId: string
  ): void {
    if (!this.initialized) {
      log.warn('[TranscriptWriter] Not initialized, skipping append');
      return;
    }

    const sanitizedContent = this.sanitizeContent(content);

    const entry: TranscriptEntry = {
      ts: Date.now(),
      role,
      content: sanitizedContent,
      msgId,
    };

    const line = JSON.stringify(entry) + '\n';
    const filePath = this.getTranscriptPath(sessionId);

    try {
      fs.appendFileSync(filePath, line, 'utf-8');
    } catch (error) {
      log.error('[TranscriptWriter] Failed to append message:', error);
    }
  }

  // ==================== Read Operations ====================

  /**
   * Read complete transcript for a session
   */
  readTranscript(sessionId: string): TranscriptEntry[] {
    const filePath = this.getTranscriptPath(sessionId);

    if (!fs.existsSync(filePath)) {
      return [];
    }

    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      return this.parseJsonl(content);
    } catch (error) {
      log.error('[TranscriptWriter] Failed to read transcript:', error);
      return [];
    }
  }

  /**
   * Read a range of messages from transcript
   *
   * @param sessionId - Session ID
   * @param startIndex - Start index (inclusive, 0-based)
   * @param endIndex - End index (exclusive)
   */
  readTranscriptRange(
    sessionId: string,
    startIndex: number,
    endIndex: number
  ): TranscriptEntry[] {
    const entries = this.readTranscript(sessionId);
    return entries.slice(startIndex, endIndex);
  }

  /**
   * Count messages in transcript
   */
  countMessages(sessionId: string): number {
    const filePath = this.getTranscriptPath(sessionId);

    if (!fs.existsSync(filePath)) {
      return 0;
    }

    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      // Count non-empty lines
      return content.split('\n').filter(line => line.trim().length > 0).length;
    } catch (error) {
      log.error('[TranscriptWriter] Failed to count messages:', error);
      return 0;
    }
  }

  // ==================== Path Operations ====================

  /**
   * Get transcript file path for a session
   */
  getTranscriptPath(sessionId: string): string {
    // Sanitize sessionId to prevent path traversal
    const safeId = sessionId.replace(/[^a-zA-Z0-9_-]/g, '_');
    return path.join(this.transcriptsDir, `${safeId}.jsonl`);
  }

  /**
   * Check if transcript exists for a session
   */
  hasTranscript(sessionId: string): boolean {
    return fs.existsSync(this.getTranscriptPath(sessionId));
  }

  // ==================== Cleanup Operations ====================

  /**
   * Delete transcript for a session
   */
  deleteTranscript(sessionId: string): void {
    const filePath = this.getTranscriptPath(sessionId);

    if (fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath);
        log.debug('[TranscriptWriter] Deleted transcript:', sessionId);
      } catch (error) {
        log.error('[TranscriptWriter] Failed to delete transcript:', error);
      }
    }
  }

  /**
   * Cleanup old transcript files
   *
   * Deletes transcript files whose mtime is older than retentionDays.
   * Returns the number of files deleted.
   */
  cleanupOldTranscripts(retentionDays: number): number {
    if (!this.initialized || !fs.existsSync(this.transcriptsDir)) {
      return 0;
    }

    const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
    let deleted = 0;

    try {
      const files = fs.readdirSync(this.transcriptsDir);

      for (const file of files) {
        if (!file.endsWith('.jsonl')) continue;

        const filePath = path.join(this.transcriptsDir, file);

        try {
          const stats = fs.statSync(filePath);

          if (stats.mtimeMs < cutoff) {
            fs.unlinkSync(filePath);
            deleted++;
            log.debug('[TranscriptWriter] Cleaned up old transcript:', file);
          }
        } catch (error) {
          log.error('[TranscriptWriter] Failed to check/delete file:', file, error);
        }
      }
    } catch (error) {
      log.error('[TranscriptWriter] Failed to cleanup transcripts:', error);
    }

    if (deleted > 0) {
      log.info(`[TranscriptWriter] Cleaned up ${deleted} old transcript files`);
    }

    return deleted;
  }

  // ==================== Private Helpers ====================

  /**
   * Sanitize content by removing sensitive data
   */
  private sanitizeContent(content: string): string {
    let sanitized = content;

    for (const pattern of SENSITIVE_PATTERNS) {
      sanitized = sanitized.replace(pattern, SENSITIVE_REPLACEMENT);
    }

    return sanitized;
  }

  /**
   * Parse JSONL content into TranscriptEntry array
   */
  private parseJsonl(content: string): TranscriptEntry[] {
    const entries: TranscriptEntry[] = [];
    const lines = content.split('\n');

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.length === 0) continue;

      try {
        const entry = JSON.parse(trimmed) as TranscriptEntry;
        entries.push(entry);
      } catch (error) {
        log.warn('[TranscriptWriter] Skipping malformed JSONL line');
      }
    }

    return entries;
  }
}

// Export singleton
export const transcriptWriter = new TranscriptWriter();
