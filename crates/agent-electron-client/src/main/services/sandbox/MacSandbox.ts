/**
 * macOS Sandbox 实现 (基于 sandbox-exec)
 *
 * @version 1.0.0
 * @created 2026-03-27
 */

import { spawn } from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import log from "electron-log";
import type {
  SandboxInterface,
  SandboxConfig,
  ExecuteOptions,
  ExecuteResult,
  SandboxStatus,
} from "./types";

export class MacSandbox implements SandboxInterface {
  private config: SandboxConfig | null = null;
  private available: boolean = false;

  /**
   * 初始化沙箱
   */
  async initialize(config: SandboxConfig): Promise<void> {
    this.config = config;

    // 检查 sandbox-exec 是否可用
    try {
      await this.checkSandboxExec();
      this.available = true;
      log.info("[MacSandbox] Initialized successfully");
    } catch (error) {
      this.available = false;
      log.error("[MacSandbox] Initialization failed:", error);
      throw error;
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

    // 生成 Seatbelt 配置文件
    const profile = this.generateProfile(cwd);
    const profilePath = path.join(os.tmpdir(), `sandbox-${Date.now()}.sb`);

    try {
      await fs.promises.writeFile(profilePath, profile);

      return new Promise((resolve, reject) => {
        const proc = spawn(
          "sandbox-exec",
          ["-f", profilePath, "bash", "-c", command],
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
        await fs.promises.unlink(profilePath);
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

    // 在沙箱内读取文件
    const result = await this.execute(
      `cat "${filePath}"}`,
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

    // 在沙箱内写入文件
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
      type: "seatbelt",
      platform: "darwin",
      version: "1.0.0",
    };
  }

  /**
   * 清理资源
   */
  async cleanup(): Promise<void> {
    // macOS sandbox-exec 不需要特殊清理
    log.info("[MacSandbox] Cleanup completed");
  }

  /**
   * 检查 sandbox-exec 是否可用
   */
  private async checkSandboxExec(): Promise<void> {
    return new Promise((resolve, reject) => {
      const proc = spawn("which", ["sandbox-exec"]);

      proc.on("close", (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error("sandbox-exec not found"));
        }
      });

      proc.on("error", reject);
    });
  }

  /**
   * 生成 Seatbelt 配置文件
   */
  private generateProfile(cwd: string): string {
    if (!this.config) {
      throw new Error("Config not set");
    }

    const networkRules = this.generateNetworkRules();
    const filesystemRules = this.generateFilesystemRules(cwd);

    return `
(version 1)
(allow default)

; 系统库读取
(allow file-read* (subpath "/usr") (subpath "/System"))

; 网络规则
${networkRules}

; 文件系统规则
${filesystemRules}

; 临时文件
(allow file-read* (subpath "/tmp"))
(allow file-write* (subpath "/tmp"))

; 禁止敏感目录
(deny file-read* (subpath "~/.ssh"))
(deny file-read* (subpath "~/.aws"))
(deny file-read* (subpath "~/.gnupg"))
(deny file-read* (subpath "~/.kube"))
    `.trim();
  }

  /**
   * 生成网络规则
   */
  private generateNetworkRules(): string {
    if (!this.config?.network?.enabled) {
      return "(deny network*)";
    }

    const allowedDomains = this.config.network.allowedDomains || [];
    const deniedDomains = this.config.network.deniedDomains || [];

    let rules = "(allow network-outbound\n";

    allowedDomains.forEach((domain) => {
      rules += `  (remote tcp "${domain}" 443)\n`;
    });

    rules += ")\n";

    deniedDomains.forEach((domain) => {
      rules += `(deny network-outbound (remote tcp "${domain}"))\n`;
    });

    return rules;
  }

  /**
   * 生成文件系统规则
   */
  private generateFilesystemRules(cwd: string): string {
    const filesystem = this.config?.filesystem;
    if (!filesystem) {
      return `
; 默认工作区访问
(allow file-read* (subpath "${cwd}"))
(allow file-write* (subpath "${cwd}"))
      `.trim();
    }

    let rules = "";

    // 允许读取
    (filesystem.allowRead || []).forEach((p) => {
      rules += `(allow file-read* (subpath "${p}"))\n`;
    });

    // 允许写入
    (filesystem.allowWrite || []).forEach((p) => {
      rules += `(allow file-write* (subpath "${p}"))\n`;
    });

    // 禁止读取
    (filesystem.denyRead || []).forEach((p) => {
      rules += `(deny file-read* (subpath "${p}"))\n`;
    });

    // 禁止写入
    (filesystem.denyWrite || []).forEach((p) => {
      rules += `(deny file-write* (subpath "${p}"))\n`;
    });

    return rules;
  }
}
