import { EventEmitter } from "events";
import { spawn, ChildProcess } from "child_process";
import log from "electron-log";
import { PROCESS_KILL_ESCALATION_TIMEOUT } from "@shared/constants";
import { t } from "./services/i18n";

const STARTUP_STDERR_CAP = 8192;
const STARTUP_STDERR_IN_ERROR = 1200;

export interface RestartPolicy {
  /** 是否启用自动重启（默认 false） */
  enabled: boolean;
  /** 最大重启次数（默认 5） */
  maxRestarts: number;
  /** 初始退避延迟 ms（默认 1000） */
  backoffBase: number;
  /** 最大退避延迟 ms（默认 30000） */
  backoffMax: number;
  /** 稳定运行多长时间后重置重启计数 ms（默认 60000） */
  resetAfterMs: number;
}

const DEFAULT_RESTART_POLICY: RestartPolicy = {
  enabled: false,
  maxRestarts: 5,
  backoffBase: 1000,
  backoffMax: 30000,
  resetAfterMs: 60000,
};

export class ManagedProcess extends EventEmitter {
  private process: ChildProcess | null = null;
  private lastError: string | null = null;
  /** 当前这次 start() 收集的 stderr，用于「启动后立即退出」时的错误详情 */
  private startupStderr = "";
  private startupExit: {
    code: number | null;
    signal: NodeJS.Signals | null;
  } | null = null;

  private readonly restartPolicy: RestartPolicy;
  private restartCount = 0;
  private lastRestartAt = 0;
  private lastStartConfig: Parameters<ManagedProcess["start"]>[0] | null = null;

  constructor(
    private readonly name: string,
    policy?: Partial<RestartPolicy>,
  ) {
    super();
    this.restartPolicy = { ...DEFAULT_RESTART_POLICY, ...policy };
  }

  private scheduleRestart(): void {
    const now = Date.now();
    // 若进程已稳定运行 resetAfterMs 以上，重置重启计数
    if (
      this.lastRestartAt > 0 &&
      now - this.lastRestartAt > this.restartPolicy.resetAfterMs
    ) {
      this.restartCount = 0;
    }

    if (this.restartCount >= this.restartPolicy.maxRestarts) {
      log.error(
        `[${this.name}] Max restarts (${this.restartPolicy.maxRestarts}) reached, giving up`,
      );
      this.emit("restart:failed", { attempts: this.restartCount });
      return;
    }

    const delay = Math.min(
      this.restartPolicy.backoffBase * Math.pow(2, this.restartCount),
      this.restartPolicy.backoffMax,
    );
    this.restartCount++;
    this.lastRestartAt = now;

    log.info(
      `[${this.name}] Unexpected exit — scheduling restart in ${delay}ms (attempt ${this.restartCount}/${this.restartPolicy.maxRestarts})`,
    );
    this.emit("restart", { attempt: this.restartCount, delayMs: delay });

    setTimeout(async () => {
      if (!this.lastStartConfig) return;
      log.info(`[${this.name}] Restarting now (attempt ${this.restartCount})`);
      await this.start(this.lastStartConfig);
    }, delay);
  }

