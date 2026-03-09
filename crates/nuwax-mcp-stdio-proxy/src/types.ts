/**
 * Types for MCP server configuration
 */

/** stdio 类型: spawn 子进程 */
export interface StdioServerEntry {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  /** 工具白名单（只暴露指定工具） */
  allowTools?: string[];
  /** 工具黑名单（排除指定工具） */
  denyTools?: string[];
  /** Connection initialization timeout (ms). Defaults to 60000 for stdio. */
  connectionTimeoutMs?: number;
}

/**
 * Streamable HTTP 类型: 连接远程 MCP server (Streamable HTTP)
 *
 * 用于连接 PersistentMcpBridge 等长生命周期的 MCP server，
 * 或直接连接支持 Streamable HTTP 协议的远程 MCP 服务。
 */
export interface StreamableServerEntry {
  url: string;
  transport?: 'streamable-http';
  headers?: Record<string, string>;
  authToken?: string;
  /** 工具白名单（只暴露指定工具） */
  allowTools?: string[];
  /** 工具黑名单（排除指定工具） */
  denyTools?: string[];
  /** Heartbeat ping interval configuration (ms) */
  pingIntervalMs?: number;
  /** Heartbeat ping timeout configuration (ms) */
  pingTimeoutMs?: number;
  /** Connection initialization timeout (ms). Defaults to 30000. */
  connectionTimeoutMs?: number;
}

/**
 * SSE 类型: 连接远程 MCP server (Server-Sent Events)
 *
 * 用于连接支持 SSE 传输的远程 MCP 服务（旧版 MCP 协议）。
 */
export interface SseServerEntry {
  url: string;
  transport: 'sse';
  headers?: Record<string, string>;
  authToken?: string;
  /** 工具白名单（只暴露指定工具） */
  allowTools?: string[];
  /** 工具黑名单（排除指定工具） */
  denyTools?: string[];
  /** Heartbeat ping interval configuration (ms) */
  pingIntervalMs?: number;
  /** Heartbeat ping timeout configuration (ms) */
  pingTimeoutMs?: number;
  /** Connection initialization timeout (ms). Defaults to 30000. */
  connectionTimeoutMs?: number;
}

export type McpServerEntry = StdioServerEntry | StreamableServerEntry | SseServerEntry;

export function isSseEntry(entry: McpServerEntry): entry is SseServerEntry {
  return 'url' in entry && (entry as SseServerEntry).transport === 'sse';
}

export function isStreamableEntry(entry: McpServerEntry): entry is StreamableServerEntry {
  return (
    'url' in entry &&
    typeof (entry as StreamableServerEntry).url === 'string' &&
    (entry as StreamableServerEntry).transport === 'streamable-http'
  );
}

/** Check if URL entry has no explicit transport → needs auto-detection */
export function needsProtocolDetection(entry: McpServerEntry): entry is StreamableServerEntry {
  return (
    'url' in entry &&
    typeof (entry as StreamableServerEntry).url === 'string' &&
    !isSseEntry(entry) &&
    !isStreamableEntry(entry)
  );
}

/** @deprecated Use StreamableServerEntry instead */
export type BridgeServerEntry = StreamableServerEntry;

/** @deprecated Use StreamableServerEntry instead */
export type HttpServerEntry = StreamableServerEntry;

/** @deprecated Use isStreamableEntry instead */
export const isBridgeEntry = isStreamableEntry;

/** @deprecated Use isStreamableEntry instead */
export const isHttpEntry = isStreamableEntry;

export interface McpServersConfig {
  mcpServers: Record<string, McpServerEntry>;
}
