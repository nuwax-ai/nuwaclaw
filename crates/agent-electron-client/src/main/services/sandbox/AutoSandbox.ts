/**
 * 自动沙箱 - 根据平台自动选择实现
 *
 * @version 1.0.0
 * @created 2026-03-27
 */

import * as os from "os";
import log from "electron-log";
import type {
  SandboxInterface,
  SandboxConfig,
  ExecuteOptions,
  ExecuteResult,
  SandboxStatus,
} from "./types";
import { MacSandbox } from "./MacSandbox";

export class AutoSandbox implements SandboxInterface {
  private sandbox: SandboxInterface;
  private config: SandboxConfig | null = null;

  /**
   * 初始化沙箱
   */
  async initialize(config: SandboxConfig): Promise<void> {
    this.config = config;

    // 如果沙箱关闭，使用无沙箱实现
    if (config.mode === "off") {
      log.info("[AutoSandbox] Sandbox disabled, using unsandboxed execution");
      this.sandbox = new NoneSandbox();
      await this.sandbox.initialize(config);
      return;
    }

    // 根据平台选择实现
    const platform = os.platform();

    switch (platform) {
      case "darwin":
        log.info("[AutoSandbox] Using macOS Seatbelt sandbox");
        this.sandbox = new MacSandbox();
        break;

      case "linux":
        log.info("[AutoSandbox] Using Linux bubblewrap sandbox");
        const { LinuxSandbox } = await import("./LinuxSandbox");
        this.sandbox = new LinuxSandbox();
        break;

      case "win32":
        log.info("[AutoSandbox] Using Windows Codex sandbox");
        const { WindowsSandbox } = await import("./WindowsSandbox");
        this.sandbox = new WindowsSandbox();
        break;

      default:
        log.warn(
          `[AutoSandbox] Unsupported platform: ${platform}, using unsandboxed execution`,
        );
        this.sandbox = new NoneSandbox();
    }

    await this.sandbox.initialize(config);
  }

  /**
   * 执行命令
   */
  async execute(
    command: string,
    cwd: string,
    options?: ExecuteOptions,
  ): Promise<ExecuteResult> {
    if (!this.sandbox) {
      throw new Error("Sandbox not initialized");
    }
    return this.sandbox.execute(command, cwd, options);
  }

  /**
   * 读取文件
   */
  async readFile(path: string): Promise<string> {
    if (!this.sandbox) {
      throw new Error("Sandbox not initialized");
    }
    return this.sandbox.readFile(path);
  }

  /**
   * 写入文件
   */
  async writeFile(path: string, content: string): Promise<void> {
    if (!this.sandbox) {
      throw new Error("Sandbox not initialized");
    }
    return this.sandbox.writeFile(path, content);
  }

  /**
   * 检查是否可用
   */
  async isAvailable(): Promise<boolean> {
    if (!this.sandbox) {
      return false;
    }
    return this.sandbox.isAvailable();
  }

  /**
   * 获取状态
   */
  getStatus(): SandboxStatus {
    if (!this.sandbox) {
      return {
        available: false,
        type: "none",
        platform: os.platform(),
      };
    }
    return this.sandbox.getStatus();
  }

  /**
   * 清理资源
   */
  async cleanup(): Promise<void> {
    if (this.sandbox) {
      await this.sandbox.cleanup();
    }
  }
}

/**
 * 无沙箱实现（降级方案）
 */
class NoneSandbox implements SandboxInterface {
  private config: SandboxConfig | null = null;

  async initialize(config: SandboxConfig): Promise<void> {
    this.config = config;
  }

  async execute(
    command: string,
    cwd: string,
    options?: ExecuteOptions,
  ): Promise<ExecuteResult> {
    const { spawn } = require("child_process");

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

      proc.stdout?.on("data", (data: Buffer) => {
        stdout += data.toString();
        options?.onOutput?.(data.toString());
      });

      proc.stderr?.on("data", (data: Buffer) => {
        stderr += data.toString();
        options?.onOutput?.(data.toString());
      });

      proc.on("close", (code: number) => {
        resolve({
          exitCode: code ?? -1,
          stdout,
          stderr,
        });
      });

      proc.on("error", reject);
    });
  }

  async readFile(path: string): Promise<string> {
    const fs = require("fs").promises;
    return fs.readFile(path, "utf-8");
  }

  async writeFile(path: string, content: string): Promise<void> {
    const fs = require("fs").promises;
    return fs.writeFile(path, content, "utf-8");
  }

  async isAvailable(): Promise<boolean> {
    return true;
  }

  getStatus(): SandboxStatus {
    return {
      available: true,
      type: "none",
      platform: os.platform(),
    };
  }

  async cleanup(): Promise<void> {
    // 无需清理
  }
}
