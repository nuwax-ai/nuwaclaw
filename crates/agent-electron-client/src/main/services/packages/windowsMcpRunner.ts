/**
 * Windows-MCP 进程运行器（Electron 实现）
 *
 * 实现 agent-gui-server 中定义的 ProcessRunner 接口，
 * 使用 ManagedProcess 管理子进程生命周期。
 */

import type {
  ProcessRunner,
  ProcessConfig,
  StartResult,
  StopResult,
} from "agent-gui-server";
import log from "electron-log";
import { ManagedProcess } from "../../processManager";
import { killProcessTreeGraceful } from "../utils/processTree";

/**
 * Electron 进程运行器
 *
 * 使用 ManagedProcess 管理子进程，支持：
 * - 跨平台无窗口启动
 * - 自动日志收集
 * - 优雅停止和强制终止
 */
export class ElectronProcessRunner implements ProcessRunner {
  private process: ManagedProcess;

  constructor() {
    this.process = new ManagedProcess("windows-mcp");
  }

  /**
   * 启动进程
   */
  async start(config: ProcessConfig): Promise<StartResult> {
    const result = await this.process.start({
      command: config.command,
      args: config.args,
      env: config.env,
      cwd: config.cwd,
      startupDelayMs: 5000, // windows-mcp 需要更长的启动时间
    });

    if (result.success) {
      return { success: true };
    }

    return { success: false, error: result.error };
  }

  /**
   * 停止进程
   *
   * Windows 上 uv 会拉起 python/windows-mcp 子进程，仅 kill 父进程常导致子进程残留并占用 GUI MCP 端口（10048）。
   */
  async stop(): Promise<StopResult> {
    const st = this.process.status();
    if (st.running && st.pid != null) {
      await killProcessTreeGraceful(st.pid, 5000).catch((e) => {
        log.warn("[windows-mcp] killProcessTreeGraceful:", e);
      });
    }
    const result = await this.process.stopAsync();
    return { success: result.success, error: result.message };
  }

  /**
   * 获取进程 PID
   */
  getPid(): number | null {
    return this.process.pid ?? null;
  }
}
