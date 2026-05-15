import { describe, expect, it, vi } from 'vitest';
import { createWebApiAdapter } from '../src/adapters/webApiAdapter';

describe('createWebApiAdapter', () => {
  it('normalizes baseUrl and sends Authorization header', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: { id: 'agent-1', name: 'Agent' } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              records: [
                {
                  id: 'conv-1',
                  title: 'Session',
                  createdAt: '2026-05-15T00:00:00.000Z',
                  updatedAt: '2026-05-15T00:00:00.000Z',
                },
              ],
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      );

    const adapter = createWebApiAdapter({
      baseUrl: 'https://api.example.com///',
      accessToken: 'token-123',
      fetcher,
    });

    const conversations = await adapter.listConversations('agent-1');

    expect(fetcher).toHaveBeenNthCalledWith(
      1,
      'https://api.example.com/api/published/agent/agent-1?withConversationId=true',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          Authorization: 'Bearer token-123',
        }),
      }),
    );
    expect(fetcher).toHaveBeenNthCalledWith(
      2,
      'https://api.example.com/api/agent/conversation/list',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer token-123',
          'Content-Type': 'application/json',
        }),
        body: JSON.stringify({ agentId: 'agent-1' }),
      }),
    );
    expect(conversations).toHaveLength(1);
    expect(conversations[0].agentId).toBe('agent-1');
  });

  it('loads published agent detail for the OpenApp shell', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: {
            id: 286,
            name: 'Agent@我的电脑286',
            icon: 'https://cdn.example.com/agent.png',
            openingChatMsg: '你好',
            customPageMenus: [
              {
                name: '页面预览',
                path: '/page/286/prod/',
                selected: true,
              },
            ],
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );

    const adapter = createWebApiAdapter({
      baseUrl: 'https://api.example.com',
      accessToken: 'token-123',
      fetcher,
    });

    const detail = await adapter.getAgentDetail?.('286');

    expect(fetcher).toHaveBeenCalledWith(
      'https://api.example.com/api/published/agent/286?withConversationId=true',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          Authorization: 'Bearer token-123',
        }),
      }),
    );
    expect(detail).toEqual(
      expect.objectContaining({
        agentId: '286',
        name: 'Agent@我的电脑286',
        openingChatMsg: '你好',
        customPageMenus: [
          expect.objectContaining({
            name: '页面预览',
            path: '/page/286/prod/',
            selected: true,
          }),
        ],
      }),
    );
  });

  it('uses Authorization and baseUrl for stream URL follow-up requests', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: { streamUrl: '/stream/s1' } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response('event: final\ndata: {"content":"ok"}\n\n', {
          status: 200,
          headers: { 'content-type': 'text/event-stream' },
        }),
      );

    const adapter = createWebApiAdapter({
      baseUrl: 'https://api.example.com/base',
      accessToken: 'token-123',
      fetcher,
    });

    const events = [];
    for await (const event of adapter.sendMessage({
      agentId: 'agent-1',
      conversationId: 'conv-1',
      content: 'hello',
    })) {
      events.push(event);
    }

    expect(fetcher).toHaveBeenNthCalledWith(
      2,
      'https://api.example.com/base/stream/s1',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          Authorization: 'Bearer token-123',
        }),
      }),
    );
    expect(events).toEqual([expect.objectContaining({ type: 'final', content: 'ok' })]);
  });

  it('normalizes apiPathPrefix and relative stream URLs without dropping Authorization', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: { stream_url: '///events/s1' } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response('data: [DONE]\n\n', {
          status: 200,
          headers: { 'content-type': 'text/event-stream' },
        }),
      );

    const adapter = createWebApiAdapter({
      baseUrl: 'https://api.example.com/root///',
      accessToken: 'real-token',
      fetcher,
      apiPathPrefix: 'v1/',
    });

    const events = [];
    for await (const event of adapter.sendMessage({
      agentId: 'agent-1',
      conversationId: 'conv-1',
      content: 'hello',
    })) {
      events.push(event);
    }

    expect(fetcher).toHaveBeenNthCalledWith(
      1,
      'https://api.example.com/root/v1/agent/conversation/chat',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer real-token',
        }),
      }),
    );
    expect(fetcher).toHaveBeenNthCalledWith(
      2,
      'https://api.example.com/root/events/s1',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          Authorization: 'Bearer real-token',
        }),
      }),
    );
    expect(events).toEqual([expect.objectContaining({ type: 'final' })]);
  });

  it('keeps loading conversation history when the published-agent fallback fails', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ message: 'not found' }), {
          status: 404,
          headers: { 'content-type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              list: [
                {
                  id: 'conv-1',
                  title: 'Recovered from list',
                  createdAt: '2026-05-15T00:00:00.000Z',
                  updatedAt: '2026-05-15T00:00:00.000Z',
                },
              ],
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      );

    const adapter = createWebApiAdapter({
      baseUrl: 'https://api.example.com',
      accessToken: 'token-123',
      fetcher,
    });

    const conversations = await adapter.listConversations('agent-1');

    expect(conversations).toEqual([
      expect.objectContaining({
        id: 'conv-1',
        title: 'Recovered from list',
      }),
    ]);
  });

  it('uses the real chat SSE endpoint and stop endpoint', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response('event: final\ndata: {"content":"ok"}\n\n', {
          status: 200,
          headers: { 'content-type': 'text/event-stream' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );

    const adapter = createWebApiAdapter({
      baseUrl: 'https://api.example.com',
      accessToken: 'token-123',
      fetcher,
    });

    const events = [];
    for await (const event of adapter.sendMessage({
      agentId: 'agent-1',
      conversationId: 'conv-1',
      content: 'hello',
      requestId: 'req-1',
    })) {
      events.push(event);
    }
    await adapter.stopChat?.('req-1', {
      agentId: 'agent-1',
      conversationId: 'conv-1',
    });

    expect(fetcher).toHaveBeenNthCalledWith(
      1,
      'https://api.example.com/api/agent/conversation/chat',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer token-123',
          'Content-Type': 'application/json',
        }),
        body: JSON.stringify({
          agentId: 'agent-1',
          conversationId: 'conv-1',
          content: 'hello',
          message: 'hello',
          prompt: 'hello',
          requestId: 'req-1',
        }),
      }),
    );
    expect(fetcher).toHaveBeenNthCalledWith(
      2,
      'https://api.example.com/api/agent/conversation/chat/stop/req-1',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer token-123',
        }),
      }),
    );
    expect(events).toEqual([expect.objectContaining({ type: 'final', content: 'ok' })]);
  });
});
