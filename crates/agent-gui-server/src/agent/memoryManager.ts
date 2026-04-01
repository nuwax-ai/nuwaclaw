/**
 * Three-layer memory management with LLM summarization.
 *
 * Layers:
 *   summaryMemory (budget: 2000 chars) — compressed history
 *   recentMemory  (budget: 500 chars)  — recent step records
 *   pendingMemory (no budget)          — current step in progress
 *
 * Memory text is injected into systemPrompt (not via transformContext).
 * Screenshot pruning (pruneScreenshots) is used as transformContext hook.
 */

import { complete } from '@mariozechner/pi-ai';
import type { Model, Api, AssistantMessage } from '@mariozechner/pi-ai';
import { logInfo, logDebug, logError } from '../utils/logger.js';

// Type alias for AgentMessage — we only need role and content fields
interface MessageLike {
  role: string;
  content: unknown;
  [key: string]: unknown;
}

const MEMORY_SUMMARIZATION_PROMPT = `You are a memory summarization assistant for a GUI automation agent.
Your task is to condense step-by-step action records into concise memory entries.

Output JSON:
{
  "summary": "Concise summary of the actions taken and their outcomes..."
}

Guidelines:
- Preserve key information: what was done, what succeeded/failed, current state
- Remove redundant details and repetitive patterns
- Keep the summary actionable — the agent needs to know what happened to plan next steps`;

export class MemoryManager {
  private summaryMemory: string = '';
  private recentMemory: string = '';
  private pendingMemory: string = '';

  private recentBudget: number = 500;
  private summaryBudget: number = 2000;
  private screenshotKeepCount: number = 3;

  private memoryModel: Model<any>;
  private apiKey: string;

  constructor(memoryModel: Model<any>, apiKey: string) {
    this.memoryModel = memoryModel;
    this.apiKey = apiKey;
  }

  /**
   * Record a pending step (currently executing).
   */
  addPendingStep(stepId: number, goal: string): void {
    this.pendingMemory = `Step ${stepId} | Goal: ${goal}`;
  }

  /**
   * Finalize a step — move from pending to recent, trigger compression if over budget.
   */
  async finalizeStep(stepId: number, evaluation: 'success' | 'failed'): Promise<void> {
    const entry = `Step ${stepId} | Eval: ${evaluation} | ${this.pendingMemory.replace(`Step ${stepId} | `, '')}`;
    this.pendingMemory = '';

    if (this.recentMemory) {
      this.recentMemory += '\n' + entry;
    } else {
      this.recentMemory = entry;
    }

    // Check if recent memory exceeds budget
    if (this.recentMemory.length > this.recentBudget) {
      await this.compressRecent();
    }
  }

  /**
   * Compose all three layers into a single text block for systemPrompt injection.
   */
  compose(): string {
    const parts: string[] = [];
    if (this.summaryMemory) {
      parts.push(`[Summarized history]\n${this.summaryMemory}`);
    }
    if (this.recentMemory) {
      parts.push(`[Recent steps]\n${this.recentMemory}`);
    }
    if (this.pendingMemory) {
      parts.push(`[Current step]\n${this.pendingMemory}`);
    }
    return parts.join('\n\n');
  }

