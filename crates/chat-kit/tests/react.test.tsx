import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  ChatComposer,
  ChatConversationList,
  ChatMessageList,
} from '../src/react';

describe('shared React chat modules', () => {
  it('renders the controlled composer', () => {
    const html = renderToStaticMarkup(
      <ChatComposer
        draft={{ text: 'hello', attachments: [], skillIds: [] }}
        onDraftChange={() => undefined}
        onSend={() => undefined}
      />,
    );
    expect(html).toContain('hello');
    expect(html).toContain('Send');
  });

  it('supports host editors and action slots without replacing the shared form', () => {
    const html = renderToStaticMarkup(
      <ChatComposer
        draft={{ text: 'mention', attachments: [], skillIds: [] }}
        onDraftChange={() => undefined}
        onSend={() => undefined}
        renderEditor={({ draft }) => <div data-editor="mention">{draft.text}</div>}
        actions={<div data-actions="host">Host actions</div>}
      />,
    );
    expect(html).toContain('nuwax-chat-composer');
    expect(html).toContain('data-editor="mention"');
    expect(html).toContain('data-actions="host"');
    expect(html).not.toContain('<textarea');
  });

  it('renders message and conversation lists from the shared domain model', () => {
    const messages = renderToStaticMarkup(
      <ChatMessageList
        messages={[{
          id: 'message-1',
          conversationId: 'conversation-1',
          role: 'assistant',
          status: 'complete',
          parts: [{ type: 'text', text: 'shared answer' }],
        }]}
      />,
    );
    const conversations = renderToStaticMarkup(
      <ChatConversationList
        conversations={[{
          id: 'conversation-1',
          agentId: 'agent-1',
          title: 'Shared conversation',
          updatedAt: '2026-07-20T00:00:00.000Z',
        }]}
        onSelect={() => undefined}
      />,
    );
    expect(messages).toContain('shared answer');
    expect(conversations).toContain('Shared conversation');
  });

  it('supports host conversation content while retaining shared selection markup', () => {
    const html = renderToStaticMarkup(
      <ChatConversationList
        conversations={[{
          id: 'conversation-1',
          agentId: 'agent-1',
          title: 'Shared conversation',
          updatedAt: '2026-07-20T00:00:00.000Z',
        }]}
        onSelect={() => undefined}
        renderContent={(conversation) => <span data-host-row>{conversation.title}</span>}
      />,
    );
    expect(html).toContain('nuwax-chat-conversation');
    expect(html).toContain('data-host-row');
  });
});
