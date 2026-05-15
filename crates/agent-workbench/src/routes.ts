export interface AgentWorkbenchRoute {
  view: 'agent' | 'chat' | 'history';
  agentId: string;
  conversationId?: string;
}

function cleanSegment(value: string): string {
  return encodeURIComponent(value.trim());
}

function decodeSegment(value: string): string | null {
  let decoded = value;
  for (let index = 0; index < 2; index += 1) {
    try {
      const next = decodeURIComponent(decoded);
      if (next === decoded) return decoded;
      decoded = next;
    } catch {
      return null;
    }
  }
  return decoded;
}

export function buildAgentAppRoute(agentId: string): string {
  return `/app/${cleanSegment(agentId)}`;
}

export function buildAgentChatRoute(agentId: string, conversationId: string): string {
  return `/app/chat/${cleanSegment(agentId)}/${cleanSegment(conversationId)}`;
}

export function buildAgentHistoryRoute(agentId: string): string {
  return `/app/history/conversation/${cleanSegment(agentId)}`;
}

export function parseAgentWorkbenchRoute(path: string): AgentWorkbenchRoute | null {
  const pathname = path.split(/[?#]/, 1)[0].replace(/\/+$/, '') || '/';
  const chatMatch = pathname.match(/^\/app\/chat\/([^/]+)\/([^/]+)$/);
  if (chatMatch) {
    const agentId = decodeSegment(chatMatch[1]);
    const conversationId = decodeSegment(chatMatch[2]);
    if (!agentId || !conversationId) return null;
    return {
      view: 'chat',
      agentId,
      conversationId,
    };
  }

  const historyMatch = pathname.match(/^\/app\/history\/conversation\/([^/]+)$/);
  if (historyMatch) {
    const agentId = decodeSegment(historyMatch[1]);
    if (!agentId) return null;
    return {
      view: 'history',
      agentId,
    };
  }

  const appMatch = pathname.match(/^\/app\/([^/]+)$/);
  if (appMatch) {
    const agentId = decodeSegment(appMatch[1]);
    if (!agentId) return null;
    return {
      view: 'agent',
      agentId,
    };
  }

  return null;
}
