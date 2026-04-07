/**
 * Windows-MCP 管理器（Electron 集成）
 *
 * 提供 Windows 平台下 windows-mcp 服务的启动、停止和状态管理。
 * 集成到 McpProxyManager 的工具聚合流程中。
 */

import * as fs from "fs";
import * as path from "path";
import log from "electron-log";
import { ElectronProcessRunner } from "./windowsMcpRunner.js";
import {
  getUvBinPath,
  getAppEnv,
  getWindowsMcpBinPath,
  getResourcesPath,
} from "../system/dependencies";
import { isWindows } from "../system/shellEnv";
import { getGuiMcpPort } from "./guiAgentServer";
import { killProcessTreesListeningOnTcpPortWindows } from "../utils/processTree";

type WindowsMcpManagerType = import("agent-gui-server").WindowsMcpManager;
type ProcessConfig = import("agent-gui-server").ProcessConfig;

/**
 * Windows-MCP 管理器实例（延迟初始化，仅 Windows 平台有效）
 */
let windowsMcpManager: WindowsMcpManagerType | null = null;
let processRunner: ElectronProcessRunner | null = null;

/**
 * 延迟加载并初始化 WindowsMcpManager
 * 仅在 Windows 平台调用，且只在首次使用时初始化
 */
function getWindowsMcpManager(): WindowsMcpManagerType {
  if (!isWindows()) {
    throw new Error("WindowsMcpManager 仅在 Windows 平台可用");
  }
  if (!windowsMcpManager) {
    // 从打包的 extraResources 中动态加载 agent-gui-server
    const resourcesPath = getResourcesPath();
    const agentGuiServerPath = path.join(resourcesPath, "agent-gui-server");
    const createRequire = require("module").createRequire;
    // 注意：createRequire 以传入路径的父目录为基准进行模块解析
    // 传入 agentGuiServerPath（= resources/agent-gui-server/），而非 dist/index.js
    const loaderRequire = createRequire(agentGuiServerPath);
    const { WindowsMcpManager: WMM } = loaderRequire("agent-gui-server");
    windowsMcpManager = new WMM({
      healthCheckInterval: 30000,
      startupTimeout: 30000,
      healthCheckTimeout: 5000,
      maxRestarts: 3,
    });
    processRunner = new ElectronProcessRunner();
    windowsMcpManager!.setProcessRunner(processRunner!);
    log.info(
      "[WindowsMcp] WindowsMcpManager initialized from bundled agent-gui-server",
    );
  }
  return windowsMcpManager!;
}

/**
 * 启动 Windows-MCP 服务
 *
 * 仅在 Windows 平台上有效。其他平台返回成功但实际不执行任何操作。
 */
