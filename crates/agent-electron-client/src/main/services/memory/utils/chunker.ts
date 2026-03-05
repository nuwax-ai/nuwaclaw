/**
 * Markdown Chunker
 *
 * Split Markdown files into chunks for indexing
 */

import type { MemoryChunk } from '../types';
import { calculateHash } from './hash';
import { CHUNK_MAX_CHARS, CHUNK_OVERLAP_CHARS } from '../constants';

/**
 * Chunk options
 */
export interface ChunkOptions {
  maxChars?: number;
  overlapChars?: number;
}

/**
 * Parse Markdown file into chunks
 * - Core memory (MEMORY.md): splits by ## headings (level 2)
 * - Daily memory (daily/*.md): splits by --- separator
 */
export function chunkMarkdown(
  content: string,
  sourcePath: string,
  options: ChunkOptions = {}
): MemoryChunk[] {
  const maxChars = options.maxChars ?? CHUNK_MAX_CHARS;
  const overlapChars = options.overlapChars ?? CHUNK_OVERLAP_CHARS;

  // Detect file type based on source path
  const isDailyMemory = sourcePath.includes('daily/');

  if (isDailyMemory) {
    return chunkDailyMemory(content, maxChars);
  } else {
    return chunkCoreMemory(content, maxChars, overlapChars);
  }
}

/**
 * Chunk core memory file (MEMORY.md)
 * Splits by ## headings (level 2)
 */
function chunkCoreMemory(
  content: string,
  maxChars: number,
  overlapChars: number
): MemoryChunk[] {
  const chunks: MemoryChunk[] = [];
  const lines = content.split('\n');
  let currentChunk: string[] = [];
  let startLine = 1;
  let currentLine = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    currentLine = i + 1;  // 1-indexed

    // Check for ## heading (section boundary)
    const isSectionHeading = /^##\s/.test(line);

    if (isSectionHeading && currentChunk.length > 0) {
      // Save current chunk
      const chunkText = currentChunk.join('\n').trim();
      if (chunkText) {
        chunks.push(createChunk(chunkText, startLine, currentLine - 1));
      }

      // Start new chunk
      currentChunk = [line];
      startLine = currentLine;
    } else {
      currentChunk.push(line);

      // Check if chunk exceeds max size
      const chunkText = currentChunk.join('\n');
      if (chunkText.length > maxChars) {
        // Find a good break point
        const breakResult = findBreakPoint(currentChunk, maxChars, overlapChars);

        if (breakResult) {
          // Save the chunk before break
          const chunkText = breakResult.before.join('\n').trim();
          if (chunkText) {
            chunks.push(createChunk(chunkText, startLine, startLine + breakResult.before.length - 1));
          }

          // Continue with overlap
          currentChunk = breakResult.after;
          startLine = startLine + breakResult.before.length - breakResult.after.length;
        } else {
          // No good break point, just save what we have
          const chunkText = currentChunk.join('\n').trim();
          if (chunkText) {
            chunks.push(createChunk(chunkText, startLine, currentLine));
          }
          currentChunk = [];
          startLine = currentLine + 1;
        }
      }
    }
  }

  // Save remaining chunk
  if (currentChunk.length > 0) {
    const chunkText = currentChunk.join('\n').trim();
    if (chunkText) {
      chunks.push(createChunk(chunkText, startLine, currentLine));
    }
  }

  return chunks;
}

/**
 * Chunk daily memory file (daily/*.md)
 * Splits by --- separator
 */
function chunkDailyMemory(
  content: string,
  maxChars: number
): MemoryChunk[] {
  const chunks: MemoryChunk[] = [];
  const lines = content.split('\n');
  let currentChunk: string[] = [];
  let startLine = 1;
  let currentLine = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    currentLine = i + 1;  // 1-indexed

    // Check for --- separator (section boundary for daily memory)
    const isSeparator = /^---$/.test(line.trim());

    if (isSeparator && currentChunk.length > 0) {
      // Save current chunk
      const chunkText = currentChunk.join('\n').trim();
      if (chunkText && chunkText.length >= 2) {
        chunks.push(createChunk(chunkText, startLine, currentLine - 1));
      }

      // Start new chunk (skip the separator line itself)
      currentChunk = [];
      startLine = currentLine + 1;
    } else {
      currentChunk.push(line);

      // Check if chunk exceeds max size (split by ### session heading as fallback)
      const chunkText = currentChunk.join('\n');
      if (chunkText.length > maxChars) {
        // Try to find a ### heading to split on
        const splitIndex = findSessionSplitPoint(currentChunk);
        if (splitIndex >= 0) {
          const before = currentChunk.slice(0, splitIndex);
          const beforeText = before.join('\n').trim();
          if (beforeText && beforeText.length >= 2) {
            chunks.push(createChunk(beforeText, startLine, startLine + before.length - 1));
          }
          currentChunk = currentChunk.slice(splitIndex);
          startLine = startLine + splitIndex;
        }
      }
    }
  }

  // Save remaining chunk
  if (currentChunk.length > 0) {
    const chunkText = currentChunk.join('\n').trim();
    if (chunkText && chunkText.length >= 2) {
      chunks.push(createChunk(chunkText, startLine, currentLine));
    }
  }

  return chunks;
}

