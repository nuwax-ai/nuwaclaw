/**
 * Segmenter Utility
 *
 * Builds overlapping segments from transcript entries for memory extraction.
 * Handles large message preprocessing (code block summarization, truncation).
 *
 * Based on specs/long-memory/long-memory.md Section 5.3
 */

import type { TranscriptEntry, Segment, SegmentationConfig } from '../types';

// ==================== Message Preprocessing ====================

/**
 * Code block pattern: ```lang\n...code...\n```
 */
const CODE_BLOCK_PATTERN = /```(\w*)\n([\s\S]*?)```/g;

/**
 * JSON/XML structured data pattern
 */
const STRUCTURED_DATA_PATTERN = /(?:^|\n)\s*[{[<][\s\S]{200,}[}\]>]\s*(?:\n|$)/g;

/**
 * Preprocess a single message content for extraction
 *
 * - Replaces code blocks with summaries
 * - Truncates long pure text (keep head + tail)
 * - Replaces large structured data with type markers
 */
export function preprocessMessageContent(
  content: string,
  maxChars: number
): string {
  if (content.length <= maxChars) {
    return content;
  }

  let processed = content;

  // Replace code blocks with summaries
  processed = processed.replace(CODE_BLOCK_PATTERN, (_match, lang, code) => {
    const lineCount = code.split('\n').length;
    const language = lang || '未知';
    return `[代码: ${language}, ${lineCount}行]`;
  });

  // Replace large structured data
  processed = processed.replace(STRUCTURED_DATA_PATTERN, (match) => {
    if (match.trim().startsWith('{') || match.trim().startsWith('[')) {
      return '\n[结构化数据: JSON]\n';
    }
    if (match.trim().startsWith('<')) {
      return '\n[结构化数据: XML]\n';
    }
    return match;
  });

  // If still too long after code/data replacement, truncate
  if (processed.length > maxChars) {
    const headSize = Math.floor(maxChars * 0.4);
    const tailSize = Math.floor(maxChars * 0.4);
    const omitted = processed.length - headSize - tailSize;

    processed =
      processed.slice(0, headSize) +
      `\n[...省略 ${omitted} 字符...]\n` +
      processed.slice(-tailSize);
  }

  return processed;
}

// ==================== Segment Builder ====================

/**
 * Build overlapping segments from transcript entries
 *
 * Example with segmentSize=5, overlap=2:
 *   Segment 0: [M0, M1, M2, M3, M4]
 *   Segment 1: [M3, M4, M5, M6, M7]
 *   Segment 2: [M6, M7, M8, M9, M10]
 *   Segment 3: [M9, M10, M11] (tail, possibly shorter)
 */
export function buildSegments(
  entries: TranscriptEntry[],
  config: SegmentationConfig
): Segment[] {
  const { segmentSize, segmentOverlap, maxContentPerMessage } = config;

  if (entries.length === 0) {
    return [];
  }

  const step = segmentSize - segmentOverlap;
  if (step <= 0) {
    throw new Error(
      `Invalid segmentation config: segmentSize (${segmentSize}) must be > segmentOverlap (${segmentOverlap})`
    );
  }

  const segments: Segment[] = [];
  let segmentIndex = 0;

  for (let start = 0; start < entries.length; start += step) {
    const end = Math.min(start + segmentSize, entries.length);
    const segmentEntries = entries.slice(start, end);

    const messages = segmentEntries.map(entry => ({
      role: entry.role,
      content: preprocessMessageContent(entry.content, maxContentPerMessage),
    }));

    segments.push({
      index: segmentIndex,
      messages,
      startMsgIndex: start,
      endMsgIndex: end,
    });

    segmentIndex++;

    // If we've reached the end, stop
    if (end >= entries.length) {
      break;
    }
  }

  return segments;
}

/**
 * Build segments from a specific start index
 * Used for session-end extraction to process only unprocessed messages
 */
export function buildSegmentsFromIndex(
  entries: TranscriptEntry[],
  startFromIndex: number,
  config: SegmentationConfig
): Segment[] {
  if (startFromIndex >= entries.length) {
    return [];
  }

  const remaining = entries.slice(startFromIndex);
  const segments = buildSegments(remaining, config);

  // Adjust indices to be relative to the original transcript
  return segments.map(segment => ({
    ...segment,
    startMsgIndex: segment.startMsgIndex + startFromIndex,
    endMsgIndex: segment.endMsgIndex + startFromIndex,
  }));
}
