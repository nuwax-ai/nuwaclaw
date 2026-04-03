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
  /** Whether network access is allowed */
  networkEnabled?: boolean;
}

// ============================================================================
// AcpTerminalManager
// ============================================================================

export class AcpTerminalManager {
  private terminals = new Map<string, TerminalSession>();
  private sandboxInvoker: SandboxInvoker | null;
  private readonly useSandbox: boolean;

  constructor(options?: AcpTerminalManagerOptions) {
    this.useSandbox = !!(
      options?.windowsSandboxHelperPath && process.platform === "win32"
    );

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
    const terminalId = `term_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    let resolveExit!: TerminalSession["resolveExit"];
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
      resolveExit,
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

    if (this.useSandbox && this.sandboxInvoker) {
      // Windows: route through nuwax-sandbox-helper.exe run
      const invocation = await this.sandboxInvoker.buildInvocation({
        command: params.command,
        args: params.args || [],
        cwd,
        env,
        writablePaths: [cwd],
        networkEnabled: true,
        subcommand: "run",
      });

      log.info("[AcpTerminalManager] Creating sandboxed terminal:", {
        terminalId,
        sessionId: params.sessionId,
        command: params.command,
        wrappedCommand: invocation.command,
        parseJson: invocation.parseJson,
      });

      this.spawnProcess(
        session,
        invocation.command,
        invocation.args,
        invocation.env,
        cwd,
        true, // parseJson: helper run returns JSON
      );
    } else {
      // macOS/Linux or no sandbox: execute directly
      log.info("[AcpTerminalManager] Creating terminal (direct):", {
        terminalId,
        sessionId: params.sessionId,
        command: params.command,
      });

      this.spawnProcess(
        session,
        params.command,
        params.args || [],
        env,
        cwd,
        false,
      );
    }

    this.terminals.set(terminalId, session);
    return terminalId;
  }

  // --- terminal/output ---

  async terminalOutput(terminalId: string): Promise<{
    output: string;
    truncated: boolean;
    exitStatus: TerminalExitStatus | null;
  }> {
    const t = this.terminals.get(terminalId);
    if (!t) throw new Error(`Terminal not found: ${terminalId}`);
    return {
      output: t.output,
      truncated: t.truncated,
      exitStatus: t.exitStatus,
    };
  }

  // --- terminal/wait_for_exit ---

  async waitForExit(terminalId: string): Promise<TerminalExitStatus> {
    const t = this.terminals.get(terminalId);
    if (!t) throw new Error(`Terminal not found: ${terminalId}`);
    return t.exitPromise;
  }

  // --- terminal/kill ---

  async kill(terminalId: string): Promise<void> {
    const t = this.terminals.get(terminalId);
    if (!t || !t.process) return;
    log.info("[AcpTerminalManager] Killing terminal:", terminalId);
    try {
      t.process.kill("SIGKILL");
    } catch {
      // Process may have already exited
    }
  }

  // --- terminal/release ---

  async release(terminalId: string): Promise<void> {
    const t = this.terminals.get(terminalId);
    if (!t) return;
    log.info("[AcpTerminalManager] Releasing terminal:", terminalId);
    if (t.process) {
      try {
        t.process.kill("SIGKILL");
      } catch {
        // ignore
      }
    }
    this.terminals.delete(terminalId);
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
        return this.terminalOutput(params.terminalId);
      },

      waitForTerminalExit: async (params) => {
        return this.waitForExit(params.terminalId);
      },

      killTerminal: async (params) => {
        await this.kill(params.terminalId);
        return {} as Record<string, never>;
      },

      releaseTerminal: async (params) => {
        await this.release(params.terminalId);
        return {} as Record<string, never>;
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
    const proc = spawn(command, args, {
      cwd,
      env,
      // sandbox helper is an .exe, no shell needed; direct commands may need shell
      shell: !parseJson && process.platform === "win32",
      windowsHide: true,
    });
    session.process = proc;

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
        try {
          const result = JSON.parse(jsonBuffer) as {
            exit_code: number;
            stdout: string;
            stderr: string;
            timed_out: boolean;
          };
          // The real command output is inside the JSON envelope
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
        } catch {
          // JSON parse failed, fall back to raw exit code
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
