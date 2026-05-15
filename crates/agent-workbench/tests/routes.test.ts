import { describe, expect, it } from 'vitest';
import {
  buildAgentAppRoute,
  buildAgentChatRoute,
  buildAgentHistoryRoute,
  parseAgentWorkbenchRoute,
} from '../src/routes';

describe('agent workbench route helpers', () => {
  it('builds /app/:agentId', () => {
    expect(buildAgentAppRoute('agent-1')).toBe('/app/agent-1');
    expect(parseAgentWorkbenchRoute('/app/agent-1')).toEqual({
      view: 'agent',
      agentId: 'agent-1',
    });
  });

  it('builds /app/chat/:agentId/:id', () => {
    expect(buildAgentChatRoute('agent-1', 'conv-2')).toBe(
      '/app/chat/agent-1/conv-2',
    );
    expect(parseAgentWorkbenchRoute('/app/chat/agent-1/conv-2?hideMenu=true')).toEqual({
      view: 'chat',
      agentId: 'agent-1',
      conversationId: 'conv-2',
    });
  });

  it('builds /app/history/conversation/:agentId', () => {
    expect(buildAgentHistoryRoute('agent-1')).toBe(
      '/app/history/conversation/agent-1',
    );
    expect(parseAgentWorkbenchRoute('/app/history/conversation/agent-1')).toEqual({
      view: 'history',
      agentId: 'agent-1',
    });
  });

  it('round-trips slash-containing IDs and rejects malformed escapes', () => {
    const path = buildAgentChatRoute('team/agent', 'conv/2');

    expect(path).toBe('/app/chat/team%2Fagent/conv%2F2');
    expect(parseAgentWorkbenchRoute(path)).toEqual({
      view: 'chat',
      agentId: 'team/agent',
      conversationId: 'conv/2',
    });
    expect(parseAgentWorkbenchRoute('/app/%E0%A4%A')).toBeNull();
  });

  it('handles encoded query/hash delimiters without truncating route segments', () => {
    const path = buildAgentChatRoute('agent?1#x', 'conv?2#y');

    expect(path).toBe('/app/chat/agent%3F1%23x/conv%3F2%23y');
    expect(parseAgentWorkbenchRoute(`${path}?hideMenu=true#top`)).toEqual({
      view: 'chat',
      agentId: 'agent?1#x',
      conversationId: 'conv?2#y',
    });
  });
});
