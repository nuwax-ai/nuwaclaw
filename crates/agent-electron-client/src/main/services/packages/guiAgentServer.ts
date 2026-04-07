/**
 * GUI Agent Server 管理器（Electron 集成）
 *
 * 提供非 Windows 平台下 agent-gui-server (Node.js MCP server) 的启动、停止和状态管理。
 * agent-gui-server 提供 GUI 桌面自动化能力（截图、鼠标、键盘等 MCP tools）。
 *
 * 端口通过 settings 中的 guiMcpPort 配置（默认 60008），与 agent 会话注入的 MCP URL 对齐。
 * API Key 通过 GUI_AGENT_API_KEY 环境变量传入（复用 anthropic_api_key）。
 */

import * as fs from "fs";
import * as path from "path";
import log from "electron-log";
import { ManagedProcess } from "../../processManager";
import {
  getResourcesPath,
  getNodeBinPathWithFallback,
  getAppEnv,
} from "../system/dependencies";
import { isWindows } from "../system/shellEnv";
import { getDb, readSetting } from "../../db";
import { DEFAULT_GUI_MCP_PORT } from "@shared/constants";
import { killProcessTreesListeningOnTcpPort } from "../utils/processTree";

/** GUI Agent Server 进程名称 */
const PROCESS_NAME = "gui-agent-server";

/**
 * 从 DB 读取 GUI MCP 端口配置
 */
export function getGuiMcpPort(): number {
  try {
    const config = readSetting("step1_config") as {
      guiMcpPort?: number;
    } | null;
    return config?.guiMcpPort ?? DEFAULT_GUI_MCP_PORT;
  } catch {
    return DEFAULT_GUI_MCP_PORT;
  }
}

/**
 * 获取 agent-gui-server 的入口 JS 文件路径
 *
 * 打包后: process.resourcesPath/agent-gui-server/dist/index.js
 * 开发时: {cwd}/resources/agent-gui-server/dist/index.js
 */
function getGuiAgentServerEntryPath(): string | null {
  const resourcesPath = getResourcesPath();
  const entryPath = path.join(
    resourcesPath,
    "agent-gui-server",
    "dist",
    "index.js",
  );
  if (fs.existsSync(entryPath)) {
    return entryPath;
  }
  log.warn(`[GuiAgentServer] Entry file not found: ${entryPath}`);
  return null;
}

/**
 * 从 SQLite 获取 API Key（优先 gui_agent_vision_model 中的 apiKey）
 */
function getApiKeyFromDb(): string | null {
  try {
    const db = getDb();
    if (!db) return null;

    // 优先读取 gui_agent_vision_model 配置中的 apiKey
    const visionConfigRow = db
      .prepare("SELECT value FROM settings WHERE key = ?")
      .get("gui_agent_vision_model") as { value: string } | undefined;

    if (visionConfigRow) {
      const config = JSON.parse(visionConfigRow.value);
      if (config?.apiKey) return config.apiKey;
    }

    // 回退到全局 anthropic_api_key
    const apiKeyRow = db
      .prepare("SELECT value FROM settings WHERE key = ?")
      .get("anthropic_api_key") as { value: string } | undefined;

    return apiKeyRow?.value ?? null;
  } catch (e) {
    log.warn("[GuiAgentServer] Failed to read API Key:", e);
    return null;
  }
}

/**
 * 检查视觉模型是否已配置
 */
function checkVisionModelConfigured(): boolean {
  try {
    const db = getDb();
    if (!db) return false;

    const visionConfigRow = db
      .prepare("SELECT value FROM settings WHERE key = ?")
      .get("gui_agent_vision_model") as { value: string } | undefined;

    if (visionConfigRow) {
      const config = JSON.parse(visionConfigRow.value);
      if (config?.apiKey && config?.model) return true;
    }

    return false;
  } catch (e) {
    return false;
  }
}

/**
 * 获取视觉模型名称
 */
function getVisionModelName(): string | null {
  try {
    const db = getDb();
    if (!db) return null;

    const visionConfigRow = db
      .prepare("SELECT value FROM settings WHERE key = ?")
      .get("gui_agent_vision_model") as { value: string } | undefined;

    if (visionConfigRow) {
      const config = JSON.parse(visionConfigRow.value);
      if (config?.model) return config.model;
    }

    return null;
  } catch (e) {
    return null;
  }
}

// ========== 状态管理 ==========

let processInstance: ManagedProcess | null = null;
let running = false;
let runningPort: number | null = null;
let lastError: string | null = null;

/**
 * 启动 GUI Agent Server
 *
 * 仅在非 Windows 平台有效。Windows 平台使用 windows-mcp（见 windowsMcp.ts）。
 */
