import pc from "picocolors";
import type { Command } from "commander";
import {
  listLocalSessions,
  type LocalSessionSummary,
} from "../core/sessions/discovery.js";
import { parseTranscript } from "../core/sessions/transcript.js";

export interface SessionsCommandOptions {
  engine?: string;
  search?: string;
  days?: string;
  since?: string;
  until?: string;
  limit?: string;
  verbose?: boolean;
  json?: boolean;
}

export async function sessionsCommand(
  options: SessionsCommandOptions,
): Promise<void> {
  const engine =
    options.engine === "claude" || options.engine === "codex"
      ? options.engine
      : undefined;

  const sessions = await listLocalSessions({
    engine,
    search: options.search,
    sinceDays: options.days ? Number(options.days) : undefined,
    since: options.since,
    until: options.until,
    limit: options.limit ? Number(options.limit) : undefined,
  });

  if (sessions.length === 0) {
    if (options.search) {
      console.log(pc.dim(`未找到匹配 "${options.search}" 的会话。`));
    } else {
      console.log(pc.dim("未找到本地会话历史。"));
    }
    return;
  }

  // JSON output mode
  if (options.json) {
    console.log(JSON.stringify(sessions, null, 2));
    return;
  }

  if (options.verbose) {
    // verbose: show more detail with message counts
    for (const s of sessions) {
      console.log(
        `${pc.cyan(s.engine.padEnd(6))} ${pc.dim(s.updatedAt.slice(0, 16).replace("T", " "))}  ${s.title}`,
      );
      console.log(`       ${pc.dim(s.sessionId)}`);
      console.log(`       ${pc.dim(s.cwd)}`);
    }
  } else {
    // compact: first line only
    for (const s of sessions) {
      console.log(
        `${pc.cyan(s.engine.padEnd(6))} ${pc.dim(s.updatedAt.slice(0, 16).replace("T", " "))}  ${s.title}`,
      );
      console.log(`       ${pc.dim(s.sessionId)}  ${pc.dim(s.cwd)}`);
    }
  }

  console.log(
    pc.dim(
      `\n共 ${sessions.length} 个本地会话。用 \`nuwa-cli chat --resume\` 续接。`,
    ),
  );
}

export interface SessionsSummaryCommandOptions {
  engine?: string;
  sessionId?: string;
  limit?: string;
  offset?: string;
  format?: string;
  reverse?: boolean;
}

/**
 * Prints a compact, engine-agnostic JSON digest of one local session's full
 * transcript. Meant to be invoked by an *agent's own shell tool* (not a
 * human) — this is how `chat --ref-session` lets a session on one engine
 * read another engine's history on demand, instead of eagerly dumping it
 * into the first prompt.
 *
 * Takes the raw (unmerged) options plus the commander Command instance —
 * `--engine` is also declared on the parent `sessions` command (for the
 * list action), so this reads the effective value via `optsWithGlobals()`
 * and validates it itself rather than using commander's `requiredOption`,
 * which only sees a subcommand's own local options.
 */
export async function sessionsSummaryCommand(
  _options: SessionsSummaryCommandOptions,
  command: Command,
): Promise<void> {
  const merged = command.optsWithGlobals() as SessionsSummaryCommandOptions;
  const engine =
    merged.engine === "claude" || merged.engine === "codex"
      ? merged.engine
      : undefined;
  if (!engine) {
    console.error(pc.red("[nuwa-cli] --engine 必须是 claude 或 codex"));
    process.exitCode = 1;
    return;
  }

  const sessionId = merged.sessionId;
  if (!sessionId) {
    console.error(pc.red("[nuwa-cli] 缺少 --session-id"));
    process.exitCode = 1;
    return;
  }

  const sessions = await listLocalSessions(engine);
  const match = sessions.find((s) => s.sessionId === sessionId);
  if (!match) {
    console.error(
      pc.red(
        `[nuwa-cli] 未在本地 ${engine} 会话历史中找到 sessionId "${sessionId}"。`,
      ),
    );
    process.exitCode = 1;
    return;
  }

  const limit = merged.limit ? Number(merged.limit) : undefined;
  const offset = merged.offset ? Number(merged.offset) : undefined;

  const { messages, hasMore } = await parseTranscript(engine, match.filePath, {
    limit,
    offset,
    order: merged.reverse ? "desc" : "asc",
  });

  // Support jsonl output
  if (merged.format === "jsonl") {
    for (const msg of messages) {
      console.log(JSON.stringify({ engine, sessionId, ...msg }));
    }
    return;
  }

  console.log(
    JSON.stringify({
      engine,
      sessionId: match.sessionId,
      cwd: match.cwd,
      title: match.title,
      messages,
      hasMore,
    }),
  );
}