/**
 * Find a good split point in daily memory chunk (### session heading)
 */
function findSessionSplitPoint(lines: string[]): number {
  for (let i = lines.length - 1; i >= 0; i--) {
    if (/^###\s/.test(lines[i])) {
      return i;
    }
  }
  return -1;
}

/**
 * Create a memory chunk object
 */
function createChunk(text: string, startLine: number, endLine: number): MemoryChunk {
  return {
    text,
    hash: calculateHash(text),
    startLine,
    endLine,
  };
}

/**
 * Find a good break point in a chunk
 */
function findBreakPoint(
  lines: string[],
  maxChars: number,
  overlapChars: number
): { before: string[]; after: string[] } | null {
  // Try to find paragraph break (empty line)
  let accumulated = 0;
  let breakIndex = -1;

  for (let i = 0; i < lines.length; i++) {
    const lineLen = lines[i].length + 1; // +1 for newline

    if (accumulated + lineLen > maxChars && breakIndex >= 0) {
      // Found a break point
      const before = lines.slice(0, breakIndex + 1);

      // Calculate overlap
      let overlapAccum = 0;
      let overlapStart = before.length;
      for (let j = before.length - 1; j >= 0 && overlapAccum < overlapChars; j--) {
        overlapAccum += before[j].length + 1;
        overlapStart = j;
      }

      const after = lines.slice(overlapStart);
      return { before, after };
    }

    accumulated += lineLen;

    // Mark paragraph breaks as potential break points
    if (lines[i].trim() === '' || lines[i].startsWith('###')) {
      breakIndex = i;
    }
  }

  return null;
}

/**
 * Parse daily memory file to extract session blocks
 */
export function parseDailyMemoryFile(content: string): Array<{ time: string; content: string; startLine: number; endLine: number }> {
  const sessions: Array<{ time: string; content: string; startLine: number; endLine: number }> = [];
  const lines = content.split('\n');

  let currentSession: { time: string; lines: string[]; startLine: number } | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const sessionMatch = line.match(/^###\s+(\d{1,2}:\d{2})\s+(.+)$/);

    if (sessionMatch) {
      // Save previous session
      if (currentSession) {
        sessions.push({
          time: currentSession.time,
          content: currentSession.lines.join('\n').trim(),
          startLine: currentSession.startLine,
          endLine: i,
        });
      }

      // Start new session
      currentSession = {
        time: `${sessionMatch[1]} ${sessionMatch[2]}`,
        lines: [],
        startLine: i + 1,
      };
    } else if (currentSession) {
      // Skip separator lines
      if (!line.match(/^---$/)) {
        currentSession.lines.push(line);
      }
    }
  }

  // Save last session
  if (currentSession) {
    sessions.push({
      time: currentSession.time,
      content: currentSession.lines.join('\n').trim(),
      startLine: currentSession.startLine,
      endLine: lines.length,
    });
  }

  return sessions;
}

/**
 * Compare old and new chunks to find changes
 */
export function compareChunks(
  oldChunks: MemoryChunk[],
  newChunks: MemoryChunk[]
): { added: MemoryChunk[]; removed: string[]; unchanged: MemoryChunk[] } {
  const oldHashes = new Set(oldChunks.map(c => c.hash));
  const newHashes = new Set(newChunks.map(c => c.hash));

  const added = newChunks.filter(c => !oldHashes.has(c.hash));
  const removed = oldChunks.filter(c => !newHashes.has(c.hash)).map(c => c.hash);
  const unchanged = newChunks.filter(c => oldHashes.has(c.hash));

  return { added, removed, unchanged };
}
