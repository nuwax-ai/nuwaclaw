import * as path from "node:path";
import * as readline from "node:readline/promises";
import { AGENT_METHODS } from "@agentclientprotocol/sdk";
import pc from "picocolors";
import { getEngine } from "../core/engines/registry.js";
import { buildEngineEnv, type EngineKind } from "../core/env/inheritEnv.js";
import { withEngineConnection } from "../core/acp/connection.js";
import { applySessionMode } from "../core/acp/sessionMode.js";
import {
  wrapNewSession,
  wrapResumedSession,
} from "../core/acp/sessionHandle.js";
import { resolveResumeTarget } from "./resolveResumeTarget.js";
import { buildGuiAgentMcpServer } from "../core/mcp/guiServer.js";
import { listLocalSessions } from "../core/sessions/discovery.js";
import type { PermissionMode } from "../core/permissions/policy.js";
import type { McpServer } from "@agentclientprotocol/sdk";

export interface ChatCommandOptions {
  engine: string;
  cwd?: string;
  print?: string;
  yolo?: boolean;
  mode?: string;
  resume?: true | string;
  guiMcp?: boolean;
  guiMcpPath?: string;
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  refSession?: string;
}

/**
 * Resolves `--ref-session <engine>:<sessionId>` into a one-time reminder
 * text prepended to the *first* prompt only. This is deliberately not a
 * true cross-engine resume (ACP session/load is engine-native and doesn't
 * accept another engine's history) — instead it points the model at
 * `nuwaclaw sessions summary`, which it can run with its own Bash tool to
 * pull the other session's content on demand, the same pattern tutti uses
 * for cross-provider context (mention -> skill -> agent-invoked CLI read),
 * rather than eagerly dumping the whole transcript into the prompt.
 */
export async function resolveRefSessionReminder(
  refSession: string | undefined,
): Promise<string> {
  if (!refSession) return "";
  const sep = refSession.indexOf(":");
  if (sep === -1) {
    throw new Error(
      `--ref-session 格式应为 <engine>:<sessionId>，如 claude:xxxxxxxx`,
    );
  }
  const refEngine = refSession.slice(0, sep);
  const refSessionId = refSession.slice(sep + 1);
  if (refEngine !== "claude" && refEngine !== "codex") {
    throw new Error(`--ref-session 的引擎部分必须是 claude 或 codex`);
  }
  const refSessions = await listLocalSessions(refEngine);
  const refMatch = refSessions.find((s) => s.sessionId === refSessionId);
  if (!refMatch) {
    throw new Error(
      `未在本地 ${refEngine} 会话历史中找到 sessionId "${refSessionId}"（--ref-session）。`,
    );
  }
  return (
    `<system-reminder>关联历史会话 [${refEngine}:${refSessionId}] cwd=${refMatch.cwd}；` +
    `如需其中的上下文，运行 \`nuwaclaw sessions summary --engine ${refEngine} --session-id ${refSessionId} --json\` 查看，` +
    `可加 --limit 只看最近 N 条；不要假设内容，需要时再查。</system-reminder>\n\n`
  );
}

