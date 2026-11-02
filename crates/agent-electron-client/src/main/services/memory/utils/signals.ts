/**
 * Signal Detection Patterns
 *
 * Regex patterns for detecting memory extraction signals
 */

import type { SignalMatch } from '../types';

// ==================== Explicit Command Patterns ====================

/**
 * Explicit memory commands
 * Matches: "记住: xxx", "记得xxx", "remember: xxx", "remember this: xxx"
 */
export const EXPLICIT_PATTERNS: Array<{ pattern: RegExp; command: string }> = [
  {
    // "记住/记得" + optional colon + content (e.g., "记得我的名字是小花花", "记住：我的名字是小花花")
    // Stop at common delimiters: punctuation, comma, newline, ## (markdown headers), or end of string
    pattern: /(?:记住|记得)(?:[:：]\s*)?(.+?)(?:[。！？，,\n#]|$)/gi,
    command: 'remember',
  },
  {
    // English: "remember: xxx", "remember this: xxx"
    pattern: /(?:remember(?:\s+this)?)[:：]\s*(.+?)(?:[.!?,\n#]|$)/gi,
    command: 'remember',
  },
  {
    pattern: /(?:删除记忆|忘掉|忘记)[:：]\s*(.+?)(?:[。！？，,\n#]|$)/gi,
    command: 'forget',
  },
  {
    pattern: /(?:forget)[:：]\s*(.+?)(?:[.!?,\n#]|$)/gi,
    command: 'forget',
  },
];

// ==================== Implicit Signal Patterns ====================

/**
 * Personal information signals
 * Matches: "我叫xxx", "我是xxx", "我的名字是xxx"
 */
export const PERSONAL_INFO_PATTERNS: RegExp[] = [
  /(?:我叫|我是|我的名字(?:是|叫)?)\s*[:：]?\s*(\S+)/gi,
  /(?:I\s+am|my\s+name\s+is)\s+(\w+)/gi,
];

/**
 * Preference expression signals
 * Matches: "我喜欢xxx", "我偏好xxx", "我习惯xxx"
 */
export const PREFERENCE_PATTERNS: RegExp[] = [
  /(?:我喜欢|我偏好|我习惯|我更倾向|我比较喜欢)\s*[:：]?\s*(.+?)(?:[。！？\n]|$)/gi,
  /(?:I\s+(?:like|prefer|usually|tend\s+to))\s+(.+?)(?:[.!?\n]|$)/gi,
];

/**
 * Ownership signals
 * Matches: "我养了xxx", "我家有xxx", "我的xxx是"
 */
export const OWNERSHIP_PATTERNS: RegExp[] = [
  /(?:我养了|我家有|我的|我有一(?:只|个|台|辆))\s*(\S+)(?:是|叫)?\s*(\S*)/gi,
  /(?:I\s+have|my\s+|I\s+own)\s+(.+?)(?:[.!?\n]|$)/gi,
];

/**
 * Fact statement signals
 * Matches: "我在xxx", "我住xxx", "我来自xxx"
 */
export const FACT_STATEMENT_PATTERNS: RegExp[] = [
  /(?:我在|我住|我来自|我工作是|我在.*工作)/gi,
  /(?:I\s+(?:live|work|am\s+from|am\s+based))\s+(?:in|at)\s+/gi,
];

// ==================== Signal Detection Functions ====================

/**
 * Detect all signals in text
 */
export function detectSignals(text: string): SignalMatch[] {
  const matches: SignalMatch[] = [];

  // Check explicit patterns
  for (const { pattern, command } of EXPLICIT_PATTERNS) {
    pattern.lastIndex = 0;  // Reset regex state
    let match;
    while ((match = pattern.exec(text)) !== null) {
      matches.push({
        type: 'explicit',
        pattern: command,
        matchedText: match[0],
        extractedText: match[1]?.trim(),
      });
    }
  }

  // Check implicit patterns - personal info
  for (const pattern of PERSONAL_INFO_PATTERNS) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(text)) !== null) {
      matches.push({
        type: 'implicit',
        pattern: 'personal_info',
        matchedText: match[0],
      });
    }
  }

  // Check implicit patterns - preferences
  for (const pattern of PREFERENCE_PATTERNS) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(text)) !== null) {
      matches.push({
        type: 'implicit',
        pattern: 'preference',
        matchedText: match[0],
      });
    }
  }

  // Check implicit patterns - ownership
  for (const pattern of OWNERSHIP_PATTERNS) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(text)) !== null) {
      matches.push({
        type: 'implicit',
        pattern: 'ownership',
        matchedText: match[0],
      });
    }
  }

  // Check implicit patterns - fact statements
  for (const pattern of FACT_STATEMENT_PATTERNS) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(text)) !== null) {
      matches.push({
        type: 'implicit',
        pattern: 'fact',
        matchedText: match[0],
      });
    }
  }

  return matches;
}

