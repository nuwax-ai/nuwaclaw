/**
 * GUI MCP 与本地 MCP 配置（mcp_local_config）联动
 *
 * 设置页「启用 GUI MCP」为唯一控制源：
 * - 开启：在 mcp_local_config 中 upsert gui-agent（远程 URL，enabled: true）
 * - 关闭：从 mcp_local_config 中移除 gui-agent
 */

import log from "electron-log";
import { getDb, readSetting, writeSetting } from "../../db";
import { getGuiMcpPort } from "./guiAgentServer";
import { GUI_MCP_SERVER_ID, LOCALHOST_IP } from "@shared/constants";
import { isGuiMcpManagedServerId } from "@shared/guiMcp";
import { FEATURES } from "@shared/featureFlags";
import type { McpServersConfig } from "./mcp";

/** 从 step1_config 读取 guiMcpEnabled 运行时开关 */
export function getGuiMcpEnabled(): boolean {
  try {
    const config = readSetting("step1_config") as {
      guiMcpEnabled?: boolean;
    } | null;
    // 兼容老配置：历史 step1_config 可能没有 guiMcpEnabled 字段，缺省按关闭处理
    return config?.guiMcpEnabled ?? false;
  } catch {
    return false;
  }
}

/** 写入 guiMcpEnabled 到 step1_config */
export function setGuiMcpEnabledFlag(enabled: boolean): void {
  const existing = readSetting("step1_config") as Record<
    string,
    unknown
  > | null;
  writeSetting("step1_config", { ...(existing || {}), guiMcpEnabled: enabled });
}

/** 根据当前 guiMcpPort 构建 GUI MCP 本地 URL */
export function buildGuiMcpLocalUrl(): string {
  const port = getGuiMcpPort();
  return `http://${LOCALHOST_IP}:${port}/mcp`;
}

/** 是否应在服务重启流程中启动 GUI MCP 进程 */
export function shouldStartGuiMcpServices(): boolean {
  return FEATURES.ENABLE_GUI_AGENT_SERVER && getGuiMcpEnabled();
}

/**
 * 按设置页 GUI MCP 开关校正本地 MCP 配置（防止 JSON 编辑绕过列表页锁定）
 * @param guiMcpEnabled 可选的开关状态，避免重复查询数据库
 */
export function applyGuiMcpLocalConfigPolicy(
  config: McpServersConfig,
  guiMcpEnabled?: boolean,
): McpServersConfig {
  const enabled = guiMcpEnabled ?? getGuiMcpEnabled();
  const mcpServers = { ...(config.mcpServers ?? {}) };

  if (!enabled) {
    for (const serverId of Object.keys(mcpServers)) {
      if (isGuiMcpManagedServerId(serverId)) {
        delete mcpServers[serverId];
      }
    }
    return { ...config, mcpServers };
  }

  const existing = mcpServers[GUI_MCP_SERVER_ID];
  if (existing) {
    mcpServers[GUI_MCP_SERVER_ID] = { ...existing, enabled: true };
  }

  return { ...config, mcpServers };
}

/**
 * 将 GUI MCP 开关状态同步到 mcp_local_config
 * @param enabled 是否与设置页 GUI MCP 开关一致（true=添加并强制启用，false=移除）
 */
export function syncGuiAgentLocalMcpConfig(enabled: boolean): void {
  const db = getDb();
  if (!db) {
    log.warn("[GuiMcpLocalConfig] Database not ready, skip sync");
    return;
  }

  const saved = db
    .prepare("SELECT value FROM settings WHERE key = ?")
    .get("mcp_local_config") as { value: string } | undefined;

  let config: McpServersConfig = { mcpServers: {} };
  if (saved?.value) {
    try {
      const parsed = JSON.parse(saved.value) as McpServersConfig;
      config = {
        ...parsed,
        mcpServers:
          parsed?.mcpServers && typeof parsed.mcpServers === "object"
            ? parsed.mcpServers
            : {},
      };
    } catch (e) {
      log.warn(
        "[GuiMcpLocalConfig] Failed to parse mcp_local_config, reset:",
        e,
      );
      config = { mcpServers: {} };
    }
  }

  if (enabled) {
    config.mcpServers[GUI_MCP_SERVER_ID] = {
      url: buildGuiMcpLocalUrl(),
      transport: "streamable-http",
      enabled: true,
    };
  } else {
    delete config.mcpServers[GUI_MCP_SERVER_ID];
  }

  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run(
    "mcp_local_config",
    JSON.stringify(config),
  );

  log.info(
    `[GuiMcpLocalConfig] Synced ${GUI_MCP_SERVER_ID} in mcp_local_config: enabled=${enabled}`,
  );
}
