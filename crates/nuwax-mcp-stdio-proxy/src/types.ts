/**
 * Types for MCP server configuration
 */

/** stdio 类型: spawn 子进程 */
export interface StdioServerEntry {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

/**
 * Bridge 类型: 连接持久化 MCP Bridge (HTTP)
 *
 * 用于连接 PersistentMcpBridge 等长生命周期的 MCP server。
 * Bridge server 通过 StreamableHTTPClientTransport 访问，
 * 其生命周期独立于 proxy 进程。
 */
export interface BridgeServerEntry {
  url: string;
}

/** @deprecated Use BridgeServerEntry instead */
export type HttpServerEntry = BridgeServerEntry;

export type McpServerEntry = StdioServerEntry | BridgeServerEntry;

export function isBridgeEntry(entry: McpServerEntry): entry is BridgeServerEntry {
  return 'url' in entry && typeof (entry as BridgeServerEntry).url === 'string';
}

/** @deprecated Use isBridgeEntry instead */
export const isHttpEntry = isBridgeEntry;

export interface McpServersConfig {
  mcpServers: Record<string, McpServerEntry>;
}