export async function startWindowsMcp(): Promise<{
  success: boolean;
  port?: number;
  error?: string;
}> {
  // 非 Windows 平台跳过
  if (!isWindows()) {
    log.info("[WindowsMcp] Skipped: not Windows platform");
    return { success: true };
  }

  // 检查是否已运行
  const status = getWindowsMcpManager().getStatus();
  if (status.running) {
    return { success: true, port: status.port };
  }

  // 检查 bundled windows-mcp 是否可用
  const windowsMcpBinPath = getWindowsMcpBinPath();
  if (!windowsMcpBinPath) {
    // 回退到 uv tool run（首次安装或打包不完整时）
    const uvPath = getUvBinPath();
    if (!uvPath || !fs.existsSync(uvPath)) {
      const error =
        "uv not found and windows-mcp not bundled. Please install uv.";
      log.warn(`[WindowsMcp] ${error}`);
      return { success: false, error };
    }
    log.info("[WindowsMcp] Using uv tool run (bundled not found)");
    const buildConfig = (_port: number): ProcessConfig => ({
      command: uvPath,
      args: [
        "tool",
        "run",
        "windows-mcp",
        "--transport",
        "streamable-http",
        "--host",
        "127.0.0.1",
        "--port",
        getGuiMcpPort().toString(),
      ],
      env: {
        ...getAppEnv({ includeSystemPath: true }),
        // 禁用遥测
        ANONYMIZED_TELEMETRY: "false",
      },
    });
    log.info(
      `[WindowsMcp] Starting (uv tool run) on port ${getGuiMcpPort()}...`,
    );
    const result = await getWindowsMcpManager().start(
      getGuiMcpPort(),
      buildConfig,
    );
    if (result.success) {
      log.info(`[WindowsMcp] Started successfully on port ${result.port}`);
    } else {
      log.error(`[WindowsMcp] Failed to start: ${result.error}`);
    }
    return result;
  }

  // 构建进程配置（使用打包的二进制）
  // 注意：_port 参数被忽略，端口从 DB 配置读取（通过 getGuiMcpPort()）
  // 这是因为 windows-mcp 的端口由启动参数决定，而不是由 McpProxyManager 分配
  const buildConfig = (_port: number): ProcessConfig => ({
    command: windowsMcpBinPath,
    args: [
      "--transport",
      "streamable-http",
      "--host",
      "127.0.0.1",
      "--port",
      getGuiMcpPort().toString(),
    ],
    env: {
      ...getAppEnv({ includeSystemPath: true }),
      // 禁用遥测
      ANONYMIZED_TELEMETRY: "false",
    },
  });

  const port = getGuiMcpPort();
  // 启动前再扫一次端口：自动拉起、仅失败重试等路径未必先经过 stop；避免 10048
  try {
    log.info(`[WindowsMcp] Pre-start port sweep for ${port}...`);
    await killProcessTreesListeningOnTcpPortWindows(port);
    await new Promise((r) => setTimeout(r, 450));
  } catch (e) {
    log.warn("[WindowsMcp] Pre-start port sweep:", e);
  }

  log.info(`[WindowsMcp] Starting (bundled) on port ${port}...`);

  const result = await getWindowsMcpManager().start(port, buildConfig);

  if (result.success) {
    log.info(`[WindowsMcp] Started successfully on port ${result.port}`);
    return result;
  }

  log.error(`[WindowsMcp] Failed to start: ${result.error}`);
  const err = result.error ?? "";
  const likelyPortConflict =
    err.includes("立即退出") ||
    err.includes("10048") ||
    err.includes("EADDRINUSE") ||
    err.includes("Address already in use") ||
    err.includes("ready within timeout");
  if (likelyPortConflict) {
    return {
      success: false,
      error: `${err} — 常见原因：${port} 端口已被占用。可稍后重试、在设置中更换 GUI MCP 端口，或在任务管理器中结束相关进程。`,
    };
  }
  return result;
}

/**
 * 停止 Windows-MCP 服务
 */
export async function stopWindowsMcp(): Promise<{
  success: boolean;
  error?: string;
}> {
  if (!isWindows()) {
    return { success: true };
  }

  log.info("[WindowsMcp] Stopping...");
  const result = await getWindowsMcpManager().stop();

  // 兜底：uv 先退出时 ManagedProcess 可能已无 PID，子进程仍 LISTENING GUI MCP 端口
  try {
    await killProcessTreesListeningOnTcpPortWindows(getGuiMcpPort());
  } catch (e) {
    log.warn("[WindowsMcp] TCP port sweep after stop:", e);
  }

  if (result.success) {
    log.info("[WindowsMcp] Stopped successfully");
  } else {
    log.error(`[WindowsMcp] Failed to stop: ${result.error}`);
  }

  return result;
}

/**
 * 获取 Windows-MCP 状态
 */
export function getWindowsMcpStatus() {
  if (!isWindows()) {
    return { running: false };
  }
  return getWindowsMcpManager().getStatus();
}

/**
 * 获取 Windows-MCP MCP URL（供 McpProxyManager 使用）
 */
export function getWindowsMcpUrl(): string | null {
  if (!isWindows()) {
    return null;
  }
  const status = getWindowsMcpManager().getStatus();
  if (!status.running || status.port === undefined) {
    return null;
  }
  return `http://127.0.0.1:${status.port}/mcp`;
}

/**
 * 检查 Windows-MCP 是否可用（Windows 平台且 bundled 或 uv 可用）
 */
export function isWindowsMcpAvailable(): boolean {
  if (!isWindows()) {
    return false;
  }

  // 优先检查打包的二进制
  const bundledPath = getWindowsMcpBinPath();
  if (bundledPath) {
    return true;
  }

  // 回退到 uv
  const uvPath = getUvBinPath();
  return uvPath !== null && fs.existsSync(uvPath);
}