  start(config: {
    command: string;
    args: string[];
    env?: Record<string, string>;
    cwd?: string;
    shell?: boolean;
    stdio?: ("ignore" | "pipe")[];
    startupDelayMs?: number;
    /** 每行 stdout 的额外回调，在 log.info 之后调用 */
    onStdoutLine?: (line: string) => void;
  }): Promise<{ success: boolean; error?: string; message?: string }> {
    if (this.process) {
      this.lastError = null;
      return Promise.resolve({ success: true, message: "Already running" });
    }

    // 保存配置供自动重启使用
    this.lastStartConfig = config;

    return new Promise((resolve) => {
      try {
        this.startupStderr = "";
        this.startupExit = null;

        const proc = spawn(config.command, config.args, {
          shell: config.shell ?? false,
          windowsHide: true,
          env: config.env ? { ...process.env, ...config.env } : process.env,
          cwd: config.cwd,
          stdio: (config.stdio as any) ?? ["ignore", "pipe", "pipe"],
        });

        proc.stdout?.on("data", (data: Buffer) => {
          const line = data.toString().trim();
          log.info(`[${this.name}]`, line);
          config.onStdoutLine?.(line);
        });

        proc.stderr?.on("data", (data: Buffer) => {
          const raw = data.toString();
          const combined = this.startupStderr + raw;
          this.startupStderr =
            combined.length > STARTUP_STDERR_CAP
              ? combined.slice(-STARTUP_STDERR_CAP)
              : combined;
          log.warn(`[${this.name} stderr]`, raw.trim());
        });

        proc.on("error", (error) => {
          log.error(`[${this.name}] Process error:`, error.message, {
            stack: error.stack,
          });
          this.process = null;
          this.lastError = error.message;
          resolve({ success: false, error: error.message });
        });

        proc.on("exit", (code, signal) => {
          this.startupExit = { code, signal: signal ?? null };
          // this.process 为非 null 说明是意外退出（stop/kill 会先置 null）
          const wasUnexpected = this.process !== null;
          if (code !== 0 && code !== null) {
            log.warn(
              `[${this.name}] Process exited code=${code} signal=${signal ?? "none"}`,
              { lastError: this.lastError },
            );
          } else {
            log.info(`[${this.name}] Process exited`, {
              code,
              signal: signal ?? "none",
            });
          }
          this.process = null;
          // 意外退出时，若启用了重启策略则调度重启
          if (wasUnexpected && this.restartPolicy.enabled) {
            this.scheduleRestart();
          }
        });

        this.process = proc;

        const delay = config.startupDelayMs ?? 1000;
        setTimeout(() => {
          if (this.process) {
            this.lastError = null;
            this.startupStderr = "";
            this.startupExit = null;
            // 启动成功，若是自动重启路径则记录稳定时间（resetAfterMs 后会重置计数）
            this.lastRestartAt =
              this.restartCount > 0 ? Date.now() : this.lastRestartAt;
            resolve({ success: true });
          } else {
            const base = t("Claw.Process.exitImmediately");
            const ex = this.startupExit;
            const exitHint = ex
              ? ` (exit ${ex.code}, signal ${ex.signal ?? "none"})`
              : "";
            const tail = this.startupStderr.trim();

            // Try to parse structured error prefix (e.g., GUI_AGENT_ERROR:{...})
            let errorMsg: string;
            // Extract first line matching GUI_AGENT_ERROR: prefix, then parse JSON from it
            const errorLineMatch = tail
              .split("\n")
              .find((line) => line.startsWith("GUI_AGENT_ERROR:"));
            if (errorLineMatch) {
              const jsonStr = errorLineMatch.substring(
                "GUI_AGENT_ERROR:".length,
              );
              try {
                const errObj = JSON.parse(jsonStr);
                errorMsg = errObj.message || errObj.code || "Unknown error";
              } catch {
                errorMsg = base + exitHint;
              }
            } else {
              // Fallback: parse structured logs, extract [error] lines only
              // Format: [YYYY-MM-DD HH:mm:ss.SSS] [level] [service] message
              const errorLines = tail
                .split("\n")
                .filter(
                  (line) =>
                    /\]\s*\[error\]/i.test(line) || /\[error\]\s*/i.test(line),
                )
                .map((line) => {
                  // Strip timestamp and log level prefix for cleaner output
                  const msgMatch = line.match(
                    /(\[[\d:.\s]+\]\s*)?\[[^\]]+\]\s*\[error\]\s*(.*)/i,
                  );
                  return msgMatch ? msgMatch[2] : line;
                })
                .slice(-2); // Keep last 2 error lines
              const filteredTail = errorLines.join("; ");
              errorMsg =
                filteredTail.length > 0
                  ? `: ${filteredTail.length > STARTUP_STDERR_IN_ERROR ? "…" + filteredTail.slice(-STARTUP_STDERR_IN_ERROR) : filteredTail}`
                  : "";
            }

            const msg = `${base}${exitHint}${errorMsg}`;
            this.lastError = msg;
            log.warn(`[${this.name}] Start failed: ${msg}`, {
              command: config.command,
              args: config.args,
            });
            resolve({ success: false, error: msg });
          }
        }, delay);
      } catch (error) {
        this.process = null;
        this.lastError = String(error);
        log.error(
          `[${this.name}] Start exception:`,
          error instanceof Error ? error.message : String(error),
          { stack: error instanceof Error ? error.stack : undefined },
        );
        resolve({ success: false, error: String(error) });
      }
    });
  }

  stop(): { success: boolean; message?: string } {
    this.lastError = null;
    if (this.process) {
      const proc = this.process;
      this.process = null;
      // Remove all event listeners to prevent handle leaks (matching kill() behavior)
      proc.stdout?.removeAllListeners();
      proc.stderr?.removeAllListeners();
      proc.stdin?.removeAllListeners();
      proc.removeAllListeners();
      proc.kill();
      return { success: true };
    }
    return { success: true, message: "Not running" };
  }

  /**
   * 异步停止进程，等待其真正退出后再返回。
   * 用于需要确保端口/资源已释放后再重启的场景（如 lanproxy 切换账号）。
   */
  stopAsync(timeoutMs = 5000): Promise<{ success: boolean; message?: string }> {
    this.lastError = null;
    if (!this.process) {
      return Promise.resolve({ success: true, message: "Not running" });
    }
    const proc = this.process;
    this.process = null;

    // 与 kill() 保持一致：清理 stdio 监听器，防止 Windows 句柄泄漏。
    proc.stdout?.removeAllListeners();
    proc.stderr?.removeAllListeners();
    proc.stdin?.removeAllListeners();
    // 移除 start() 注册的 exit handler，防止旧进程退出时错误清空新进程引用。
    proc.removeAllListeners("exit");

    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        try {
          proc.kill("SIGKILL");
        } catch {
          /* ignore */
        }
        log.warn(
          `[${this.name}] stopAsync: process did not exit within ${timeoutMs}ms, force killed`,
        );
        resolve({ success: true, message: "Force killed after timeout" });
      }, timeoutMs);

      proc.once("exit", () => {
        clearTimeout(timer);
        resolve({ success: true });
      });

      proc.kill();
    });
  }

  status(): { running: boolean; pid?: number; error?: string } {
    return {
      running: this.process !== null,
      pid: this.process?.pid,
      error:
        this.process === null && this.lastError ? this.lastError : undefined,
    };
  }

  kill(): void {
    if (this.process) {
      const proc = this.process;
      this.process = null;
      try {
        // 🔧 FIX: Remove all event listeners to prevent handle leaks
        // Event listeners maintain references to stdout/stderr streams
        // which prevents Windows from releasing file handles
        proc.stdout?.removeAllListeners();
        proc.stderr?.removeAllListeners();
        proc.stdin?.removeAllListeners();
        proc.removeAllListeners();

        proc.kill();
        log.info(`[Cleanup] ${this.name} sent SIGTERM`);

        // Escalate to SIGKILL if process doesn't exit in time
        const escalationTimer = setTimeout(() => {
          try {
            if (proc.pid) {
              process.kill(proc.pid, "SIGKILL");
              log.warn(
                `[Cleanup] ${this.name} escalated to SIGKILL after ${PROCESS_KILL_ESCALATION_TIMEOUT}ms`,
              );
            }
          } catch {
            // Process already exited, ignore
          }
        }, PROCESS_KILL_ESCALATION_TIMEOUT);

        // Clear timer if process exits promptly
        proc.once("exit", () => {
          clearTimeout(escalationTimer);
          log.info(`[Cleanup] ${this.name} exited`);
        });
      } catch (e) {
        log.error(`[Cleanup] ${this.name} stop error:`, e);
      }
    }
    this.lastError = null;
  }

  get running(): boolean {
    return this.process !== null;
  }

  get pid(): number | undefined {
    return this.process?.pid;
  }
}
