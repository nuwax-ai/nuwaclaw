/**
 * ttyd IPC Handlers
 *
 * 注册所有 ttyd:* IPC handlers：
 *   ttyd:start       - 启动终端服务（先停再启，含端口清理）
 *   ttyd:stop        - 停止终端服务
 *   ttyd:status      - 查询运行状态
 *   ttyd:getWsUrl    - 返回带 --cwd 参数的 WebSocket URL
 *   ttyd:updateCwd   - 刷新 ttyd-cwd 文件（工作区切换后调用）
 *   ttyd:isAvailable - 检测当前平台是否内置 ttyd 二进制并返回版本号
 */

import { ipcMain } from "electron";
import * as fs from "fs";
import { spawnSync } from "child_process";
import type { HandlerContext } from "@shared/types/ipc";
import { getConfiguredPorts } from "../services/startupPorts";
import { killProcessTreesListeningOnTcpPort } from "../services/utils/processTree";
import { getTtydBinPath } from "../services/system/dependencies";
import {
  getTtydWsUrl,
  getTtydInitialCwd,
  writeTtydCwdFile,
} from "../services/packages/ttydHelper";
import { getServiceManager } from "./processHandlers";

export function registerTtydHandlers(ctx: HandlerContext): void {
  // 幂等：已运行直接复用 startTtyd() 的 short-circuit 行为，避免打断已有终端会话。
  // startTtyd 内部已做端口清理与二进制缺失降级，这里不再 stop+portSweep 重启。
  ipcMain.handle("ttyd:start", async () => {
    return getServiceManager()?.startTtyd();
  });

  // 停止 ttyd：先 ManagedProcess.kill 杀进程树，再扫一遍端口清理孤儿监听。
  // 这里用配置的端口而非 status().port（status() 不返回 port 字段）；
  // 即使用户在 UI 改了端口，clearServicePort 扫新端口找不到也无所谓——
  // 旧进程已被 kill，旧端口的孤儿监听会在 OS 层面自然释放。
  ipcMain.handle("ttyd:stop", async () => {
    const result = await ctx.ttyd.stopAsync(3000);
    await killProcessTreesListeningOnTcpPort(getConfiguredPorts().ttyd).catch(
      () => {},
    );
    return result;
  });

  ipcMain.handle("ttyd:status", () => {
    return ctx.ttyd.status();
  });

  /**
   * 返回带当前工作区 --cwd 参数的 WebSocket URL，供前端建立终端连接时使用。
   * 格式：ws://127.0.0.1:<port>/ws?arg=--cwd&arg=<encoded_workspace>
   * ttyd 的 -a flag 将 URL query 参数透传给 wrapper 脚本 argv，wrapper 解析后 cd 到目标目录。
   */
  ipcMain.handle("ttyd:getWsUrl", () => {
    return getTtydWsUrl();
  });

  /**
   * 刷新 ttyd-cwd 文件（工作区切换后调用）。
   * wrapper 脚本在新终端连接建立时读取此文件，无需重启 ttyd 进程。
   */
  ipcMain.handle("ttyd:updateCwd", () => {
    const cwd = getTtydInitialCwd();
    writeTtydCwdFile(cwd);
    return { success: true, cwd };
  });

  /** 检测当前平台是否内置 ttyd 二进制，同时返回版本号 */
  ipcMain.handle("ttyd:isAvailable", () => {
    const binPath = getTtydBinPath();
    if (!fs.existsSync(binPath)) return { available: false };
    const r = spawnSync(binPath, ["--version"], { timeout: 3000 });
    // 非零退出 / spawn 错误（EACCES 等）一律视为不可用，避免给损坏二进制显示绿勾
    if (r.error || (r.status !== null && r.status !== 0)) {
      return {
        available: false,
        error: r.error?.message ?? `exit=${r.status}`,
      };
    }
    const raw = (r.stdout?.toString() || r.stderr?.toString() || "").trim();
    // ttyd --version 输出：ttyd version 1.7.7-40e79c7
    const m = raw.match(/(\d+\.\d+\.\d+)/);
    return { available: true, version: m?.[1] };
  });
}
