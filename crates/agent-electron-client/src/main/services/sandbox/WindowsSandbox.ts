/**
 * Windows Sandbox 实现 (基于 Codex)
 *
 * @version 1.0.0
 * @created 2026-03-27
 * @license Apache-2.0 (基于 OpenAI Codex)
 */

import { spawn } from "child_process";
import * as fs from "fs";
import * as path from "path";
import log from "electron-log";
import { app } from "electron";
import type {
  SandboxInterface,
  SandboxConfig,
  ExecuteOptions,
  ExecuteResult,
  SandboxStatus,
} from "./types";

export class WindowsSandbox implements SandboxInterface {
  private config: SandboxConfig | null = null;
  private available: boolean = false;
  private sandboxBinary: string | null = null;

  /**
   * 初始化沙箱
   */
  async initialize(config: SandboxConfig): Promise<void> {
    this.config = config;

    // 查找 nuwax-sandbox.exe
    this.sandboxBinary = await this.findSandboxBinary();

    if (this.sandboxBinary) {
      this.available = true;
      log.info(
        `[WindowsSandbox] Initialized with Codex sandbox: ${this.sandboxBinary}`,
      );
    } else {
      this.available = false;
      log.warn(
        "[WindowsSandbox] Codex sandbox binary not found, sandbox unavailable",
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
    if (!this.available || !this.config || !this.sandboxBinary) {
      throw new Error("Sandbox not initialized or unavailable");
    }

    const startTime = Date.now();

    // 生成沙箱配置
    const sandboxConfig = this.generateSandboxConfig(cwd, options);
    const configPath = path.join(
      require("os").tmpdir(),
      `sandbox-config-${Date.now()}.json`,
    );

    try {
      // 写入配置文件
      await fs.promises.writeFile(
        configPath,
        JSON.stringify(sandboxConfig, null, 2),
      );

      // 调用 nuwax-sandbox.exe
      return new Promise((resolve, reject) => {
        const proc = spawn(
          this.sandboxBinary!,
          ["--config", configPath, "--command", command, "--cwd", cwd],
          {
            cwd,
            env: {
              ...process.env,
              ...options?.env,
            },
          },
        );

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
            proc.kill("SIGTERM");
          }, options.timeout * 1000);
        }

        // 取消处理
        const onAbort = () => {
          proc.kill("SIGTERM");
        };
        options?.signal?.addEventListener("abort", onAbort, { once: true });

        proc.on("close", (code) => {
          if (timeoutHandle) clearTimeout(timeoutHandle);
          options?.signal?.removeEventListener("abort", onAbort);

          const duration = Date.now() - startTime;

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
    } finally {
      // 清理配置文件
      try {
        await fs.promises.unlink(configPath);
      } catch {
        // 忽略清理错误
      }
    }
  }

  /**
   * 读取文件
   */
  async readFile(filePath: string): Promise<string> {
    if (!this.available) {
      throw new Error("Sandbox not initialized");
    }

    const result = await this.execute(
      `type "${filePath}"`,
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

    // Windows PowerShell 写入
    const escapedContent = content.replace(/"/g, '""');
    const result = await this.execute(
      `Set-Content -Path "${filePath}" -Value "${escapedContent}"`,
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
      type: "codex",
      platform: "win32",
      version: "1.0.0",
      config: this.sandboxBinary ? { binary: this.sandboxBinary } : undefined,
    } as any;
  }

  /**
   * 清理资源
   */
  async cleanup(): Promise<void> {
    log.info("[WindowsSandbox] Cleanup completed");
  }

  /**
   * 查找 nuwax-sandbox.exe
   */
  private async findSandboxBinary(): Promise<string | null> {
    // 可能的路径
    const possiblePaths = [
      // 开发环境
      path.join(
        __dirname,
        "..",
        "..",
        "..",
        "..",
        "resources",
        "sandbox",
        "win32-x64",
        "nuwax-sandbox.exe",
      ),

      // 生产环境（应用打包后）
      path.join(
        app.getAppPath(),
        "resources",
        "sandbox",
        "win32-x64",
        "nuwax-sandbox.exe",
      ),

      // 全局安装
      path.join(
        "C:",
        "Program Files",
        "NuwaClaw",
        "sandbox",
        "nuwax-sandbox.exe",
      ),
    ];

    for (const binaryPath of possiblePaths) {
      if (fs.existsSync(binaryPath)) {
        log.info(`[WindowsSandbox] Found binary at: ${binaryPath}`);
        return binaryPath;
      }
    }

    log.warn("[WindowsSandbox] Binary not found in any location");
    return null;
  }

  /**
   * 生成沙箱配置
   */
  private generateSandboxConfig(cwd: string, options?: ExecuteOptions): any {
    const config: any = {
      command_timeout:
        options?.timeout || this.config?.resources?.timeout || 300,
      memory_limit: this.config?.resources?.memory || "2g",
      cpu_limit: this.config?.resources?.cpu || 2,
    };

    // 网络配置
    if (this.config?.network) {
      config.network = {
        enabled: this.config.network.enabled,
        allowed_domains: this.config.network.allowedDomains || [],
        denied_domains: this.config.network.deniedDomains || [],
      };
    }

    // 文件系统配置
    if (this.config?.filesystem) {
      config.filesystem = {
        allow_read: [cwd, ...(this.config.filesystem.allowRead || [])],
        deny_read: this.config.filesystem.denyRead || ["~/.ssh", "~/.aws"],
        allow_write: [cwd, ...(this.config.filesystem.allowWrite || [])],
        deny_write: this.config.filesystem.denyWrite || [".env", "*.pem"],
      };
    }

    return config;
  }
}