/**
 * Check if text contains explicit memory command
 */
export function hasExplicitCommand(text: string): boolean {
  for (const { pattern } of EXPLICIT_PATTERNS) {
    pattern.lastIndex = 0;
    if (pattern.test(text)) {
      return true;
    }
  }
  return false;
}

/**
 * Extract explicit command content
 */
export function extractExplicitContent(text: string): { command: string; content: string } | null {
  for (const { pattern, command } of EXPLICIT_PATTERNS) {
    pattern.lastIndex = 0;
    const match = pattern.exec(text);
    if (match && match[1]) {
      let content = match[1].trim();

      // Skip if content is just a tone particle (下, 吧, 了, 啊, etc.)
      // These are common Chinese particles that indicate mood/tone, not actual content
      if (/^[下吧了啊呢吗呀哦]+$/.test(content)) {
        continue;
      }

      // Skip if content is too short (likely noise)
      if (content.length < 2) {
        continue;
      }

      return {
        command,
        content,
      };
    }
  }
  return null;
}

/**
 * Check if text contains implicit signals
 */
export function hasImplicitSignals(text: string): boolean {
  const allImplicitPatterns = [
    ...PERSONAL_INFO_PATTERNS,
    ...PREFERENCE_PATTERNS,
    ...OWNERSHIP_PATTERNS,
    ...FACT_STATEMENT_PATTERNS,
  ];

  for (const pattern of allImplicitPatterns) {
    pattern.lastIndex = 0;
    if (pattern.test(text)) {
      return true;
    }
  }
  return false;
}

/**
 * Count signal strength (number of signal matches)
 */
export function countSignalStrength(text: string): number {
  return detectSignals(text).length;
}

// ==================== Validation Patterns ====================

/**
 * Patterns that indicate temporary information
 */
export const TEMPORARY_PATTERNS: RegExp[] = [
  /(?:今天|昨天|明天|现在|刚才|待会)/,
  /(?:today|yesterday|tomorrow|now|just now|later)/i,
];

/**
 * Patterns that indicate questions
 */
export const QUESTION_PATTERNS: RegExp[] = [
  /\?|？/,
  /^(?:什么|怎么|如何|为什么|谁|哪|是否|能不能|可以)/,
  /^(?:what|how|why|who|where|when|can|could|would|is|are|do|does)/i,
];

/**
 * Check if text is a question
 */
export function isQuestion(text: string): boolean {
  for (const pattern of QUESTION_PATTERNS) {
    if (pattern.test(text.trim())) {
      return true;
    }
  }
  return false;
}

/**
 * Check if text contains temporary information
 */
export function isTemporary(text: string): boolean {
  for (const pattern of TEMPORARY_PATTERNS) {
    if (pattern.test(text)) {
      return true;
    }
  }
  return false;
}

/**
 * Check if text is primarily code
 */
export function isCode(text: string): boolean {
  const codeIndicators = [
    /^(?:function|const|let|var|class|import|export|if|for|while|return)/m,
    /(?:=>|\{|\}|\[|\]|;)$/,
    /```/,
  ];

  let codeScore = 0;
  for (const pattern of codeIndicators) {
    if (pattern.test(text)) {
      codeScore++;
    }
  }

  // If more than half of code indicators match, likely code
  return codeScore > codeIndicators.length / 2;
}
