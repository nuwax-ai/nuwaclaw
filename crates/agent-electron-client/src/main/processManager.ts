import { spawn, ChildProcess } from 'child_process';
import log from 'electron-log';

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
    stdio?: ('ignore' | 'pipe')[];
    startupDelayMs?: number;
  }): Promise<{ success: boolean; error?: string; message?: string }> {
    if (this.process) {
      this.lastError = null;
      return Promise.resolve({ success: true, message: 'Already running' });
    }

    return new Promise((resolve) => {
      try {
        const proc = spawn(config.command, config.args, {
          shell: config.shell ?? false,
          windowsHide: true,
          env: config.env ? { ...process.env, ...config.env } : process.env,
          cwd: config.cwd,
          stdio: (config.stdio as any) ?? ['ignore', 'pipe', 'pipe'],
        });

        proc.stdout?.on('data', (data: Buffer) => {
          log.info(`[${this.name}]`, data.toString().trim());
        });

        proc.stderr?.on('data', (data: Buffer) => {
          log.warn(`[${this.name} stderr]`, data.toString().trim());
        });

        proc.on('error', (error) => {
          log.error(`[${this.name}] 进程错误:`, error.message, { stack: error.stack });
          this.process = null;
          this.lastError = error.message;
          resolve({ success: false, error: error.message });
        });

        proc.on('exit', (code, signal) => {
          if (code !== 0 && code !== null) {
            log.warn(`[${this.name}] 进程退出 code=${code} signal=${signal ?? 'none'}`, { lastError: this.lastError });
          } else {
            log.info(`[${this.name}] 进程已退出`, { code, signal: signal ?? 'none' });
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
            const msg = '进程启动后立即退出';
            this.lastError = msg;
            log.warn(`[${this.name}] 启动失败: ${msg}`, { command: config.command, args: config.args });
            resolve({ success: false, error: msg });
          }
        }, delay);
      } catch (error) {
        this.process = null;
        this.lastError = String(error);
        log.error(`[${this.name}] 启动异常:`, error instanceof Error ? error.message : String(error), { stack: error instanceof Error ? error.stack : undefined });
        resolve({ success: false, error: String(error) });
      }
    });
  }

  stop(): { success: boolean; message?: string } {
    this.lastError = null;
    if (this.process) {
      this.process.kill();
      this.process = null;
      return { success: true };
    }
    return { success: true, message: 'Not running' };
  }

  status(): { running: boolean; pid?: number; error?: string } {
    return {
      running: this.process !== null,
      pid: this.process?.pid,
      error: this.process === null && this.lastError ? this.lastError : undefined,
    };
  }

  kill(): void {
    if (this.process) {
      try {
        this.process.kill();
        log.info(`[Cleanup] ${this.name} stopped`);
      } catch (e) {
        log.error(`[Cleanup] ${this.name} stop error:`, e);
      }
      this.process = null;
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
