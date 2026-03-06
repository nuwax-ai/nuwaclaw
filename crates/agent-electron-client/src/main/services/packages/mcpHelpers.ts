/**
 * MCP Helper Utilities
 *
 * Pure functions for MCP server configuration comparison and filtering.
 * No Electron or side-effectful dependencies — safe to import anywhere,
 * including test files without additional mocks.
 */

import * as path from 'path';
import type { McpServerEntry } from './mcp';

/**
 * 从 MCP server 配置中过滤掉 bridge 聚合入口
 * （command 为 "mcp-proxy" 或其绝对路径形式）。
 *
 * 用于 detectConfigChange 和 engineRawMcpServers 的原始格式快照存储。
 */
export function filterBridgeEntries(
  servers: Record<string, McpServerEntry>,
): Record<string, McpServerEntry> {
  const result: Record<string, McpServerEntry> = {};
  for (const [name, entry] of Object.entries(servers)) {
    if ('command' in entry && (entry.command === 'mcp-proxy' || path.basename(entry.command) === 'mcp-proxy')) continue;
    result[name] = entry;
  }
  return result;
}

/**
 * 比较两组原始 MCP server 配置是否语义等价。
 *
 * 只比较决定进程行为的字段：command / args / allowTools / denyTools / url（远程 server）。
 * 故意忽略 env：env 由 getAppEnv() 每次注入，内容固定，不触发引擎重建。
 *
 * @param a 本次请求传入的原始 MCP servers（已过滤掉 mcp-proxy 入口）
 * @param b 上次存储的原始 MCP servers；undefined 表示首次（无历史快照）
 */
export function rawMcpServersEqual(
  a: Record<string, McpServerEntry>,
  b: Record<string, McpServerEntry> | undefined,
): boolean {
  if (!b) return false;
  const aKeys = Object.keys(a).sort();
  const bKeys = Object.keys(b).sort();
  if (aKeys.join('\0') !== bKeys.join('\0')) return false;
  for (const key of aKeys) {
    const ea = a[key];
    const eb = b[key];
    // 远程 server：只比较 URL
    if ('url' in ea || 'url' in eb) {
      if (('url' in ea ? ea.url : undefined) !== ('url' in eb ? eb.url : undefined)) return false;
      continue;
    }
    // stdio server：比较 command / args / allowTools / denyTools
    // 同名 key 类型不一致（一方有 command，另一方没有）→ 视为不等，触发重建
    if (!('command' in ea) || !('command' in eb)) return false;
    if (ea.command !== eb.command) return false;
    if (JSON.stringify(ea.args ?? []) !== JSON.stringify(eb.args ?? [])) return false;
    // 对数组型字段排序后比较，避免顺序差异误判
    const sortedAllowA = [...(ea.allowTools ?? [])].sort().join('\0');
    const sortedAllowB = [...(eb.allowTools ?? [])].sort().join('\0');
    if (sortedAllowA !== sortedAllowB) return false;
    const sortedDenyA = [...(ea.denyTools ?? [])].sort().join('\0');
    const sortedDenyB = [...(eb.denyTools ?? [])].sort().join('\0');
    if (sortedDenyA !== sortedDenyB) return false;
  }
  return true;
}