export async function startGuiAgentServer(): Promise<{
  success: boolean;
  port?: number;
  error?: string;
}> {
  // Windows 平台跳过（使用 windows-mcp）
  if (isWindows()) {
    log.info("[GuiAgentServer] Skipped: Windows platform uses windows-mcp");
    return { success: true };
  }

  // 已运行则直接返回
  if (running && processInstance && runningPort !== null) {
    return { success: true, port: runningPort };
  }

  // 读取配置的端口
  const port = getGuiMcpPort();

  // 启动前清理占用该端口的残留进程（跨平台实现）
  try {
    log.info(`[GuiAgentServer] Pre-start port sweep for ${port}...`);
    await killProcessTreesListeningOnTcpPort(port);
    await new Promise((r) => setTimeout(r, 450));
  } catch (e) {
    log.warn("[GuiAgentServer] Pre-start port sweep:", e);
  }

  // 解析入口文件
  const entryPath = getGuiAgentServerEntryPath();
  if (!entryPath) {
    const error = `agent-gui-server 入口文件未找到，请先运行 npm run prepare:gui-server`;
    log.error(`[GuiAgentServer] ${error}`);
    return { success: false, error };
  }

  // 检查 Node.js 可用性
  const nodeBinPath = getNodeBinPathWithFallback();
  if (!nodeBinPath) {
    const error = "Node.js 未找到，GUI Agent Server 无法启动";
    log.error(`[GuiAgentServer] ${error}`);
    return { success: false, error };
  }

  // 获取 API Key
  const apiKey = getApiKeyFromDb();
  if (!apiKey) {
    log.warn(
      "[GuiAgentServer] 未找到 API Key，GUI Agent Server 可能无法正常工作",
    );
  }

  // 检查视觉模型是否配置
  const hasVisionModel = checkVisionModelConfigured();
  const visionModelName = getVisionModelName();

  // 构建环境变量
  const env: Record<string, string> = {
    ...getAppEnv(),
    GUI_AGENT_API_KEY: apiKey ?? "",
    // 明确指定传输协议和端口
    GUI_AGENT_TRANSPORT: "http",
    GUI_AGENT_PORT: port.toString(),
    // 传递视觉模型名称，无配置则为空（用于在 MCP 工具列表中禁用 gui_analyze_screen）
    GUI_AGENT_VISION_MODEL: hasVisionModel ? (visionModelName ?? "") : "",
    // 禁用遥测
    ANONYMIZED_TELEMETRY: "false",
  };

  // 构建启动参数
  const args = [entryPath, "--port", port.toString(), "--transport", "http"];

  // 创建并启动进程
  processInstance = new ManagedProcess(PROCESS_NAME);

  log.info(`[GuiAgentServer] Starting on port ${port}...`);
  log.info(`[GuiAgentServer] Entry: ${entryPath}`);

  try {
    const result = await processInstance.start({
      command: nodeBinPath,
      args,
      env,
      startupDelayMs: 5000, // GUI Agent Server 需要较长的启动时间
      onStdoutLine: (line) => {
        // 转发到 electron-log
        if (line.trim()) {
          log.info(`[GuiAgentServer] ${line}`);
        }
      },
    });

    if (!result.success) {
      lastError = result.error ?? "Failed to start";
      running = false;
      runningPort = null;
      processInstance = null;
      log.error(`[GuiAgentServer] Failed to start: ${lastError}`);
      return { success: false, error: lastError };
    }

    running = true;
    runningPort = port;
    lastError = null;
    log.info(`[GuiAgentServer] Started successfully on port ${port}`);
    return { success: true, port };
  } catch (e) {
    const errorMsg = e instanceof Error ? e.message : String(e);
    lastError = errorMsg;
    running = false;
    runningPort = null;
    processInstance = null;
    log.error(`[GuiAgentServer] Start exception: ${errorMsg}`);
    return { success: false, error: errorMsg };
  }
}

/**
 * 停止 GUI Agent Server
 */
export async function stopGuiAgentServer(): Promise<{
  success: boolean;
  error?: string;
}> {
  if (!running || !processInstance) {
    running = false;
    runningPort = null;
    return { success: true };
  }

  log.info("[GuiAgentServer] Stopping...");

  // 兜底：ManagedProcess 进程可能已退出但端口仍被占用（如子进程残留）
  try {
    await killProcessTreesListeningOnTcpPort(getGuiMcpPort());
  } catch (e) {
    log.warn("[GuiAgentServer] TCP port sweep after stop:", e);
  }

  try {
    const result = await processInstance.stopAsync();
    running = false;
    runningPort = null;
    processInstance = null;

    if (result.success) {
      log.info("[GuiAgentServer] Stopped successfully");
      return { success: true };
    } else {
      log.error(`[GuiAgentServer] Stop failed: ${result.message}`);
      return { success: false, error: result.message };
    }
  } catch (e) {
    const errorMsg = e instanceof Error ? e.message : String(e);
    running = false;
    runningPort = null;
    processInstance = null;
    log.error(`[GuiAgentServer] Stop exception: ${errorMsg}`);
    return { success: false, error: errorMsg };
  }
}

/**
 * 获取 GUI Agent Server 运行状态
 */
export function getGuiAgentServerStatus(): {
  running: boolean;
  port?: number;
  error?: string | null;
} {
  return {
    running,
    port: running ? (runningPort ?? undefined) : undefined,
    error: lastError,
  };
}

/**
 * 获取 GUI Agent Server MCP URL（供 Agent 引擎注入使用）
 *
 * 返回 http://127.0.0.1:{runningPort}/mcp，使用实际运行的端口。
 * 仅在非 Windows 平台且内嵌 gui 服务已启动时返回非 null。
 * Windows 桌面自动化由 windows-mcp 提供，请使用 getWindowsMcpUrl()（见 acpEngine）。
 */
export function getGuiAgentServerUrl(): string | null {
  if (isWindows()) {
    return null;
  }
  if (!running || runningPort === null) {
    return null;
  }
  return `http://127.0.0.1:${runningPort}/mcp`;
}

/**
 * 检查 GUI Agent Server 是否可用（入口文件存在且非 Windows）
 */
export function isGuiAgentServerAvailable(): boolean {
  if (isWindows()) {
    return false;
  }
  const entryPath = getGuiAgentServerEntryPath();
  return entryPath !== null;
}
