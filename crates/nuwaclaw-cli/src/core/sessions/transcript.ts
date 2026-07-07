import * as fs from "node:fs";
import * as readline from "node:readline";

export interface NormalizedMessage {
  role: "user" | "assistant";
  text: string;
  toolCalls?: string[];
}

export interface TranscriptOptions {
  /** Keep only the most recent N normalized messages. */
  limit?: number;
  /** Output order; default "asc" (chronological, oldest first). */
  order?: "asc" | "desc";
}

function applyOptions(
  messages: NormalizedMessage[],
  options: TranscriptOptions,
): { messages: NormalizedMessage[]; hasMore: boolean } {
  const limited =
    options.limit && options.limit > 0 && messages.length > options.limit
      ? messages.slice(-options.limit)
      : messages;
  const hasMore = limited.length < messages.length;
  const ordered = options.order === "desc" ? [...limited].reverse() : limited;
  return { messages: ordered, hasMore };
}

async function forEachJsonlLine(
  filePath: string,
  onLine: (obj: Record<string, unknown>) => void,
): Promise<void> {
  const stream = fs.createReadStream(filePath, { encoding: "utf-8" });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  try {
    for await (const line of rl) {
      if (!line.trim()) continue;
      let obj: Record<string, unknown>;
      try {
        obj = JSON.parse(line);
      } catch {
        continue;
      }
      onLine(obj);
    }
  } finally {
    rl.close();
    stream.close();
  }
}

type ContentBlock = Record<string, unknown>;

function textOfBlocks(blocks: ContentBlock[], blockType: string): string {
  return blocks
    .filter((b) => b.type === blockType && typeof b.text === "string")
    .map((b) => b.text as string)
    .join("\n")
    .trim();
}

/**
 * Full transcript parse for claude-code's `~/.claude/projects/**\/*.jsonl`
 * format. Unlike discovery.ts's header-only scan, this reads every line —
 * only call it for a session a user explicitly wants the content of.
 *
 * Deliberately drops `thinking` blocks and raw `tool_result` content (can be
 * arbitrarily large/binary) to keep the output a compact, cross-engine-
 * readable digest rather than a byte-for-byte replay.
 */
export async function parseClaudeTranscript(
  filePath: string,
  options: TranscriptOptions = {},
): Promise<{ messages: NormalizedMessage[]; hasMore: boolean }> {
  const messages: NormalizedMessage[] = [];

  await forEachJsonlLine(filePath, (obj) => {
    const type = obj.type;
    const message = obj.message as
      | { role?: string; content?: unknown }
      | undefined;
    if (!message) return;

    if (type === "user") {
      const content = message.content;
      if (typeof content === "string") {
        const text = content.trim();
        if (text) messages.push({ role: "user", text });
      } else if (Array.isArray(content)) {
        const text = textOfBlocks(content as ContentBlock[], "text");
        if (text) messages.push({ role: "user", text });
      }
      return;
    }

    if (type === "assistant") {
      const content = message.content;
      if (!Array.isArray(content)) return;
      const blocks = content as ContentBlock[];
      const text = textOfBlocks(blocks, "text");
      const toolCalls = blocks
        .filter((b) => b.type === "tool_use" && typeof b.name === "string")
        .map((b) => b.name as string);
      if (text || toolCalls.length > 0) {
        messages.push({
          role: "assistant",
          text,
          toolCalls: toolCalls.length ? toolCalls : undefined,
        });
      }
    }
  });

  return applyOptions(messages, options);
}

/**
 * Full transcript parse for codex's `~/.codex/sessions/**\/rollout-*.jsonl`
 * format. Only `response_item` lines carry conversation content; `message`
 * items hold user/assistant/developer turns (developer = injected system
 * boilerplate, dropped to mirror claude's jsonl which has no such line),
 * and tool invocations are separate `function_call`/`custom_tool_call`
 * items rather than nested in the message like claude's `tool_use` blocks.
 */
export async function parseCodexTranscript(
  filePath: string,
  options: TranscriptOptions = {},
): Promise<{ messages: NormalizedMessage[]; hasMore: boolean }> {
  const messages: NormalizedMessage[] = [];

  await forEachJsonlLine(filePath, (obj) => {
    if (obj.type !== "response_item") return;
    const payload = obj.payload as Record<string, unknown> | undefined;
    if (!payload) return;

    if (payload.type === "message") {
      const role = payload.role;
      if (role !== "user" && role !== "assistant") return; // drops "developer"
      const content = payload.content;
      if (!Array.isArray(content)) return;
      const text = (content as ContentBlock[])
        .filter((b) => typeof b.text === "string")
        .map((b) => b.text as string)
        .join("\n")
        .trim();
      if (text) messages.push({ role, text });
      return;
    }

    if (
      payload.type === "function_call" ||
      payload.type === "custom_tool_call"
    ) {
      const name = payload.name;
      if (typeof name === "string") {
        messages.push({ role: "assistant", text: "", toolCalls: [name] });
      }
    }
  });

  return applyOptions(messages, options);
}

export async function parseTranscript(
  engine: "claude" | "codex",
  filePath: string,
  options: TranscriptOptions = {},
): Promise<{ messages: NormalizedMessage[]; hasMore: boolean }> {
  return engine === "claude"
    ? parseClaudeTranscript(filePath, options)
    : parseCodexTranscript(filePath, options);
}
