/**
 * Tool filtering — whitelist/blacklist tools by name
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js';

export interface ToolFilter {
  allowTools?: Set<string>;
  denyTools?: Set<string>;
}

/**
 * Filter tools by allow/deny lists.
 * - If allowTools is set, only tools in the set are returned.
 * - If denyTools is set, tools in the set are excluded.
 * - If both are set, allowTools takes precedence.
 * - If neither is set, all tools are returned unchanged.
 */
export function filterTools(tools: Tool[], filter: ToolFilter): Tool[] {
  if (filter.allowTools && filter.allowTools.size > 0) {
    return tools.filter((t) => filter.allowTools!.has(t.name));
  }
  if (filter.denyTools && filter.denyTools.size > 0) {
    return tools.filter((t) => !filter.denyTools!.has(t.name));
  }
  return tools;
}
