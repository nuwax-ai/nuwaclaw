import { spawn, ChildProcess } from "child_process";
import log from "electron-log";
import { PROCESS_KILL_ESCALATION_TIMEOUT } from "@shared/constants";

export class ManagedProcess {
  private process: ChildProcess | null = null;
  private lastError: string | null = null;

  constructor(private readonly name: string) {}

  start(config: {
    command: string;
    args: string[];
    env?: Record<string, string>;
    cwd?: string;
    shell?: boolean;
    stdio?: ("ignore" | "pipe")[];
    startupDelayMs?: number;
  }): Promise<{ success: boolean; error?: string; message?: string }> {
    if (this.process) {
      this.lastError = null;
      return Promise.resolve({ success: true, message: "Already running" });
    }

    return new Promise((resolve) => {
      try {
        const proc = spawn(config.command, config.args, {
          shell: config.shell ?? false,
          windowsHide: true,
          env: config.env ? { ...process.env, ...config.env } : process.env,
          cwd: config.cwd,
          stdio: (config.stdio as any) ?? ["ignore", "pipe", "pipe"],
        });

        proc.stdout?.on("data", (data: Buffer) => {
          log.info(`[${this.name}]`, data.toString().trim());
        });

        proc.stderr?.on("data", (data: Buffer) => {
          log.warn(`[${this.name} stderr]`, data.toString().trim());
        });

        proc.on("error", (error) => {
          log.error(`[${this.name}] 进程错误:`, error.message, {
            stack: error.stack,
          });
          this.process = null;
          this.lastError = error.message;
          resolve({ success: false, error: error.message });
        });

        proc.on("exit", (code, signal) => {
          if (code !== 0 && code !== null) {
            log.warn(
              `[${this.name}] 进程退出 code=${code} signal=${signal ?? "none"}`,
              { lastError: this.lastError },
            );
          } else {
            log.info(`[${this.name}] 进程已退出`, {
              code,
              signal: signal ?? "none",
            });
          }
          this.process = null;
        });

        this.process = proc;

        const delay = config.startupDelayMs ?? 1000;
        setTimeout(() => {
          if (this.process) {
            this.lastError = null;
            resolve({ success: true });
          } else {
            const msg = "进程启动后立即退出";
            this.lastError = msg;
            log.warn(`[${this.name}] 启动失败: ${msg}`, {
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
          `[${this.name}] 启动异常:`,
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
          `[${this.name}] stopAsync: 进程未在 ${timeoutMs}ms 内退出，已强制终止`,
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
