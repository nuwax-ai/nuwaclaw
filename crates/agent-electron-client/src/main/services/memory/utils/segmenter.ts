/**
 * Segmenter Utility
 *
 * Builds overlapping segments from transcript entries for memory extraction.
 * Handles large message preprocessing (code block summarization, truncation).
 *
 * Based on specs/long-memory/long-memory.md Section 5.3
 */

import type { TranscriptEntry, Segment, SegmentationConfig } from '../types';

// ==================== Token Estimation ====================

/**
 * Estimate token count for text
 *
 * Uses a simple heuristic:
 * - Chinese characters: ~1.5 tokens each
 * - English words: ~1.3 tokens per word
 * - Other characters: ~0.25 tokens each (4 chars = 1 token)
 *
 * This is an approximation; actual token count depends on the tokenizer.
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;

  // Count Chinese characters (CJK range)
  const chineseChars = (text.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g) || []).length;

  // Count English words (approximate)
  const englishWords = (text.match(/[a-zA-Z]+/g) || []).length;

  // Count other characters
  const otherChars = text.length - chineseChars - (text.match(/[a-zA-Z]+/g) || []).join('').length;

  // Estimate tokens
  const tokens = Math.ceil(
    chineseChars * 1.5 +      // Chinese chars
    englishWords * 1.3 +       // English words
    otherChars * 0.25          // Other chars (punctuation, spaces, etc.)
  );

  return Math.max(1, tokens);
}

/**
 * Estimate tokens for an array of messages
 */
export function estimateMessagesTokens(
  messages: Array<{ role: string; content: string }>
): number {
  let total = 0;
  for (const msg of messages) {
    // Role prefix adds ~2 tokens per message
    total += 2 + estimateTokens(msg.content);
  }
  return total;
}

// ==================== Message Preprocessing ====================

/**
 * Code block pattern: ```lang\n...code...\n```
 */
const CODE_BLOCK_PATTERN = /```(\w*)\n([\s\S]*?)```/g;

/**
 * JSON structured data pattern (NOT XML - XML tags are handled separately)
 * Matches large JSON objects or arrays that are unlikely to contain memory signals
 */
const JSON_DATA_PATTERN = /(?:^|\n)\s*[{\[][\s\S]{300,}[}\]]\s*(?:\n|$)/g;

/**
 * Preprocess a single message content for extraction
 *
 * - Replaces code blocks with summaries
 * - Truncates long pure text (keep head + tail)
 * - Replaces large JSON data with type markers
 * - Does NOT replace XML - that's handled by MemoryExtractor.preprocessText
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

  // Replace large JSON data (but NOT XML - XML may contain user content)
  processed = processed.replace(JSON_DATA_PATTERN, (match) => {
    const trimmed = match.trim();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      return '\n[结构化数据: JSON]\n';
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

/**
 * Truncate message content to fit within token limit
 * Returns truncated content and whether truncation occurred
 */
export function truncateToTokenLimit(
  content: string,
  maxTokens: number
): { content: string; truncated: boolean } {
  const currentTokens = estimateTokens(content);
  if (currentTokens <= maxTokens) {
    return { content, truncated: false };
  }

  // Estimate chars needed (conservative: assume 3 chars per token)
  const targetChars = Math.floor(maxTokens * 3);

  if (content.length <= targetChars) {
    return { content, truncated: false };
  }

  // Keep head and tail
  const headSize = Math.floor(targetChars * 0.45);
  const tailSize = Math.floor(targetChars * 0.45);
  const omitted = content.length - headSize - tailSize;

  const truncated =
    content.slice(0, headSize) +
    `\n[...省略 ${omitted} 字符...]\n` +
    content.slice(-tailSize);

  return { content: truncated, truncated: true };
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
 *
 * Also respects maxSegmentTokens - if a segment exceeds token limit,
 * it will be dynamically reduced in size.
 */
export function buildSegments(
  entries: TranscriptEntry[],
  config: SegmentationConfig
): Segment[] {
  const { segmentSize, segmentOverlap, maxContentPerMessage, maxSegmentTokens } = config;

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

    // Preprocess messages
    let messages = segmentEntries.map(entry => ({
      role: entry.role,
      content: preprocessMessageContent(entry.content, maxContentPerMessage),
    }));

    // Check token limit and reduce if necessary
    let actualEnd = end;
    while (messages.length > 1) {
      const tokenCount = estimateMessagesTokens(messages);
      if (tokenCount <= maxSegmentTokens) {
        break;
      }

      // Remove last message to reduce token count
      messages.pop();
      actualEnd = start + messages.length;
    }

    // If still over limit with single message, truncate that message
    if (messages.length === 1) {
      const singleMsg = messages[0];
      const tokenCount = estimateMessagesTokens([singleMsg]);
      if (tokenCount > maxSegmentTokens) {
        // Reserve tokens for role prefix (~2 tokens)
        const { content: truncated } = truncateToTokenLimit(
          singleMsg.content,
          maxSegmentTokens - 2
        );
        messages[0] = { ...singleMsg, content: truncated };
      }
    }

    segments.push({
      index: segmentIndex,
      messages,
      startMsgIndex: start,
      endMsgIndex: actualEnd,
    });

    segmentIndex++;

    // If we've reached the end, stop
    if (actualEnd >= entries.length) {
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
