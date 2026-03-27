/**
 * Linux Sandbox 实现 (基于 bubblewrap)
 *
 * @version 1.0.0
 * @created 2026-03-27
 */

import { spawn } from "child_process";
import * as fs from "fs";
import * as path from "path";
import log from "electron-log";
import type {
  SandboxInterface,
  SandboxConfig,
  ExecuteOptions,
  ExecuteResult,
  SandboxStatus,
} from "./types";

export class LinuxSandbox implements SandboxInterface {
  private config: SandboxConfig | null = null;
  private available: boolean = false;
  private useBubblewrap: boolean = false;

  /**
   * 初始化沙箱
   */
  async initialize(config: SandboxConfig): Promise<void> {
    this.config = config;

    // 检查 bubblewrap 是否可用
    this.useBubblewrap = await this.checkBubblewrap();

    if (this.useBubblewrap) {
      this.available = true;
      log.info("[LinuxSandbox] Initialized with bubblewrap");
    } else {
      this.available = true; // 降级到无沙箱
      log.warn(
        "[LinuxSandbox] bubblewrap not available, using unsandboxed execution",
      );
    }
  }

  /**
   * 执行命令
   */
  async execute(
    command: string,
    cwd: string,
    options?: ExecuteOptions,
  ): Promise<ExecuteResult> {
    if (!this.available || !this.config) {
      throw new Error("Sandbox not initialized");
    }

    const startTime = Date.now();

    if (this.useBubblewrap) {
      return this.executeInBubblewrap(command, cwd, options, startTime);
    } else {
      return this.executeUnsandboxed(command, cwd, options, startTime);
    }
  }

  /**
   * 使用 bubblewrap 执行
   */
  private async executeInBubblewrap(
    command: string,
    cwd: string,
    options?: ExecuteOptions,
    startTime?: number,
  ): Promise<ExecuteResult> {
    const args = this.generateBubblewrapArgs(cwd);

    return new Promise((resolve, reject) => {
      const proc = spawn("bwrap", [...args, "bash", "-c", command], {
        cwd,
        env: {
          ...process.env,
          ...options?.env,
        },
      });

      let stdout = "";
      let stderr = "";

      proc.stdout?.on("data", (data) => {
        stdout += data.toString();
        options?.onOutput?.(data.toString());
      });

      proc.stderr?.on("data", (data) => {
        stderr += data.toString();
        options?.onOutput?.(data.toString());
      });

      // 超时处理
      let timeoutHandle: NodeJS.Timeout | undefined;
      if (options?.timeout) {
        timeoutHandle = setTimeout(() => {
          proc.kill("SIGKILL");
        }, options.timeout * 1000);
      }

      // 取消处理
      const onAbort = () => {
        proc.kill("SIGKILL");
      };
      options?.signal?.addEventListener("abort", onAbort, { once: true });

      proc.on("close", (code) => {
        if (timeoutHandle) clearTimeout(timeoutHandle);
        options?.signal?.removeEventListener("abort", onAbort);

        const duration = startTime ? Date.now() - startTime : 0;

        if (options?.signal?.aborted) {
          reject(new Error("Execution aborted"));
        } else {
          resolve({
            exitCode: code ?? -1,
            stdout,
            stderr,
            duration,
          });
        }
      });

      proc.on("error", (error) => {
        if (timeoutHandle) clearTimeout(timeoutHandle);
        options?.signal?.removeEventListener("abort", onAbort);
        reject(error);
      });
    });
  }

