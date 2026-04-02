/**
 * Windows-MCP 管理器（Electron 集成）
 *
 * 提供 Windows 平台下 windows-mcp 服务的启动、停止和状态管理。
 * 集成到 McpProxyManager 的工具聚合流程中。
 */

import * as fs from "fs";
import log from "electron-log";
import { WindowsMcpManager, type ProcessConfig } from "agent-gui-server";
import { ElectronProcessRunner } from "./windowsMcpRunner.js";
import {
  getUvBinPath,
  getAppEnv,
  getWindowsMcpBinPath,
} from "../system/dependencies";
import { isWindows } from "../system/shellEnv";
import { getGuiMcpPort } from "./guiAgentServer";

/**
 * Windows-MCP 管理器实例
 */
export const windowsMcpManager = new WindowsMcpManager({
  healthCheckInterval: 30000,
  startupTimeout: 30000,
  healthCheckTimeout: 5000,
  maxRestarts: 3,
});

// 初始化进程运行器
windowsMcpManager.setProcessRunner(new ElectronProcessRunner());

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
  const status = windowsMcpManager.getStatus();
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
    const result = await windowsMcpManager.start(getGuiMcpPort(), buildConfig);
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

  log.info(`[WindowsMcp] Starting (bundled) on port ${getGuiMcpPort()}...`);

  const result = await windowsMcpManager.start(getGuiMcpPort(), buildConfig);

  if (result.success) {
    log.info(`[WindowsMcp] Started successfully on port ${result.port}`);
  } else {
    log.error(`[WindowsMcp] Failed to start: ${result.error}`);
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
  const result = await windowsMcpManager.stop();

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
  return windowsMcpManager.getStatus();
}

/**
 * 获取 Windows-MCP MCP URL（供 McpProxyManager 使用）
 */
export function getWindowsMcpUrl(): string | null {
  if (!isWindows()) {
    return null;
  }
  const status = windowsMcpManager.getStatus();
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
