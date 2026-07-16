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
import type { PermissionMode } from "../core/permissions/policy.js";
import {
  buildContextDigest,
  buildContextHandoff,
  resolveContextRef,
  shellQuote,
} from "../core/context/context.js";

export interface ChatCommandOptions {
  engine: string;
  cwd?: string;
  print?: string;
  yolo?: boolean;
  mode?: string;
  resume?: true | string;
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  refSession?: string;
  handoff?: string;
  autoDigest?: boolean;
}

/**
 * Resolves `--ref-session <engine>:<sessionId>` into context prepended to
 * the *first* prompt only.
 *
 * When `autoDigest` is true (via `--auto-digest`), eagerly injects the
 * structured digest of the referenced session. This avoids the extra tool
 * call latency of the agent having to invoke `nuwa-cli context digest`.
 *
 * When `autoDigest` is false (default), it emits a lightweight reminder
 * telling the agent to pull context on demand — avoids bloating the first
 * prompt with potentially large transcripts.
 */
export async function resolveRefSessionReminder(
  refSession: string | undefined,
  autoDigest?: boolean,
): Promise<string> {
  if (!refSession) return "";
  const refMatch = await resolveContextRef(refSession);
  const quotedRef = shellQuote(`${refMatch.engine}:${refMatch.sessionId}`);

  if (autoDigest) {
    const digest = await buildContextDigest(refSession);
    return (
      `<system-reminder>以下是关联历史会话 [${refMatch.engine}:${refMatch.sessionId}] 的自动摘要。` +
      `cwd=${refMatch.cwd}，消息数=${digest.messageCount}。` +
      `如需更多上下文，再运行 \`nuwa-cli context read --ref ${quotedRef} --limit 40 --json\`。\n` +
      `${JSON.stringify(digest)}\n` +
      `</system-reminder>\n\n`
    );
  }

  return (
    `<system-reminder>关联历史会话 [${refMatch.engine}:${refMatch.sessionId}] cwd=${refMatch.cwd}；` +
    `如需其中的上下文，先运行 \`nuwa-cli context digest --ref ${quotedRef} --json\` 查看摘要；` +
    `若仍不够，再运行 \`nuwa-cli context read --ref ${quotedRef} --limit 40 --json\` 查看最近消息；` +
    `不要假设未读取的内容，需要时再查。</system-reminder>\n\n`
  );
}

export async function resolveHandoffReminder(
  handoff: string | undefined,
): Promise<string> {
  if (!handoff) return "";
  const pack = await buildContextHandoff(handoff);
  return (
    `<system-reminder>以下是来自本地历史会话的结构化交接包。` +
    `目标 Agent 当前仍是一个新的 ACP 会话；这不是原生续接。` +
    `请把它当作接手工作的背景，必要时再运行 \`nuwa-cli context read --ref ${shellQuote(`${pack.source.engine}:${pack.source.sessionId}`)} --limit 40 --json\` 读取更多上下文。\n` +
    `${JSON.stringify(pack)}\n` +
    `</system-reminder>\n\n`
  );
}

export async function chatCommand(options: ChatCommandOptions): Promise<void> {
  // These are three different semantics: native same-engine ACP resume,
  // read-only context reference, and structured handoff into a new ACP
  // session. Combining them would make the first turn ambiguous.
  const contextModes = [
    options.resume ? "--resume" : "",
    options.refSession ? "--ref-session" : "",
    options.handoff ? "--handoff" : "",
  ].filter(Boolean);
  if (contextModes.length > 1) {
    console.error(
      pc.red(
        `[nuwa-cli] --resume、--ref-session、--handoff 不能同时使用（收到：${contextModes.join(", ")}）。`,
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
    console.error(pc.red(`[nuwa-cli] ${(err as Error).message}`));
    process.exitCode = 1;
    return;
  }

  let refSessionReminder: string;
  try {
    refSessionReminder = await resolveRefSessionReminder(
      options.refSession,
      options.autoDigest,
    );
  } catch (err) {
    console.error(pc.red(`[nuwa-cli] ${(err as Error).message}`));
    process.exitCode = 1;
    return;
  }

  let handoffReminder: string;
  try {
    handoffReminder = await resolveHandoffReminder(options.handoff);
  } catch (err) {
    console.error(pc.red(`[nuwa-cli] ${(err as Error).message}`));
    process.exitCode = 1;
    return;
  }
  let firstTurnPrefix = refSessionReminder + handoffReminder;
  // A resumed session must be loaded with the cwd it was originally created
  // with — session/load correctness depends on it — so it overrides --cwd.
  const cwd = resumeTarget
    ? resumeTarget.cwd
    : path.resolve(options.cwd ?? process.cwd());

  let resolved;
  try {
    resolved = await engine.resolve();
  } catch (err) {
    console.error(pc.red(`[nuwa-cli] ${(err as Error).message}`));
    process.exitCode = 1;
    return;
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
      const session = resumeTarget
        ? wrapResumedSession(
            ctx,
            resumeTarget.sessionId,
            (
              await ctx.request(AGENT_METHODS.session_load, {
                sessionId: resumeTarget.sessionId,
                cwd,
                mcpServers: [],
              })
            ).modes,
          )
        : wrapNewSession(await ctx.buildSession(cwd).start());
      await applySessionMode(ctx, session, options.mode, Boolean(options.yolo));

      if (options.print) {
        await session.prompt(firstTurnPrefix + options.print);
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
          await session.prompt(firstTurnPrefix + line);
          firstTurnPrefix = ""; // only the first turn carries context routing
          if (wroteAny) process.stdout.write("\n");
        }
      } finally {
        rl.close();
      }
    },
  );
}
