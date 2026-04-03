/**
 * ACP Terminal Manager — Client-side implementation of the ACP Terminal API.
 *
 * Manages terminal lifecycle for commands delegated by ACP agents via
 * `terminal/create`. On Windows, commands are routed through
 * `nuwax-sandbox-helper.exe run` for per-command sandboxing.
 * On macOS/Linux, commands are executed directly (process-level sandboxing
 * is handled separately via seatbelt/bwrap).
 *
 * Implements the ACP Terminal protocol methods:
 * - terminal/create  → createTerminal()
 * - terminal/output  → terminalOutput()
 * - terminal/wait_for_exit → waitForExit()
 * - terminal/kill    → kill()
 * - terminal/release → release()
 *
 * @see https://agentclientprotocol.com/protocol/terminals
 */

import { spawn, ChildProcess } from "child_process";
import log from "electron-log";
import { SandboxInvoker } from "@main/services/sandbox/SandboxInvoker";
import type { WindowsSandboxMode } from "@shared/types/sandbox";

// ============================================================================
// Types
// ============================================================================

interface TerminalExitStatus {
  exitCode: number | null;
  signal: string | null;
}

interface TerminalSession {
  id: string;
  sessionId: string;
  /** Running child process (null after exit) */
  process: ChildProcess | null;
  /** Accumulated stdout + stderr output */
  output: string;
  /** Max output bytes to retain (null = unlimited) */
  byteLimit: number | null;
  /** Whether output was truncated due to byteLimit */
  truncated: boolean;
  /** Exit status (null while running) */
  exitStatus: TerminalExitStatus | null;
  /** Whether waitForExit promise has resolved */
  resolved: boolean;
  /** Promise that resolves when the process exits */
  exitPromise: Promise<TerminalExitStatus>;
  /** Resolver for exitPromise */
  resolveExit: (status: TerminalExitStatus) => void;
}

export interface AcpTerminalManagerOptions {
  /** Path to nuwax-sandbox-helper.exe (Windows only) */
  windowsSandboxHelperPath?: string;
  /** Windows sandbox mode */
  windowsSandboxMode?: WindowsSandboxMode;
  /** Whether network access is allowed for sandboxed commands */
  networkEnabled?: boolean;
  /** Paths that sandboxed commands can write to */
  writablePaths?: string[];
}

// ============================================================================
// AcpTerminalManager
// ============================================================================

export class AcpTerminalManager {
  private static readonly MAX_CONCURRENT = 50;
  private terminals = new Map<string, TerminalSession>();
  private sandboxInvoker: SandboxInvoker | null;
  private readonly useSandbox: boolean;
  private readonly networkEnabled: boolean;
  private readonly writablePaths: string[];

  constructor(options?: AcpTerminalManagerOptions) {
    this.useSandbox = !!(
      options?.windowsSandboxHelperPath && process.platform === "win32"
    );
    this.networkEnabled = options?.networkEnabled ?? true;
    this.writablePaths = options?.writablePaths ?? [];

    if (this.useSandbox) {
      this.sandboxInvoker = new SandboxInvoker("windows-sandbox", {
        windowsSandboxHelperPath: options!.windowsSandboxHelperPath,
        windowsSandboxMode: options!.windowsSandboxMode,
        networkEnabled: options!.networkEnabled ?? true,
      });
      log.info(
        "[AcpTerminalManager] Initialized with Windows sandbox helper:",
        options!.windowsSandboxHelperPath,
      );
    } else {
      this.sandboxInvoker = null;
      log.info(
        "[AcpTerminalManager] Initialized (direct execution, no sandbox)",
      );
    }
  }

  // --- terminal/create ---

