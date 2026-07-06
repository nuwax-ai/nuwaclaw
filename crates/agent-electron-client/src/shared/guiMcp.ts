/**
 * GUI MCP 跨进程共享工具（主进程 / 渲染进程均可引用）
 */

import { GUI_MCP_SERVER_ID } from "./constants";

/** 是否为设置页托管的 GUI MCP 条目（Server ID 固定为 gui-agent） */
export function isGuiMcpManagedServerId(serverId: string): boolean {
  return serverId.trim().toLowerCase() === GUI_MCP_SERVER_ID;
}
