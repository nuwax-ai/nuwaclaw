import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as readline from "node:readline";

export interface LocalSessionSummary {
  engine: "claude" | "codex";
  sessionId: string;
  cwd: string;
  updatedAt: string;
  title: string;
  filePath: string;
}

/**
 * Reads at most `maxLines` lines of a JSONL file and hands each parsed
 * object to `onLine`. Stops early once `onLine` returns true. Never loads
 * the whole file — session transcripts can be multiple MB.
 */
async function scanJsonlHead(
  filePath: string,
  maxLines: number,
  onLine: (obj: Record<string, unknown>) => boolean,
): Promise<void> {
  const stream = fs.createReadStream(filePath, { encoding: "utf-8" });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  let count = 0;
  try {
    for await (const line of rl) {
      if (!line.trim()) continue;
      count++;
      let obj: Record<string, unknown>;
      try {
        obj = JSON.parse(line);
      } catch {
        continue;
      }
      if (onLine(obj)) break;
      if (count >= maxLines) break;
    }
  } finally {
    rl.close();
    stream.close();
  }
}

function truncateTitle(text: string, max = 80): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  return oneLine.length > max ? `${oneLine.slice(0, max)}…` : oneLine;
}

async function readClaudeSessionSummary(
  filePath: string,
): Promise<LocalSessionSummary | null> {
  let sessionId: string | undefined;
  let cwd: string | undefined;
  let title: string | undefined;

  await scanJsonlHead(filePath, 40, (obj) => {
    if (!sessionId && typeof obj.sessionId === "string")
      sessionId = obj.sessionId;
    if (!cwd && typeof obj.cwd === "string") cwd = obj.cwd;
    if (
      !title &&
      obj.type === "user" &&
      typeof (obj.message as { content?: unknown } | undefined)?.content ===
        "string"
    ) {
      title = truncateTitle((obj.message as { content: string }).content);
    }
    return Boolean(sessionId && cwd && title);
  });

  if (!sessionId || !cwd) return null;
  const stat = fs.statSync(filePath);
  return {
    engine: "claude",
    sessionId,
    cwd,
    title: title ?? "(无标题)",
    updatedAt: stat.mtime.toISOString(),
    filePath,
  };
}

async function readCodexSessionSummary(
  filePath: string,
): Promise<LocalSessionSummary | null> {
  let sessionId: string | undefined;
  let cwd: string | undefined;

  await scanJsonlHead(filePath, 5, (obj) => {
    if (
      obj.type === "session_meta" &&
      obj.payload &&
      typeof obj.payload === "object"
    ) {
      const payload = obj.payload as Record<string, unknown>;
      // Newer codex versions write both `session_id` and `id` (same value);
      // sessions recorded before ~2026-07 only have `id`.
      if (typeof payload.session_id === "string")
        sessionId = payload.session_id;
      else if (typeof payload.id === "string") sessionId = payload.id;
      if (typeof payload.cwd === "string") cwd = payload.cwd;
      return true;
    }
    return false;
  });

  if (!sessionId || !cwd) return null;
  const stat = fs.statSync(filePath);
  return {
    engine: "codex",
    sessionId,
    cwd,
    title: "(codex 会话)",
    updatedAt: stat.mtime.toISOString(),
    filePath,
  };
}

function listFilesRecursive(
  root: string,
  matches: (name: string) => boolean,
  maxDepth: number,
): string[] {
  const results: string[] = [];
  function walk(dir: string, depth: number) {
    if (depth > maxDepth) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full, depth + 1);
      else if (matches(entry.name)) results.push(full);
    }
  }
  if (fs.existsSync(root)) walk(root, 0);
  return results;
}

export async function listClaudeSessions(): Promise<LocalSessionSummary[]> {
  const root = path.join(os.homedir(), ".claude", "projects");
  const files = listFilesRecursive(root, (name) => name.endsWith(".jsonl"), 1);
  const summaries = await Promise.all(files.map(readClaudeSessionSummary));
  return summaries.filter((s): s is LocalSessionSummary => s !== null);
}

export async function listCodexSessions(): Promise<LocalSessionSummary[]> {
  const root = path.join(os.homedir(), ".codex", "sessions");
  const files = listFilesRecursive(
    root,
    (name) => name.startsWith("rollout-") && name.endsWith(".jsonl"),
    3,
  );
  const summaries = await Promise.all(files.map(readCodexSessionSummary));
  return summaries.filter((s): s is LocalSessionSummary => s !== null);
}

export interface ListSessionsOptions {
  /** Filter by engine. */
  engine?: "claude" | "codex";
  /** Fuzzy match against title or sessionId (case-insensitive). */
  search?: string;
  /** Only sessions updated within the last N days. */
  sinceDays?: number;
  /** Only sessions updated after this ISO date. */
  since?: string;
  /** Only sessions updated before this ISO date. */
  until?: string;
  /** Maximum results to return. */
  limit?: number;
}

function matchesSearch(s: LocalSessionSummary, search: string): boolean {
  const q = search.toLowerCase();
  return (
    s.sessionId.toLowerCase().includes(q) ||
    s.title.toLowerCase().includes(q) ||
    s.cwd.toLowerCase().includes(q)
  );
}

function withinDateRange(
  dateStr: string,
  opts: { since?: string; until?: string; sinceDays?: number },
): boolean {
  const date = new Date(dateStr).getTime();
  if (opts.since) {
    const since = new Date(opts.since).getTime();
    if (isNaN(since)) return true; // ignore invalid
    if (date < since) return false;
  }
  if (opts.until) {
    const until = new Date(opts.until).getTime();
    if (isNaN(until)) return true;
    if (date > until) return false;
  }
  if (opts.sinceDays) {
    const cutoff = Date.now() - opts.sinceDays * 86400_000;
    if (date < cutoff) return false;
  }
  return true;
}

export async function listLocalSessions(
  engine?: "claude" | "codex",
): Promise<LocalSessionSummary[]>;

export async function listLocalSessions(
  options?: ListSessionsOptions,
): Promise<LocalSessionSummary[]>;

export async function listLocalSessions(
  arg?: "claude" | "codex" | ListSessionsOptions,
): Promise<LocalSessionSummary[]> {
  let opts: ListSessionsOptions;
  if (typeof arg === "string" || arg === undefined) {
    opts = arg ? { engine: arg } : {};
  } else {
    opts = arg ?? {};
  }

  const lists = await Promise.all([
    opts.engine === "codex" ? [] : listClaudeSessions(),
    opts.engine === "claude" ? [] : listCodexSessions(),
  ]);

  let sessions = lists
    .flat()
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  if (opts.search) {
    sessions = sessions.filter((s) => matchesSearch(s, opts.search!));
  }

  sessions = sessions.filter((s) =>
    withinDateRange(s.updatedAt, {
      since: opts.since,
      until: opts.until,
      sinceDays: opts.sinceDays,
    }),
  );

  if (opts.limit && opts.limit > 0 && sessions.length > opts.limit) {
    sessions = sessions.slice(0, opts.limit);
  }

  return sessions;
}
