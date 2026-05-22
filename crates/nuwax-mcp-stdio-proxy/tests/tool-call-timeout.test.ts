import { describe, expect, it } from 'vitest';
import {
  getToolCallRequestOptions,
  HUMAN_IN_LOOP_TOOL_TIMEOUT_MS,
  isHumanInLoopTool,
} from '../src/toolCallTimeout.js';

describe('tool call timeout selection', () => {
  it('uses a long timeout for ask-question servers', () => {
    expect(isHumanInLoopTool({
      serverId: 'ask-question',
      toolName: 'nuwax_ask_question',
    })).toBe(true);

    expect(getToolCallRequestOptions({
      serverId: 'ask-question',
      toolName: 'nuwax_ask_question',
    })).toEqual({ timeout: HUMAN_IN_LOOP_TOOL_TIMEOUT_MS });
  });

  it('detects prefixed ask-question tool names', () => {
    expect(isHumanInLoopTool({
      toolName: 'ask-question_nuwax_ask_question',
    })).toBe(true);
  });

  it('does not override normal tool timeouts', () => {
    expect(isHumanInLoopTool({
      serverId: 'filesystem',
      toolName: 'read_file',
    })).toBe(false);

    expect(getToolCallRequestOptions({
      serverId: 'filesystem',
      toolName: 'read_file',
    })).toBeUndefined();
  });
});
