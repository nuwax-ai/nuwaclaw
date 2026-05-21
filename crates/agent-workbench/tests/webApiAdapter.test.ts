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
        body: JSON.stringify({ agentId: 'agent-1', limit: 8 }),
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
          conversationId: 'conv-1',
          message: 'hello',
          attachments: [],
          selectedComponents: [],
          debug: false,
        }),
      }),
    );
    const stopCall = fetcher.mock.calls[1]?.[1] as RequestInit;
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
    expect(stopCall.body).toBeUndefined();
    expect(events).toEqual([expect.objectContaining({ type: 'final', content: 'ok' })]);
  });

  it('sends extended fields in sendMessage body', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(
      new Response('event: final\ndata: {"content":"ok"}\n\n', {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
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
      variableParams: { city: 'Shanghai' },
      modelId: 'gpt-4',
      agentMode: 'yolo',
      skillIds: ['1'],
      sandboxId: 'sb-1',
    })) {
      events.push(event);
    }

    expect(fetcher).toHaveBeenCalledWith(
      'https://api.example.com/api/agent/conversation/chat',
      expect.objectContaining({
        body: JSON.stringify({
          conversationId: 'conv-1',
          message: 'hello',
          attachments: [],
          selectedComponents: [],
          debug: false,
          variableParams: { city: 'Shanghai' },
          skillIds: [1],
          modelId: 'gpt-4',
          sandboxId: 'sb-1',
        }),
      }),
    );
    expect(events).toEqual([expect.objectContaining({ type: 'final' })]);
  });

  it('calls getSuggestQuestions endpoint', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(
      new Response(
        JSON.stringify({ data: ['What next?', 'Show example'] }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );

    const adapter = createWebApiAdapter({
      baseUrl: 'https://api.example.com',
      accessToken: 'token-123',
      fetcher,
    });

    const suggestions = await adapter.getSuggestQuestions?.('conv-1', 'agent-1', {
      city: 'Beijing',
    });

    expect(fetcher).toHaveBeenCalledWith(
      'https://api.example.com/api/agent/conversation/chat/suggest',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer token-123',
          'Content-Type': 'application/json',
        }),
        body: JSON.stringify({
          conversationId: 'conv-1',
          message: '',
          attachments: [],
          selectedComponents: [],
          debug: false,
          variableParams: { city: 'Beijing' },
        }),
      }),
    );
    expect(suggestions).toEqual(['What next?', 'Show example']);
  });

  it('calls getModelOptions endpoint and normalizes response', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: [
            { id: 'gpt-4', name: 'GPT-4', provider: 'openai' },
            { modelId: 'claude-3', modelName: 'Claude 3', icon: '🤖' },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );

    const adapter = createWebApiAdapter({
      baseUrl: 'https://api.example.com',
      accessToken: 'token-123',
      fetcher,
    });

    const models = await adapter.getModelOptions?.('agent-1');

    expect(fetcher).toHaveBeenCalledWith(
      'https://api.example.com/api/agent/conversation/model/options/agent-1',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          Authorization: 'Bearer token-123',
        }),
      }),
    );
    expect(models).toEqual([
      expect.objectContaining({ id: 'gpt-4', name: 'GPT-4', provider: 'openai' }),
      expect.objectContaining({ id: 'claude-3', name: 'Claude 3', icon: '🤖' }),
    ]);
  });

  it('loads conversation messages with pagination params', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: {
            conversation: { id: 'conv-1', title: 'Session' },
            messages: [{ id: 'm1', role: 'user', content: 'hi', index: 3 }],
            hasMore: true,
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

    const detail = await adapter.getConversation('agent-1', 'conv-1', {
      index: 3,
      size: 10,
    });

    expect(fetcher).toHaveBeenCalledWith(
      'https://api.example.com/api/agent/conversation/message/list',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          conversationId: 'conv-1',
          size: 10,
          index: 3,
        }),
      }),
    );
    expect(detail.messages).toHaveLength(1);
    expect(detail.hasMore).toBe(true);
  });

  it('uploads file via multipart form', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: { url: 'https://cdn.example.com/a.png', key: 'k1', fileName: 'a.png' },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );

    const adapter = createWebApiAdapter({
      baseUrl: 'https://api.example.com',
      accessToken: 'token-123',
      fetcher,
    });

    const file = new File(['hello'], 'a.png', { type: 'image/png' });
    const uploaded = await adapter.uploadFile?.(file);

    expect(fetcher).toHaveBeenCalledWith(
      'https://api.example.com/api/file/upload',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer token-123',
        }),
      }),
    );
    const call = fetcher.mock.calls[0][1] as RequestInit;
    expect(call.body).toBeInstanceOf(FormData);
    const form = call.body as FormData;
    expect(form.get('type')).toBe('tmp');
    expect(uploaded).toEqual({
      url: 'https://cdn.example.com/a.png',
      key: 'k1',
      fileName: 'a.png',
      size: file.size,
      mimeType: 'image/png',
    });
  });

  it('uploadFile sends FormData with file field and Bearer auth, omits JSON Content-Type', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          code: '0000',
          data: { url: 'https://cdn.example.com/b.txt', key: 'kb', fileName: 'b.txt' },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );

    const adapter = createWebApiAdapter({
      baseUrl: 'https://api.example.com',
      accessToken: 'token-abc',
      fetcher,
    });

    const file = new File(['hello world'], 'b.txt', { type: 'text/plain' });
    await adapter.uploadFile?.(file);

    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, init] = fetcher.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.example.com/api/file/upload');
    expect(init.method).toBe('POST');
    expect(init.body).toBeInstanceOf(FormData);
    const form = init.body as FormData;
    // Field name must be exactly `file` per nuwax /api/file/upload contract.
    const formFile = form.get('file');
    expect(formFile).toBeInstanceOf(File);
    expect((formFile as File).name).toBe('b.txt');
    expect(form.get('type')).toBe('tmp');
    // Authorization is present; Content-Type must NOT be application/json — the
    // browser sets multipart/form-data with the correct boundary on its own.
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer token-abc');
    expect(headers['Content-Type']).toBeUndefined();
  });

  it('uploadFile normalizes nuwax field aliases (fileUrl/fileKey/file_name) and falls back to local File metadata', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          code: '0000',
          data: {
            // nuwax response sometimes uses snake/camel aliases — adapter
            // must normalize without callers caring which shape arrived.
            fileUrl: 'https://cdn.example.com/c.bin',
            fileKey: 'kc',
            file_name: 'remote-c.bin',
            // mimeType + size intentionally absent → fall back to local File.
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

    const file = new File(['payload'], 'local-c.bin', {
      type: 'application/octet-stream',
    });
    const uploaded = await adapter.uploadFile?.(file);

    expect(uploaded).toEqual({
      url: 'https://cdn.example.com/c.bin',
      key: 'kc',
      // Server-provided file_name wins over local file.name.
      fileName: 'remote-c.bin',
      size: file.size,
      mimeType: 'application/octet-stream',
    });
  });

  it('uploadFile throws when business code is not 0000', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(
      new Response(
        JSON.stringify({ code: '5001', message: 'file too large' }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );

    const adapter = createWebApiAdapter({
      baseUrl: 'https://api.example.com',
      accessToken: 'token-123',
      fetcher,
    });

    const file = new File(['x'], 'big.bin', { type: 'application/octet-stream' });
    await expect(adapter.uploadFile?.(file)).rejects.toThrow('file too large');
  });

  it('uploadFile invokes onProgress with a terminal 100% tick on success', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          code: '0000',
          data: { url: 'https://cdn.example.com/d.png', key: 'kd', fileName: 'd.png' },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );

    const adapter = createWebApiAdapter({
      baseUrl: 'https://api.example.com',
      accessToken: 'token-123',
      fetcher,
    });

    const file = new File(['12345'], 'd.png', { type: 'image/png' });
    const progress: Array<{ loaded: number; total: number }> = [];
    await adapter.uploadFile?.(file, {
      onProgress: (p) => progress.push(p),
    });

    // Native fetch cannot stream upload progress — adapter guarantees at
    // least a terminal 100% tick so callers always reach a final state.
    expect(progress.length).toBeGreaterThanOrEqual(1);
    const last = progress[progress.length - 1];
    expect(last).toEqual({ loaded: file.size, total: file.size });
  });

  it('lists skills for @ mention', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: {
            records: [{ id: 'skill-1', name: 'Search Web', description: 'Browse' }],
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

    const skills = await adapter.listSkillsForAt?.('agent-1', {
      keyword: 'search',
      page: 1,
      pageSize: 20,
      tab: 'all',
    });

    expect(fetcher).toHaveBeenCalledWith(
      'https://api.example.com/api/published/skill/list-for-at',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          page: 1,
          pageSize: 20,
          kw: 'search',
          targetType: 'Skill',
        }),
      }),
    );
    expect(skills).toEqual([
      expect.objectContaining({ id: 'skill-1', name: 'Search Web', description: 'Browse' }),
    ]);
  });

  it('loads collect and recent skill tabs via dedicated endpoints', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ code: '0000', data: [{ id: 'c1', name: 'Collected' }] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ code: '0000', data: [{ id: 'r1', name: 'Recent' }] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );

    const adapter = createWebApiAdapter({
      baseUrl: 'https://api.example.com',
      accessToken: 'token-123',
      fetcher,
    });

    const collected = await adapter.listSkillsForAt?.('agent-1', { tab: 'collect' });
    const recent = await adapter.listSkillsForAt?.('agent-1', { tab: 'recent' });

    expect(fetcher).toHaveBeenNthCalledWith(
      1,
      'https://api.example.com/api/published/skill/collect/list',
      expect.any(Object),
    );
    expect(fetcher).toHaveBeenNthCalledWith(
      2,
      'https://api.example.com/api/published/skill/recentlyUsed/list',
      expect.any(Object),
    );
    expect(collected?.[0].name).toBe('Collected');
    expect(recent?.[0].name).toBe('Recent');
  });

  it('throws when HTTP 200 but business code is not 0000', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(
      new Response(JSON.stringify({ code: '1001', message: 'no permission' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    const adapter = createWebApiAdapter({
      baseUrl: 'https://api.example.com',
      accessToken: 'token-123',
      fetcher,
    });

    await expect(adapter.getAgentDetail?.('1')).rejects.toThrow('no permission');
  });

  it('maps USER role messages from history list', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: [{ id: 'm1', role: 'USER', text: 'hello', index: 2 }],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );

    const adapter = createWebApiAdapter({
      baseUrl: 'https://api.example.com',
      accessToken: 'token-123',
      fetcher,
    });

    const detail = await adapter.getConversation('agent-1', '99');
    expect(detail.messages[0].role).toBe('user');
    expect(detail.messages[0].content).toBe('hello');
  });

  it('paginates skills via listSkillsForAtPaged with keyword and total', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          code: '0000',
          data: {
            records: [
              { id: 12, name: 'Search Web', description: 'Browse the web' },
              { id: 13, name: 'Search Docs', description: 'Search local docs' },
            ],
            total: 42,
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

    const result = await adapter.listSkillsForAtPaged?.({
      agentId: 'agent-1',
      keyword: 'search',
      page: 2,
      pageSize: 5,
    });

    expect(fetcher).toHaveBeenCalledWith(
      'https://api.example.com/api/published/skill/list-for-at',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          page: 2,
          pageSize: 5,
          kw: 'search',
          targetType: 'Skill',
        }),
      }),
    );
    expect(result).toEqual({
      items: [
        // Note: id 12 (number) should be normalized to "12" (string) via fromApiId.
        expect.objectContaining({ id: '12', name: 'Search Web' }),
        expect.objectContaining({ id: '13', name: 'Search Docs' }),
      ],
      total: 42,
      hasMore: true, // 2 * 5 = 10 < 42
    });
  });

  it('falls back hasMore to records length when total is missing', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          code: '0000',
          data: {
            records: Array.from({ length: 3 }, (_, i) => ({
              id: `s-${i}`,
              name: `Skill ${i}`,
            })),
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

    const result = await adapter.listSkillsForAtPaged?.({
      agentId: 'agent-1',
      page: 1,
      pageSize: 20,
    });

    // 3 records, no total → total derived from records.length, hasMore false.
    expect(result?.total).toBe(3);
    expect(result?.hasMore).toBe(false);
    expect(result?.items).toHaveLength(3);
  });

  it('listRecentSkills posts to recentlyUsed endpoint with targetType', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          code: '0000',
          data: [
            { id: 'r1', name: 'Recently Used Alpha', description: 'one' },
            { id: 'r2', name: 'Recently Used Beta' },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );

    const adapter = createWebApiAdapter({
      baseUrl: 'https://api.example.com',
      accessToken: 'token-123',
      fetcher,
    });

    const items = await adapter.listRecentSkills?.('agent-1');

    expect(fetcher).toHaveBeenCalledWith(
      'https://api.example.com/api/published/skill/recentlyUsed/list',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ targetType: 'Skill' }),
      }),
    );
    expect(items).toHaveLength(2);
    expect(items?.[0]).toEqual(
      expect.objectContaining({ id: 'r1', name: 'Recently Used Alpha' }),
    );
  });

  it('normalizes allowAtSkill from string enum and boolean shapes on agent detail', async () => {
    // nuwax sends `allowAtSkill` as the string enum 'Yes' | 'No' from the
    // legacy backend, but newer endpoints emit a raw boolean. Both must
    // collapse to the same workbench boolean so UI gates do not care which
    // shape arrived. We exercise both branches in a single test by issuing
    // two getAgentDetail calls against the same adapter.
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            code: '0000',
            data: { id: 'agent-yes', name: 'Yes Agent', allowAtSkill: 'Yes' },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            code: '0000',
            data: { id: 'agent-no', name: 'No Agent', allowAtSkill: 'No' },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            code: '0000',
            data: { id: 'agent-bool', name: 'Bool Agent', allowAtSkill: true },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            code: '0000',
            data: { id: 'agent-absent', name: 'Absent Agent' },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      );

    const adapter = createWebApiAdapter({
      baseUrl: 'https://api.example.com',
      accessToken: 'token-123',
      fetcher,
    });

    const yes = await adapter.getAgentDetail?.('agent-yes');
    const no = await adapter.getAgentDetail?.('agent-no');
    const bool = await adapter.getAgentDetail?.('agent-bool');
    const absent = await adapter.getAgentDetail?.('agent-absent');

    expect(yes?.allowAtSkill).toBe(true);
    expect(no?.allowAtSkill).toBe(false);
    expect(bool?.allowAtSkill).toBe(true);
    // Absent → undefined so callers can fall back to a host default.
    expect(absent?.allowAtSkill).toBeUndefined();
  });

  it('normalizes guidQuestionDtos from string[] and object[] shapes', async () => {
    // Legacy nuwax responses sometimes ship `guidQuestionDtos` as a bare
    // string list (older agents) and sometimes as an object list with the
    // `question`/`content`/`title` aliases (newer agents). Both must reach
    // the UI as the same `{ question: string }`-shaped array.
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            code: '0000',
            data: {
              id: 'agent-str',
              name: 'Str Agent',
              guidQuestionDtos: ['First?', '  Second?  ', '', 'Third?'],
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            code: '0000',
            data: {
              id: 'agent-obj',
              name: 'Obj Agent',
              guidQuestionDtos: [
                { id: 'q1', question: 'Q via question' },
                { id: 2, content: 'Q via content' },
                { title: 'Q via title' },
                { info: 'Q via info' },
                // Entries with no extractable text are dropped so the UI never
                // renders an empty pill.
                { id: 'noop' },
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

    const strAgent = await adapter.getAgentDetail?.('agent-str');
    const objAgent = await adapter.getAgentDetail?.('agent-obj');

    // string[] → array of { question } with empty/whitespace entries dropped.
    expect(strAgent?.guidQuestionDtos).toEqual([
      { question: 'First?' },
      { question: 'Second?' },
      { question: 'Third?' },
    ]);
    // object[] → question text is hoisted from question/content/title/info.
    expect(objAgent?.guidQuestionDtos).toEqual([
      expect.objectContaining({ id: 'q1', question: 'Q via question' }),
      expect.objectContaining({ id: 2, question: 'Q via content' }),
      expect.objectContaining({ question: 'Q via title' }),
      expect.objectContaining({ question: 'Q via info' }),
    ]);
    expect(objAgent?.guidQuestionDtos?.length).toBe(4);
  });

  it('listCollectedSkills posts to collect endpoint and normalizes numeric ids', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          code: '0000',
          data: [
            { id: 101, name: 'Collected Alpha', description: 'pinned' },
            { id: 102, name: 'Collected Beta' },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );

    const adapter = createWebApiAdapter({
      baseUrl: 'https://api.example.com',
      accessToken: 'token-123',
      fetcher,
    });

    const items = await adapter.listCollectedSkills?.('agent-1');

    expect(fetcher).toHaveBeenCalledWith(
      'https://api.example.com/api/published/skill/collect/list',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ targetType: 'Skill' }),
      }),
    );
    // Numeric ids in payload should be coerced to strings at the boundary.
    expect(items?.[0].id).toBe('101');
    expect(items?.[1].id).toBe('102');
  });
});
