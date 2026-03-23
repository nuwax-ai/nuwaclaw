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
import { getUvBinPath, getAppEnv } from "../system/dependencies";
import { isWindows } from "../system/shellEnv";
import { isPortInUse } from "../startupPorts";

/** Windows-MCP 端口范围 */
const WINDOWS_MCP_PORT_RANGE = {
  min: 60020,
  max: 60029,
};

/** Windows-MCP 默认端口 */
const DEFAULT_WINDOWS_MCP_PORT = 60020;

/**
 * 查找可用端口
 *
 * 从指定范围查找未被占用的端口。
 */
function findAvailablePort(range: { min: number; max: number }): number {
  for (let port = range.min; port <= range.max; port++) {
    const { inUse } = isPortInUse(port);
    if (!inUse) {
      return port;
    }
  }
  // 如果所有端口都被占用，返回默认端口（启动时会失败）
  log.warn(
    `[WindowsMcp] No available port in range ${range.min}-${range.max}, using default ${DEFAULT_WINDOWS_MCP_PORT}`,
  );
  return DEFAULT_WINDOWS_MCP_PORT;
}

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

  // 检查 uv 是否可用
  const uvPath = getUvBinPath();
  if (!uvPath || !fs.existsSync(uvPath)) {
    const error = "uv not found. Windows-MCP requires uv to be installed.";
    log.warn(`[WindowsMcp] ${error}`);
    return { success: false, error };
  }

  // 查找可用端口
  const port = findAvailablePort(WINDOWS_MCP_PORT_RANGE);

  // 构建进程配置
  const buildConfig = (p: number): ProcessConfig => ({
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
      p.toString(),
    ],
    env: {
      ...getAppEnv({ includeSystemPath: true }),
      // 禁用遥测
      ANONYMIZED_TELEMETRY: "false",
    },
  });

  log.info(`[WindowsMcp] Starting on port ${port}...`);

  const result = await windowsMcpManager.start(port, buildConfig);

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
  return windowsMcpManager.getMcpUrl();
}

/**
 * 检查 Windows-MCP 是否可用（Windows 平台且 uv 已安装）
 */
export function isWindowsMcpAvailable(): boolean {
  if (!isWindows()) {
    return false;
  }

  const uvPath = getUvBinPath();
  return uvPath !== null && fs.existsSync(uvPath);
}
