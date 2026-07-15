import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { Writable, Readable } from "node:stream";
import {
  client,
  ndJsonStream,
  AGENT_METHODS,
  CLIENT_METHODS,
  PROTOCOL_VERSION,
  type ClientContext,
  type RequestPermissionRequest,
  type RequestPermissionResponse,
  type SessionNotification,
} from "@agentclientprotocol/sdk";
import type { PermissionMode } from "../permissions/policy.js";
import { decidePermission } from "../permissions/policy.js";
import { CLI_VERSION } from "../version.js";

export interface SpawnTarget {
  command: string;
  args: string[];
  env: NodeJS.ProcessEnv;
  cwd: string;
}

export interface EngineSessionHandlers {
  onAgentText: (text: string) => void;
  onAgentThought?: (text: string) => void;
  /** Fired for every session/update notification, in addition to the text-specific handlers above — used by `serve` to forward the full update over SSE. */
  onRawUpdate?: (notification: SessionNotification) => void;
  permissionMode: PermissionMode;
}

const STDERR_BUFFER_LIMIT = 8000;

/** Captures the last N bytes of the engine's stderr for error diagnostics, without ever printing it live (that would corrupt the chat UI). */
function captureStderr(proc: ChildProcessWithoutNullStreams): () => string {
  let buffer = "";
  proc.stderr.on("data", (chunk: Buffer) => {
    buffer += chunk.toString("utf-8");
    if (buffer.length > STDERR_BUFFER_LIMIT) {
      buffer = buffer.slice(buffer.length - STDERR_BUFFER_LIMIT);
    }
  });
  return () => buffer;
}

function routeSessionUpdate(
  notification: SessionNotification,
  handlers: EngineSessionHandlers,
): void {
  handlers.onRawUpdate?.(notification);
  const update = notification.update;
  switch (update.sessionUpdate) {
    case "agent_message_chunk":
      if (update.content.type === "text")
        handlers.onAgentText(update.content.text);
      break;
    case "agent_thought_chunk":
      if (update.content.type === "text") {
        handlers.onAgentThought?.(update.content.text);
      }
      break;
    default:
      break;
  }
}

/**
 * Spawns an ACP-speaking engine process and runs `op` with a connected
 * `ClientContext`. The connection (and the child process) is torn down when
 * `op` resolves, rejects, or throws — mirroring `ClientApp.connectWith`.
 *
 * If `signal` is provided and aborted, the engine child is killed (SIGTERM) so
 * a long-running `op` (e.g. an in-flight `session/prompt`) is interrupted
 * instead of having to finish on its own — this is what makes a session
 * cancellable from the outside (`serve` `/computer/agent/stop`).
 */
export async function withEngineConnection<T>(
  target: SpawnTarget,
  handlers: EngineSessionHandlers,
  op: (ctx: ClientContext) => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  const proc = spawn(target.command, target.args, {
    cwd: target.cwd,
    env: target.env,
    stdio: ["pipe", "pipe", "pipe"],
  }) as ChildProcessWithoutNullStreams;

  const getStderrTail = captureStderr(proc);

  const processState: {
    spawnErrorMessage: string | null;
    exitInfo: { code: number | null; signal: NodeJS.Signals | null } | null;
  } = { spawnErrorMessage: null, exitInfo: null };
  proc.once("error", (err) => {
    processState.spawnErrorMessage = `引擎进程启动失败: ${err.message}`;
  });
  proc.once("exit", (code, signal) => {
    processState.exitInfo = { code, signal };
  });

  // Abort -> kill the engine so a parked `op` (e.g. awaiting session/prompt)
  // stops promptly instead of running until the engine finishes naturally.
  const onAbort = () => {
    if (!proc.killed) proc.kill();
  };
  if (signal) {
    if (signal.aborted) onAbort();
    else signal.addEventListener("abort", onAbort, { once: true });
  }

  const stream = ndJsonStream(
    Writable.toWeb(proc.stdin),
    Readable.toWeb(proc.stdout) as ReadableStream<Uint8Array>,
  );

  const app = client({ name: "nuwa-cli" })
    .onRequest(
      CLIENT_METHODS.session_request_permission,
      (reqCtx): Promise<RequestPermissionResponse> =>
        decidePermission(
          reqCtx.params as RequestPermissionRequest,
          handlers.permissionMode,
        ),
    )
    .onNotification(CLIENT_METHODS.session_update, (reqCtx) => {
      routeSessionUpdate(reqCtx.params as SessionNotification, handlers);
    });

  const run = app.connectWith(stream, async (ctx) => {
    await ctx.request(AGENT_METHODS.initialize, {
      protocolVersion: PROTOCOL_VERSION,
      clientCapabilities: {},
      clientInfo: { name: "nuwa-cli", version: CLI_VERSION },
    });
    return op(ctx);
  });

  try {
    return await run;
  } catch (err) {
    if (signal?.aborted) throw new Error("引擎会话已被中止");
    if (processState.spawnErrorMessage)
      throw new Error(processState.spawnErrorMessage);
    if (!processState.exitInfo) {
      // The ACP stream may report "connection closed" a tick before the
      // child's own 'exit' event fires (both are consequences of the same
      // process death) — give it a brief grace window so a genuine crash
      // surfaces the exit code + stderr instead of the generic SDK message.
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    const exitInfo = processState.exitInfo;
    if (exitInfo && exitInfo.code !== 0 && exitInfo.code !== null) {
      throw new Error(
        `引擎进程异常退出 (code=${exitInfo.code}${exitInfo.signal ? `, signal=${exitInfo.signal}` : ""})\n${getStderrTail()}`,
      );
    }
    throw err;
  } finally {
    if (!proc.killed) proc.kill();
    signal?.removeEventListener("abort", onAbort);
  }
}