export async function chatCommand(options: ChatCommandOptions): Promise<void> {
  // Mutually exclusive: --ref-session's reminder is only meaningful on a
  // brand-new session's opening turn. A resumed session already has real
  // history, so silently prepending a reminder about a *different* session
  // into its next turn would pollute that history with something unrelated
  // to what's actually being continued — fail fast instead of guessing.
  if (options.resume && options.refSession) {
    console.error(
      pc.red(
        "[nuwaclaw] --resume 与 --ref-session 不能同时使用：--ref-session 只在新建会话的首轮生效，与续接历史会话的语义冲突。",
      ),
    );
    process.exitCode = 1;
    return;
  }

  const engineId = options.engine as EngineKind;
  const engine = getEngine(engineId);

  // Resolved before spawning the engine: it only reads local session-history
  // files, so a cancelled picker or a bad --resume id costs nothing.
  let resumeTarget;
  try {
    resumeTarget = await resolveResumeTarget(options.resume, engineId);
  } catch (err) {
    console.error(pc.red(`[nuwaclaw] ${(err as Error).message}`));
    process.exitCode = 1;
    return;
  }

  let refSessionReminder: string;
  try {
    refSessionReminder = await resolveRefSessionReminder(options.refSession);
  } catch (err) {
    console.error(pc.red(`[nuwaclaw] ${(err as Error).message}`));
    process.exitCode = 1;
    return;
  }
  // A resumed session must be loaded with the cwd it was originally created
  // with — session/load correctness depends on it — so it overrides --cwd.
  const cwd = resumeTarget
    ? resumeTarget.cwd
    : path.resolve(options.cwd ?? process.cwd());

  let resolved;
  try {
    resolved = await engine.resolve();
  } catch (err) {
    console.error(pc.red(`[nuwaclaw] ${(err as Error).message}`));
    process.exitCode = 1;
    return;
  }

  // opt-in, additive-only: appended to session/new|load's mcpServers, never
  // replaces whatever the engine already loads from the user's own config.
  let guiMcpServer: McpServer | undefined;
  if (options.guiMcp) {
    try {
      guiMcpServer = buildGuiAgentMcpServer({
        devPath: options.guiMcpPath,
        apiKey: options.apiKey,
      });
    } catch (err) {
      console.error(pc.red(`[nuwaclaw] ${(err as Error).message}`));
      process.exitCode = 1;
      return;
    }
  }

  const overlay =
    options.apiKey || options.baseUrl || options.model
      ? {
          apiKey: options.apiKey,
          baseUrl: options.baseUrl,
          model: options.model,
        }
      : undefined;
  const env = {
    ...buildEngineEnv(engineId, overlay),
    ...resolved.envOverlay,
  };

  const permissionMode: PermissionMode = options.yolo
    ? "yolo"
    : process.stdin.isTTY
      ? "interactive"
      : "deny-noninteractive";

  let wroteAny = false;
  const handlers = {
    permissionMode,
    onAgentText: (text: string) => {
      process.stdout.write(text);
      wroteAny = true;
    },
  };

  await withEngineConnection(
    { command: resolved.command, args: resolved.args, env, cwd },
    handlers,
    async (ctx) => {
      const mcpServers = guiMcpServer ? [guiMcpServer] : [];
      const session = resumeTarget
        ? wrapResumedSession(
            ctx,
            resumeTarget.sessionId,
            (
              await ctx.request(AGENT_METHODS.session_load, {
                sessionId: resumeTarget.sessionId,
                cwd,
                mcpServers,
              })
            ).modes,
          )
        : wrapNewSession(
            await (
              guiMcpServer
                ? ctx.buildSession(cwd).withMcpServer(guiMcpServer)
                : ctx.buildSession(cwd)
            ).start(),
          );
      await applySessionMode(ctx, session, options.mode, Boolean(options.yolo));

      if (options.print) {
        await session.prompt(refSessionReminder + options.print);
        if (wroteAny) process.stdout.write("\n");
        return;
      }

      console.log(
        pc.dim(
          `已连接 ${engineId} 引擎（session ${session.sessionId}${resumeTarget ? "，已续接历史" : ""}）。输入 /exit 退出。`,
        ),
      );
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });
      let stdinClosed = false;
      rl.on("close", () => {
        stdinClosed = true;
      });
      try {
        while (!stdinClosed) {
          let line: string;
          try {
            line = await rl.question(pc.cyan("> "));
          } catch {
            // stdin ended (EOF / Ctrl+D / piped input exhausted) while awaiting
            // input — treat as a clean exit instead of an unhandled crash.
            break;
          }
          const trimmed = line.trim();
          if (trimmed === "/exit" || trimmed === "/quit") break;
          if (!trimmed) continue;
          wroteAny = false;
          await session.prompt(refSessionReminder + line);
          refSessionReminder = ""; // only the first turn carries the reminder
          if (wroteAny) process.stdout.write("\n");
        }
      } finally {
        rl.close();
      }
    },
  );
}