  /**
   * 生成 bubblewrap 参数
   */
  private generateBubblewrapArgs(cwd: string): string[] {
    const args = [
      "--ro-bind",
      "/usr",
      "/usr",
      "--ro-bind",
      "/lib",
      "/lib",
      "--ro-bind",
      "/lib64",
      "/lib64",
      "--ro-bind",
      "/bin",
      "/bin",
      "--ro-bind",
      "/sbin",
      "/sbin",
      "--bind",
      cwd,
      cwd,
      "--dev",
      "/dev",
      "--proc",
      "/proc",
      "--unshare-all",
      "--die-with-parent",
      "--new-session",
    ];

    // 网络配置
    if (this.config?.network?.enabled) {
      args.push("--share-net");
    }

    // 文件系统配置
    const filesystem = this.config?.filesystem;

    if (filesystem) {
      // 允许读取
      (filesystem.allowRead || []).forEach((p) => {
        if (p !== "." && p !== cwd) {
          args.push("--ro-bind", p, p);
        }
      });

      // 允许写入
      (filesystem.allowWrite || []).forEach((p) => {
        if (p !== "." && p !== cwd && p !== "/tmp") {
          args.push("--bind", p, p);
        }
      });
    }

    // 临时目录
    args.push("--bind", "/tmp", "/tmp");

    return args;
  }

  /**
   * 无沙箱执行（降级方案）
   */
  private async executeUnsandboxed(
    command: string,
    cwd: string,
    options?: ExecuteOptions,
    startTime?: number,
  ): Promise<ExecuteResult> {
    return new Promise((resolve, reject) => {
      const proc = spawn("bash", ["-c", command], {
        cwd,
        env: {
          ...process.env,
          ...options?.env,
        },
      });

      let stdout = "";
      let stderr = "";

      proc.stdout?.on("data", (data) => {
        stdout += data.toString();
        options?.onOutput?.(data.toString());
      });

      proc.stderr?.on("data", (data) => {
        stderr += data.toString();
        options?.onOutput?.(data.toString());
      });

      let timeoutHandle: NodeJS.Timeout | undefined;
      if (options?.timeout) {
        timeoutHandle = setTimeout(() => {
          proc.kill("SIGKILL");
        }, options.timeout * 1000);
      }

      const onAbort = () => {
        proc.kill("SIGKILL");
      };
      options?.signal?.addEventListener("abort", onAbort, { once: true });

      proc.on("close", (code) => {
        if (timeoutHandle) clearTimeout(timeoutHandle);
        options?.signal?.removeEventListener("abort", onAbort);

        const duration = startTime ? Date.now() - startTime : 0;

        if (options?.signal?.aborted) {
          reject(new Error("Execution aborted"));
        } else {
          resolve({
            exitCode: code ?? -1,
            stdout,
            stderr,
            duration,
          });
        }
      });

      proc.on("error", (error) => {
        if (timeoutHandle) clearTimeout(timeoutHandle);
        options?.signal?.removeEventListener("abort", onAbort);
        reject(error);
      });
    });
  }

  /**
   * 读取文件
   */
  async readFile(filePath: string): Promise<string> {
    if (!this.available) {
      throw new Error("Sandbox not initialized");
    }

    const result = await this.execute(
      `cat "${filePath}"`,
      path.dirname(filePath),
    );
    return result.stdout;
  }

  /**
   * 写入文件
   */
  async writeFile(filePath: string, content: string): Promise<void> {
    if (!this.available) {
      throw new Error("Sandbox not initialized");
    }

    const escapedContent = content.replace(/'/g, "'\\''");
    const result = await this.execute(
      `echo '${escapedContent}' > "${filePath}"`,
      path.dirname(filePath),
    );

    if (result.exitCode !== 0) {
      throw new Error(`Failed to write file: ${result.stderr}`);
    }
  }

  /**
   * 检查沙箱是否可用
   */
  async isAvailable(): Promise<boolean> {
    return this.available;
  }

  /**
   * 获取沙箱状态
   */
  getStatus(): SandboxStatus {
    return {
      available: this.available,
      type: this.useBubblewrap ? "bubblewrap" : "none",
      platform: "linux",
      version: "1.0.0",
    };
  }

  /**
   * 清理资源
   */
  async cleanup(): Promise<void> {
    log.info("[LinuxSandbox] Cleanup completed");
  }

  /**
   * 检查 bubblewrap 是否可用
   */
  private async checkBubblewrap(): Promise<boolean> {
    return new Promise((resolve) => {
      const proc = spawn("which", ["bwrap"]);

      proc.on("close", (code) => {
        resolve(code === 0);
      });

      proc.on("error", () => {
        resolve(false);
      });
    });
  }
}
