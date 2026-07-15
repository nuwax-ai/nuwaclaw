import {
  listLocalSessions,
  type LocalSessionSummary,
} from "../sessions/discovery.js";
import {
  parseTranscript,
  type NormalizedMessage,
} from "../sessions/transcript.js";

export type ContextEngine = "claude" | "codex";

export interface ContextRef {
  kind: "local-session";
  engine: ContextEngine;
  sessionId: string;
  cwd: string;
  updatedAt: string;
  title: string;
  transcriptPath: string;
}

export interface ContextReadResult {
  source: ContextRef;
  messages: NormalizedMessage[];
  hasMore: boolean;
}

export interface ContextDigest {
  source: ContextRef;
  messageCount: number;
  latestUserMessage?: string;
  latestAssistantMessage?: string;
  toolCalls: string[];
  changedFiles: string[];
  decisions: string[];
  openTasks: string[];
  risks: string[];
  recentMessages: NormalizedMessage[];
  hasMore: boolean;
}

export interface ContextHandoff {
  source: ContextRef;
  goal?: string;
  decisions: string[];
  openTasks: string[];
  changedFiles: string[];
  risks: string[];
  recentMessages: NormalizedMessage[];
  hasMore: boolean;
}

const DEFAULT_DIGEST_LIMIT = 80;
const DEFAULT_HANDOFF_RECENT_LIMIT = 12;
const MAX_ITEMS = 10;

export function parseContextRef(value: string): {
  engine: ContextEngine;
  sessionId: string;
} {
  const sep = value.indexOf(":");
  if (sep === -1) {
    throw new Error(
      `context ref 格式应为 <engine>:<sessionId>，如 claude:xxxxxxxx`,
    );
  }
  const engine = value.slice(0, sep);
  const sessionId = value.slice(sep + 1);
  if (engine !== "claude" && engine !== "codex") {
    throw new Error(`context ref 的引擎部分必须是 claude 或 codex`);
  }
  if (!sessionId) {
    throw new Error(`context ref 缺少 sessionId`);
  }
  return { engine, sessionId };
}

function toContextRef(summary: LocalSessionSummary): ContextRef {
  return {
    kind: "local-session",
    engine: summary.engine,
    sessionId: summary.sessionId,
    cwd: summary.cwd,
    updatedAt: summary.updatedAt,
    title: summary.title,
    transcriptPath: summary.filePath,
  };
}

export async function resolveContextRef(ref: string): Promise<ContextRef> {
  const { engine, sessionId } = parseContextRef(ref);
  const sessions = await listLocalSessions(engine);
  const match = sessions.find((s) => s.sessionId === sessionId);
  if (!match) {
    throw new Error(
      `未在本地 ${engine} 会话历史中找到 sessionId "${sessionId}"。`,
    );
  }
  return toContextRef(match);
}

export async function readContext(
  ref: string,
  options: { limit?: number } = {},
): Promise<ContextReadResult> {
  const source = await resolveContextRef(ref);
  const { messages, hasMore } = await parseTranscript(
    source.engine,
    source.transcriptPath,
    { limit: options.limit },
  );
  return { source, messages, hasMore };
}

function truncate(text: string, max = 220): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  return oneLine.length > max ? `${oneLine.slice(0, max)}...` : oneLine;
}

function uniquePush(list: string[], value: string): void {
  const item = truncate(value);
  if (!item) return;
  if (!list.includes(item)) list.push(item);
}

function extractMatchingLines(
  messages: NormalizedMessage[],
  patterns: RegExp[],
): string[] {
  const results: string[] = [];
  for (const message of messages) {
    for (const rawLine of message.text.split(/\n+/)) {
      const line = rawLine.trim();
      if (!line) continue;
      if (patterns.some((pattern) => pattern.test(line))) {
        uniquePush(results, line);
      }
      if (results.length >= MAX_ITEMS) return results;
    }
  }
  return results;
}

function extractFilePaths(messages: NormalizedMessage[]): string[] {
  const results: string[] = [];
  const filePattern =
    /(?:^|\s)([~./A-Za-z0-9_-][A-Za-z0-9_./~@:+-]*\.(?:ts|tsx|js|jsx|mjs|cjs|json|md|mdx|go|rs|py|java|kt|swift|css|scss|html|yml|yaml|toml|lock|sql|sh|txt|log|env|ini|conf|xml|vue|svelte|c|cc|cpp|h|hpp))(?:\b|$)/g;
  for (const message of messages) {
    for (const match of message.text.matchAll(filePattern)) {
      uniquePush(results, match[1]);
      if (results.length >= MAX_ITEMS) return results;
    }
  }
  return results;
}

function uniqueToolCalls(messages: NormalizedMessage[]): string[] {
  const results: string[] = [];
  for (const message of messages) {
    for (const tool of message.toolCalls ?? []) uniquePush(results, tool);
    if (results.length >= MAX_ITEMS) return results;
  }
  return results;
}

function lastTextByRole(
  messages: NormalizedMessage[],
  role: "user" | "assistant",
): string | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message.role === role && message.text.trim()) {
      return truncate(message.text);
    }
  }
  return undefined;
}

export async function buildContextDigest(
  ref: string,
  options: { limit?: number; recentLimit?: number } = {},
): Promise<ContextDigest> {
  const read = await readContext(ref, {
    limit: options.limit ?? DEFAULT_DIGEST_LIMIT,
  });
  const messages = read.messages;
  const recentLimit = options.recentLimit ?? DEFAULT_HANDOFF_RECENT_LIMIT;
  return {
    source: read.source,
    messageCount: messages.length,
    latestUserMessage: lastTextByRole(messages, "user"),
    latestAssistantMessage: lastTextByRole(messages, "assistant"),
    toolCalls: uniqueToolCalls(messages),
    changedFiles: extractFilePaths(messages),
    decisions: extractMatchingLines(messages, [
      /决定|结论|确定|采用|选型|decision|decided|settled/i,
    ]),
    openTasks: extractMatchingLines(messages, [
      /TODO|待办|下一步|还需|需要继续|未完成|后续|open task|next step|remaining/i,
    ]),
    risks: extractMatchingLines(messages, [
      /风险|注意|限制|阻塞|失败|错误|坑|risk|caveat|blocked|failure|error/i,
    ]),
    recentMessages: messages.slice(-recentLimit),
    hasMore: read.hasMore,
  };
}

export async function buildContextHandoff(
  ref: string,
  options: { limit?: number; recentLimit?: number } = {},
): Promise<ContextHandoff> {
  const digest = await buildContextDigest(ref, options);
  return {
    source: digest.source,
    goal: digest.latestUserMessage,
    decisions: digest.decisions,
    openTasks: digest.openTasks,
    changedFiles: digest.changedFiles,
    risks: digest.risks,
    recentMessages: digest.recentMessages,
    hasMore: digest.hasMore,
  };
}

export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}
