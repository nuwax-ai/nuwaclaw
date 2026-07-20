/**
 * MCP server 名称规范化（ACP / LLM 工具 API 兼容）。
 *
 * Anthropic / OpenAI 兼容代理要求工具 function.name 匹配 `^[a-zA-Z0-9_-]+$`。
 * 用户本地 MCP 配置可能含中文（如「A股股票查询」），需在发给 Agent（ACP session/new）
 * 前规范化。本地 SQLite / UI 仍保留原始显示名，仅 ACP 边界替换。
 *
 * 与 deepagents-flow-ts `sanitize-mcp-name.ts` 保持同一规则。
 */

/** LLM function.name 允许的字符集。 */
export const MCP_IDENTIFIER_PATTERN = /^[a-zA-Z0-9_-]+$/;

/**
 * 将 MCP server 名规范为 LLM 可接受的标识符。
 * 非 `[a-zA-Z0-9_-]` → `_`，合并连续 `_`，去掉首尾 `_`。
 */
export function sanitizeMcpServerName(raw: string): string {
  let s = raw.replace(/[^a-zA-Z0-9_-]/g, "_");
  s = s.replace(/_+/g, "_").replace(/^_|_$/g, "");
  if (!s || !MCP_IDENTIFIER_PATTERN.test(s)) {
    return "mcp_server";
  }
  return s;
}

/**
 * 为 ACP session 选取唯一 server 名：先规范化，再处理与已用名的冲突。
 */
export function allocateAcpMcpServerName(
  rawName: string,
  usedNames: Set<string>,
): { name: string; sanitized: boolean } {
  const name = peekAcpMcpServerName(rawName, usedNames);
  usedNames.add(name);
  return { name, sanitized: name !== rawName };
}

/**
 * 计算规范化后的 server 名（不写入 usedNames），用于去重判断。
 */
export function peekAcpMcpServerName(
  rawName: string,
  usedNames: Set<string>,
): string {
  let base = sanitizeMcpServerName(rawName);
  let candidate = base;
  let suffix = 2;
  while (usedNames.has(candidate)) {
    candidate = `${base}_${suffix}`;
    suffix += 1;
  }
  return candidate;
}
