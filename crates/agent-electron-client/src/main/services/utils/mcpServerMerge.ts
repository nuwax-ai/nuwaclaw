import type { McpServerEntry } from "../packages/mcp";

type McpServerRecord<T> = Record<string, T>;

/**
 * 按层合并 MCP 配置：后出现的同 key 覆盖先前的（用于「默认/远程 + 本地」，本地应放在最后）。
 * 在配置层去重，避免同名 MCP 进入 proxy / session 两次。
 */
export function mergeMcpServerConfigs<T extends McpServerEntry>(
  ...layers: Array<McpServerRecord<T> | undefined | null>
): McpServerRecord<T> {
  const merged = {} as McpServerRecord<T>;
  for (const layer of layers) {
    if (!layer) continue;
    for (const [name, entry] of Object.entries(layer)) {
      if (entry) {
        merged[name] = entry;
      }
    }
  }
  return merged;
}

/**
 * 仅保留 enabled !== false 的 MCP（与 UnifiedAgent / mcp:setConfig 同步逻辑一致）。
 */
export function filterEnabledMcpServers(
  servers: Record<string, McpServerEntry>,
): Record<string, McpServerEntry> {
  const enabled: Record<string, McpServerEntry> = {};
  for (const [name, entry] of Object.entries(servers)) {
    if (!entry) continue;
    const isEnabled = !("enabled" in entry) || entry.enabled !== false;
    if (isEnabled) {
      enabled[name] = entry;
    }
  }
  return enabled;
}

/**
 * 远程/默认 context_servers 与本地 mcp_local_config 合并：同名 key 以本地为准。
 */
export function mergeRemoteAndLocalMcpConfigs(
  remote: Record<string, McpServerEntry>,
  local: Record<string, McpServerEntry>,
): Record<string, McpServerEntry> {
  return mergeMcpServerConfigs(remote, local);
}
