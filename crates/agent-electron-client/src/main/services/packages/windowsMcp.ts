/**
 * Windows-MCP 管理器（Electron 集成）
 *
 * 提供 Windows 平台下 windows-mcp 服务的启动、停止和状态管理。
 * 集成到 McpProxyManager 的工具聚合流程中。
 */

import * as path from "path";
import { createRequire } from "module";
import log from "electron-log";
import { ElectronProcessRunner } from "./windowsMcpRunner.js";
import {
  getAppEnv,
  getWindowsMcpBinPath,
  getResourcesPath,
} from "../system/dependencies";
import { isWindows } from "../system/shellEnv";
import { getGuiMcpPort } from "./guiAgentServer";
import { killProcessTreesListeningOnTcpPort } from "../utils/processTree";
import { t } from "../i18n";

type WindowsMcpManagerType = import("agent-gui-server").WindowsMcpManager;
type ProcessConfig = import("agent-gui-server").ProcessConfig;

/**
 * Windows-MCP 管理器实例（延迟初始化，仅 Windows 平台有效）
 */
let windowsMcpManager: WindowsMcpManagerType | null = null;
let processRunner: ElectronProcessRunner | null = null;
const runtimeRequire = createRequire(__filename);

/**
 * 为 bundled windows-mcp 构建运行环境
 *
 * 关键点：
 * - 重写 getAppEnv() 注入的关键 UV_* 路径变量，避免 uv trampoline 指向全局工具目录。
 * - bundled windows-mcp 应始终使用其自身安装目录（extraResources/windows-mcp）解析脚本路径。
 * - 保持 UV_NO_INSTALL=1，确保缺失时快速失败，不触发联网安装兜底。
 */
function buildBundledWindowsMcpEnv(
  windowsMcpBinPath: string,
): Record<string, string> {
  const env: Record<string, string> = {
    ...getAppEnv({ includeSystemPath: true }),
    ANONYMIZED_TELEMETRY: "false",
  };

  const windowsMcpRoot = path.dirname(path.dirname(windowsMcpBinPath));
  const bundledToolDir = path.join(windowsMcpRoot, ".uv-tool");
  const bundledToolBinDir = path.join(windowsMcpRoot, "bin");

  // 仅修正会影响 uv trampoline 定位脚本路径的变量。
  // 注意：不移除 PATH 中的 bundled uv，其他模块仍可正常使用应用内 uv。
  env.UV_TOOL_DIR = bundledToolDir;
  env.UV_TOOL_BIN_DIR = bundledToolBinDir;
  env.UV_NO_INSTALL = "1";
  log.info(
    `[WindowsMcp] Using bundled UV tool dirs: UV_TOOL_DIR=${bundledToolDir}, UV_TOOL_BIN_DIR=${bundledToolBinDir}`,
  );

  return env;
}

/**
 * 延迟加载并初始化 WindowsMcpManager
 * 仅在 Windows 平台调用，且只在首次使用时初始化
 */
function getWindowsMcpManager(): WindowsMcpManagerType {
  if (!isWindows()) {
    throw new Error("WindowsMcpManager is only available on Windows");
  }
  if (!windowsMcpManager) {
    // 从打包的 extraResources 中直接 require CJS SDK bundle
    const resourcesPath = getResourcesPath();
    const libBundlePath = path.join(
      resourcesPath,
      "agent-gui-server",
      "dist",
      "lib.bundle.cjs",
    );
    const { WindowsMcpManager: WMM } = runtimeRequire(libBundlePath) as {
      WindowsMcpManager: new (cfg: {
        healthCheckInterval: number;
        startupTimeout: number;
        healthCheckTimeout: number;
        maxRestarts: number;
      }) => WindowsMcpManagerType;
    };
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
    const error =
      "Bundled windows-mcp not found. Packaging is incomplete; fallback is disabled.";
    log.error(`[WindowsMcp] ${error}`);
    return { success: false, error };
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
    cwd: path.dirname(windowsMcpBinPath),
    env: buildBundledWindowsMcpEnv(windowsMcpBinPath),
  });

  const port = getGuiMcpPort();
  // 启动前再扫一次端口：自动拉起、仅失败重试等路径未必先经过 stop；避免 10048
  try {
    log.info(`[WindowsMcp] Pre-start port sweep for ${port}...`);
    await killProcessTreesListeningOnTcpPort(port);
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
      error: `${err} — ${t("Claw.WindowsMcp.portInUseHint", { port: String(port) })}`,
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
    await killProcessTreesListeningOnTcpPort(getGuiMcpPort());
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
  return getWindowsMcpBinPath() !== null;
}