  async createTerminal(params: {
    sessionId: string;
    command: string;
    args?: string[];
    env?: Array<{ name: string; value: string }>;
    cwd?: string | null;
    outputByteLimit?: number | null;
  }): Promise<string> {
    if (this.terminals.size >= AcpTerminalManager.MAX_CONCURRENT) {
      throw new Error(
        `Terminal limit reached (${AcpTerminalManager.MAX_CONCURRENT}). Release existing terminals first.`,
      );
    }

    const terminalId = `term_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    let resolveExit: ((status: TerminalExitStatus) => void) | null = null;
    const exitPromise = new Promise<TerminalExitStatus>((r) => {
      resolveExit = r;
    });

    const session: TerminalSession = {
      id: terminalId,
      sessionId: params.sessionId,
      process: null,
      output: "",
      byteLimit: params.outputByteLimit ?? null,
      truncated: false,
      exitStatus: null,
      resolved: false,
      exitPromise,
      resolveExit: resolveExit!,
    };

    const env: Record<string, string> = {
      ...(process.env as Record<string, string>),
    };
    if (params.env) {
      for (const { name, value } of params.env) {
        env[name] = value;
      }
    }

    const cwd = params.cwd || process.cwd();

    // Register BEFORE spawning so fast-exiting processes don't cause "not found" errors
    // in terminalOutput()/waitForExit() calls from the agent.
    this.terminals.set(terminalId, session);

    if (this.useSandbox && this.sandboxInvoker) {
      // Windows: route through nuwax-sandbox-helper.exe run
      let invocation;
      try {
        invocation = await this.sandboxInvoker.buildInvocation({
          command: params.command,
          args: params.args || [],
          cwd,
          env,
          writablePaths: [...this.writablePaths, cwd],
          networkEnabled: this.networkEnabled,
          subcommand: "run",
        });
      } catch (invErr) {
        this.terminals.delete(terminalId);
        throw invErr;
      }

      log.info("[AcpTerminalManager] ✅ SANDBOXED terminal created:", {
        terminalId,
        sessionId: params.sessionId,
        originalCommand: params.command,
        originalArgs: params.args,
        wrappedCommand: invocation.command,
        wrappedArgs: invocation.args,
        sandboxed: true,
        sandboxMode: "windows-sandbox-helper",
        networkEnabled: this.networkEnabled,
        writablePaths: [...this.writablePaths, cwd],
        cwd,
        parseJson: invocation.parseJson,
      });

      try {
        this.spawnProcess(
          session,
          invocation.command,
          invocation.args,
          invocation.env,
          cwd,
          true, // parseJson: helper run returns JSON
        );
      } catch (spawnErr) {
        this.cleanupFailedSpawn(session, terminalId);
        throw spawnErr;
      }
    } else {
      // macOS/Linux or no sandbox: execute directly
      log.info(
        "[AcpTerminalManager] ⚡ DIRECT terminal created (no sandbox):",
        {
          terminalId,
          sessionId: params.sessionId,
          command: params.command,
          args: params.args,
          sandboxed: false,
          platform: process.platform,
          cwd,
        },
      );

      try {
        this.spawnProcess(
          session,
          params.command,
          params.args || [],
          env,
          cwd,
          false,
        );
      } catch (spawnErr) {
        this.cleanupFailedSpawn(session, terminalId);
        throw spawnErr;
      }
    }

    return terminalId;
  }

  // --- terminal/output ---

  async terminalOutput(
    terminalId: string,
    sessionId?: string,
  ): Promise<{
    output: string;
    truncated: boolean;
    exitStatus: TerminalExitStatus | null;
  }> {
    const t = this.terminals.get(terminalId);
    if (!t) throw new Error(`Terminal not found: ${terminalId}`);
    if (sessionId && t.sessionId !== sessionId) {
      throw new Error(
        `Terminal ${terminalId} does not belong to session ${sessionId}`,
      );
    }
    return {
      output: t.output,
      truncated: t.truncated,
      exitStatus: t.exitStatus,
    };
  }

  // --- terminal/wait_for_exit ---

  async waitForExit(
    terminalId: string,
    sessionId?: string,
  ): Promise<TerminalExitStatus> {
    const t = this.terminals.get(terminalId);
    if (!t) throw new Error(`Terminal not found: ${terminalId}`);
    if (sessionId && t.sessionId !== sessionId) {
      throw new Error(
        `Terminal ${terminalId} does not belong to session ${sessionId}`,
      );
    }
    return t.exitPromise;
  }

  // --- terminal/kill ---

  async kill(terminalId: string, sessionId?: string): Promise<void> {
    const t = this.terminals.get(terminalId);
    if (!t || !t.process) return;
    if (sessionId && t.sessionId !== sessionId) {
      throw new Error(
        `Terminal ${terminalId} does not belong to session ${sessionId}`,
      );
    }
    log.info("[AcpTerminalManager] Killing terminal:", terminalId);
    try {
      t.process.kill("SIGKILL");
    } catch {
      // Process may have already exited
    }
  }

  // --- terminal/release ---

  async release(terminalId: string, sessionId?: string): Promise<void> {
    const t = this.terminals.get(terminalId);
    if (!t) return;
    if (sessionId && t.sessionId !== sessionId) {
      throw new Error(
        `Terminal ${terminalId} does not belong to session ${sessionId}`,
      );
    }
    log.info("[AcpTerminalManager] Releasing terminal:", terminalId);
    if (t.process) {
      try {
        t.process.kill("SIGKILL");
      } catch {
        // ignore
      }
    }
    // Resolve exitPromise if still pending so waitForExit() doesn't hang
    if (!t.resolved) {
      t.resolved = true;
      t.resolveExit({ exitCode: null, signal: null });
    }
    this.terminals.delete(terminalId);
  }

  /** Release all terminals belonging to a specific session */
  async releaseForSession(sessionId: string): Promise<void> {
    const ids: string[] = [];
    for (const [id, t] of this.terminals) {
      if (t.sessionId === sessionId) {
        ids.push(id);
      }
    }
    if (ids.length > 0) {
      log.info(
        `[AcpTerminalManager] Releasing ${ids.length} terminals for session ${sessionId}`,
      );
    }
    for (const id of ids) {
      await this.release(id);
    }
  }

  /** Release all terminals (called during engine destroy) */
  async releaseAll(): Promise<void> {
    const ids = Array.from(this.terminals.keys());
    if (ids.length > 0) {
      log.info(`[AcpTerminalManager] Releasing ${ids.length} terminals`);
    }
    for (const id of ids) {
      await this.release(id);
    }
  }

  /**
   * Returns the ACP Client handler methods for terminal/* operations.
   *
   * Spread into `buildClientHandler()` return value:
   * ```ts
   * return { ...existingHandlers, ...this.terminalManager.getClientHandlers() };
   * ```
   */
  getClientHandlers(): Pick<
    import("./acpClient").AcpClientHandler,
    | "createTerminal"
    | "terminalOutput"
    | "waitForTerminalExit"
    | "killTerminal"
    | "releaseTerminal"
  > {
    return {
      createTerminal: async (params) => {
        const terminalId = await this.createTerminal(params);
        return { terminalId };
      },

      terminalOutput: async (params) => {
        return this.terminalOutput(params.terminalId, params.sessionId);
      },

      waitForTerminalExit: async (params) => {
        return this.waitForExit(params.terminalId, params.sessionId);
      },

      killTerminal: async (params) => {
        await this.kill(params.terminalId, params.sessionId);
        return {};
      },

      releaseTerminal: async (params) => {
        await this.release(params.terminalId, params.sessionId);
        return {};
      },
    };
  }

  // ============================================================================
  // Private helpers
  // ============================================================================

  private spawnProcess(
    session: TerminalSession,
    command: string,
    args: string[],
    env: Record<string, string> | undefined,
    cwd: string,
    parseJson: boolean,
  ): void {
    const sandboxed = parseJson;
    log.info("[AcpTerminalManager] 🚀 Spawning process:", {
      terminalId: session.id,
      command,
      args: args.length > 0 ? args : undefined,
      cwd,
      sandboxed,
      shell: !parseJson && process.platform === "win32",
    });

    const proc = spawn(command, args, {
      cwd,
      env,
      // sandbox helper is an .exe, no shell needed; direct commands may need shell
      shell: !parseJson && process.platform === "win32",
      windowsHide: true,
    });
    session.process = proc;

    log.info("[AcpTerminalManager] Process spawned:", {
      terminalId: session.id,
      pid: proc.pid,
      sandboxed,
    });

    if (parseJson) {
      // Windows sandbox helper run mode: stdout is JSON blob, stderr is log
      let jsonBuffer = "";
      proc.stdout?.on("data", (data: Buffer) => {
        jsonBuffer += data.toString();
      });
      proc.stderr?.on("data", (data: Buffer) => {
        // stderr from helper itself is debug output, append to session output
        this.appendOutput(session, data);
      });
      proc.on("close", (code, signal) => {
        // Parse the JSON result from helper
        log.info(
          "[AcpTerminalManager] 📦 Sandbox helper exited, parsing JSON result:",
          {
            terminalId: session.id,
            exitCode: code,
            signal,
            jsonBufferLength: jsonBuffer.length,
          },
        );
        try {
          const result = JSON.parse(jsonBuffer) as {
            exit_code: number;
            stdout: string;
            stderr: string;
            timed_out: boolean;
          };
          // The real command output is inside the JSON envelope
          log.info("[AcpTerminalManager] ✅ Sandbox result parsed:", {
            terminalId: session.id,
            exit_code: result.exit_code,
            stdoutLength: result.stdout.length,
            stderrLength: result.stderr.length,
            timed_out: result.timed_out,
          });
          if (result.stdout) {
            this.appendOutput(session, Buffer.from(result.stdout));
          }
          if (result.stderr) {
            this.appendOutput(session, Buffer.from(result.stderr));
          }
          const status: TerminalExitStatus = {
            exitCode: result.exit_code,
            signal: null,
          };
          session.exitStatus = status;
          session.process = null;
          if (!session.resolved) {
            session.resolved = true;
            session.resolveExit(status);
          }
        } catch (parseErr) {
          // JSON parse failed, fall back to raw exit code
          log.warn(
            "[AcpTerminalManager] ⚠️ JSON parse failed, using raw exit code:",
            {
              terminalId: session.id,
              exitCode: code,
              jsonBufferPreview: jsonBuffer.slice(0, 200),
              error:
                parseErr instanceof Error ? parseErr.message : String(parseErr),
            },
          );
          const status: TerminalExitStatus = {
            exitCode: code ?? 1,
            signal: signal ?? null,
          };
          session.exitStatus = status;
          session.process = null;
          if (!session.resolved) {
            session.resolved = true;
            session.resolveExit(status);
          }
        }
      });
    } else {
      // Direct execution: stdout/stderr are command output
      proc.stdout?.on("data", (data: Buffer) =>
        this.appendOutput(session, data),
      );
      proc.stderr?.on("data", (data: Buffer) =>
        this.appendOutput(session, data),
      );
      proc.on("close", (code, signal) => {
        log.info("[AcpTerminalManager] 🔚 Direct process exited:", {
          terminalId: session.id,
          exitCode: code,
          signal,
          outputLength: session.output.length,
        });
        const status: TerminalExitStatus = {
          exitCode: code,
          signal: signal ?? null,
        };
        session.exitStatus = status;
        session.process = null;
        if (!session.resolved) {
          session.resolved = true;
          session.resolveExit(status);
        }
      });
    }

    proc.on("error", (err) => {
      log.error("[AcpTerminalManager] Process spawn error:", err);
      const status: TerminalExitStatus = { exitCode: 1, signal: null };
      session.exitStatus = status;
      session.process = null;
      if (!session.resolved) {
        session.resolved = true;
        session.resolveExit(status);
      }
    });
  }

  /**
   * Clean up a terminal session when spawn() throws synchronously.
   * Resolves the exitPromise and removes the session from the map
   * to prevent resource leaks.
   */
  private cleanupFailedSpawn(
    session: TerminalSession,
    terminalId: string,
  ): void {
    log.warn(
      "[AcpTerminalManager] Spawn failed, cleaning up terminal:",
      terminalId,
    );
    const status: TerminalExitStatus = { exitCode: 1, signal: null };
    session.exitStatus = status;
    session.process = null;
    if (!session.resolved) {
      session.resolved = true;
      session.resolveExit(status);
    }
    this.terminals.delete(terminalId);
  }

  private appendOutput(session: TerminalSession, data: Buffer): void {
    const text = data.toString();
    session.output += text;
    if (session.byteLimit && session.output.length > session.byteLimit) {
      // Truncate from the beginning, preserving the most recent output
      session.output = session.output.slice(
        session.output.length - session.byteLimit,
      );
      session.truncated = true;
    }
  }
}
