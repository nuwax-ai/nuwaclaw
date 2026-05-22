import type { RequestOptions } from '@modelcontextprotocol/sdk/shared/protocol.js';

export const HUMAN_IN_LOOP_TOOL_TIMEOUT_MS = 24 * 60 * 60 * 1000;

const HUMAN_IN_LOOP_SERVER_IDS = new Set([
  'ask-question',
  'nuwax-ask-question-mcp',
]);

const HUMAN_IN_LOOP_TOOL_NAMES = new Set([
  'nuwax_ask_question',
  'nuwax_ask_user',
  'nuwaclaw_ask_user',
]);

export function isHumanInLoopTool(context: { serverId?: string; toolName: string }): boolean {
  const serverId = context.serverId?.toLowerCase();
  const toolName = context.toolName.toLowerCase();

  if (serverId && HUMAN_IN_LOOP_SERVER_IDS.has(serverId)) {
    return true;
  }

  if (HUMAN_IN_LOOP_TOOL_NAMES.has(toolName)) {
    return true;
  }

  return Array.from(HUMAN_IN_LOOP_TOOL_NAMES).some((name) => toolName.endsWith(`_${name}`));
}

export function getToolCallRequestOptions(
  context: { serverId?: string; toolName: string },
): RequestOptions | undefined {
  if (!isHumanInLoopTool(context)) {
    return undefined;
  }

  return { timeout: HUMAN_IN_LOOP_TOOL_TIMEOUT_MS };
}
