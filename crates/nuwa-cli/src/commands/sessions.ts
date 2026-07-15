import pc from "picocolors";
import type { Command } from "commander";
import { listLocalSessions } from "../core/sessions/discovery.js";
import { parseTranscript } from "../core/sessions/transcript.js";

export interface SessionsCommandOptions {
  engine?: string;
}

export async function sessionsCommand(
  options: SessionsCommandOptions,
): Promise<void> {
  const engine =
    options.engine === "claude" || options.engine === "codex"
      ? options.engine
      : undefined;
  const sessions = await listLocalSessions(engine);

  if (sessions.length === 0) {
    console.log(pc.dim("未找到本地会话历史。"));
    return;
  }

  console.log(pc.dim("云端会话列表：暂不可用（后端接口待定）\n"));
  for (const s of sessions) {
    console.log(
      `${pc.cyan(s.engine.padEnd(6))} ${pc.dim(s.updatedAt.slice(0, 16).replace("T", " "))}  ${s.title}`,
    );
    console.log(`       ${pc.dim(s.sessionId)}  ${pc.dim(s.cwd)}`);
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
  const { messages, hasMore } = await parseTranscript(engine, match.filePath, {
    limit: limit && limit > 0 ? limit : undefined,
  });

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