  /**
   * Prune screenshots from messages — for use as transformContext hook.
   *
   * Keeps last N screenshots, replaces older ones with text placeholders.
   * This only affects the LLM input, not the Agent's internal message history.
   */
  pruneScreenshots<T>(messages: T[]): T[] {
    // Find all messages with image content
    const imageIndices: number[] = [];
    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i] as any;
      if (hasImageContent(msg.content)) {
        imageIndices.push(i);
      }
    }

    // If we have fewer images than the keep count, no pruning needed
    if (imageIndices.length <= this.screenshotKeepCount) {
      return this.applyTokenHardLimit(messages);
    }

    // Clone messages array and replace old screenshots
    const pruned = messages.map((msg, idx) => {
      if (!imageIndices.includes(idx)) return msg;

      // Keep the most recent N screenshots
      const imageRank = imageIndices.indexOf(idx);
      const keepFrom = imageIndices.length - this.screenshotKeepCount;
      if (imageRank >= keepFrom) return msg;

      // Replace image content with text placeholder
      return {
        ...msg,
        content: replaceImageContent((msg as any).content, `[Screenshot removed - Step ${imageRank + 1}]`),
      };
    });

    return this.applyTokenHardLimit(pruned);
  }

  /**
   * Token hard limit fallback — estimate total tokens and force-remove
   * oldest images if exceeding contextWindow * 0.9.
   */
  private applyTokenHardLimit<T>(messages: T[]): T[] {
    const MAX_CONTEXT_TOKENS = 128_000; // conservative default
    const TOKEN_THRESHOLD = MAX_CONTEXT_TOKENS * 0.9;
    const TOKENS_PER_IMAGE = 800;

    let totalTokens = 0;
    const imagePositions: number[] = [];

    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i] as any;
      if (!msg.content) continue;

      if (Array.isArray(msg.content)) {
        for (const c of msg.content) {
          if (c.type === 'image') {
            totalTokens += TOKENS_PER_IMAGE;
            imagePositions.push(i);
          } else if (c.type === 'text' && c.text) {
            totalTokens += Math.ceil(c.text.length / 3);
          }
        }
      } else if (typeof msg.content === 'string') {
        totalTokens += Math.ceil(msg.content.length / 3);
      }
    }

    if (totalTokens <= TOKEN_THRESHOLD) {
      return messages;
    }

    // Force-remove images from oldest messages until under threshold
    logDebug(`Token hard limit: estimated ${totalTokens} tokens, threshold ${TOKEN_THRESHOLD}, removing oldest images`);
    const result = [...messages];
    for (const idx of imagePositions) {
      if (totalTokens <= TOKEN_THRESHOLD) break;
      const msg = result[idx] as any;
      if (hasImageContent(msg.content)) {
        result[idx] = {
          ...msg,
          content: replaceImageContent(msg.content, '[Screenshot removed - token limit]'),
        } as T;
        totalTokens -= TOKENS_PER_IMAGE;
      }
    }

    return result;
  }

  /**
   * Compress recent memory into summary via LLM call.
   */
  private async compressRecent(): Promise<void> {
    try {
      logDebug(`Compressing recent memory (${this.recentMemory.length} chars)`);

      const summary = await this.summarize(this.recentMemory);

      if (this.summaryMemory) {
        this.summaryMemory += '\n' + summary;
      } else {
        this.summaryMemory = summary;
      }
      this.recentMemory = '';

      // Check if summary also exceeds budget
      if (this.summaryMemory.length > this.summaryBudget) {
        await this.compressSummary();
      }
    } catch (err) {
      logError(`Memory compression failed: ${err instanceof Error ? err.message : String(err)}`);
      // On failure, keep recent memory as-is rather than losing data
    }
  }

  /**
   * Second-level compression: summarize the summary.
   */
  private async compressSummary(): Promise<void> {
    try {
      logDebug(`Compressing summary memory (${this.summaryMemory.length} chars)`);
      const summary = await this.summarize(this.summaryMemory);
      this.summaryMemory = summary;
    } catch (err) {
      logError(`Summary compression failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /**
   * Call the memory model to generate a summary.
   */
  private async summarize(text: string): Promise<string> {
    const result: AssistantMessage = await complete(this.memoryModel, {
      systemPrompt: MEMORY_SUMMARIZATION_PROMPT,
      messages: [
        { role: 'user' as const, content: text, timestamp: Date.now() },
      ],
    }, {
      apiKey: this.apiKey,
    });

    // Extract text from response
    const textContent = result.content.find(c => c.type === 'text');
    if (!textContent || textContent.type !== 'text') {
      throw new Error('Memory model returned no text content');
    }

    // Try to parse JSON response
    try {
      const parsed = JSON.parse(textContent.text);
      return parsed.summary || textContent.text;
    } catch {
      // If not JSON, use the raw text
      return textContent.text;
    }
  }
}

// --- Helpers ---

function hasImageContent(content: unknown): boolean {
  if (Array.isArray(content)) {
    return content.some(c => c && typeof c === 'object' && 'type' in c && c.type === 'image');
  }
  return false;
}

function replaceImageContent(content: unknown, placeholder: string): unknown {
  if (Array.isArray(content)) {
    return content.map(c => {
      if (c && typeof c === 'object' && 'type' in c && c.type === 'image') {
        return { type: 'text', text: placeholder };
      }
      return c;
    });
  }
  return content;
}
