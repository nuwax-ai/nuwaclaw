/**
 * Unit tests: shared.ts — discoverTools, createToolProxyServer, setupGracefulShutdown
 *
 * Uses mock MCP servers to test the shared helpers in isolation.
 */

import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { discoverTools, setupGracefulShutdown } from '../src/shared.js';

// ========== Helpers ==========

function makeTool(name: string): Tool {
  return {
    name,
    description: `Tool: ${name}`,
    inputSchema: { type: 'object' as const, properties: {} },
  };
}

/** Create a mock MCP server + connected client via in-memory transport */
async function createMockServerClient(
  tools: Tool[],
): Promise<{ server: Server; client: Client; close: () => Promise<void> }> {
  const server = new Server(
    { name: 'mock', version: '1.0.0' },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return { tools };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name } = request.params;
    return {
      content: [{ type: 'text' as const, text: `result:${name}` }],
    };
  });

  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();

  const client = new Client({ name: 'test-client', version: '1.0.0' });

  await server.connect(serverTransport);
  await client.connect(clientTransport);

  return {
    server,
    client,
    close: async () => {
      await client.close();
      await server.close();
    },
  };
}

// ========== discoverTools ==========

describe('discoverTools', () => {
  const cleanups: Array<() => Promise<void>> = [];

  afterEach(async () => {
    for (const fn of cleanups) {
      await fn();
    }
    cleanups.length = 0;
  });

  it('discovers tools from a server with no tools', async () => {
    const { client, close } = await createMockServerClient([]);
    cleanups.push(close);

    const tools = await discoverTools(client);
    expect(tools).toEqual([]);
  });

  it('discovers all tools from a server', async () => {
    const mockTools = [makeTool('alpha'), makeTool('beta'), makeTool('gamma')];
    const { client, close } = await createMockServerClient(mockTools);
    cleanups.push(close);

    const tools = await discoverTools(client);
    expect(tools).toHaveLength(3);
    expect(tools.map((t) => t.name)).toEqual(['alpha', 'beta', 'gamma']);
  });

  it('returns tool objects with correct properties', async () => {
    const mockTools = [makeTool('test-tool')];
    const { client, close } = await createMockServerClient(mockTools);
    cleanups.push(close);

    const tools = await discoverTools(client);
    expect(tools[0]).toEqual({
      name: 'test-tool',
      description: 'Tool: test-tool',
      inputSchema: { type: 'object', properties: {} },
    });
  });
});

// ========== setupGracefulShutdown ==========

describe('setupGracefulShutdown', () => {
  let listeners: Map<string, ((...args: unknown[]) => void)[]>;

  beforeEach(() => {
    listeners = new Map();
    vi.spyOn(process, 'on').mockImplementation((event: string, handler: (...args: unknown[]) => void) => {
      if (!listeners.has(event)) listeners.set(event, []);
      listeners.get(event)!.push(handler);
      return process;
    });
    vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('registers SIGINT and SIGTERM handlers', () => {
    setupGracefulShutdown(async () => {});
    expect(listeners.has('SIGINT')).toBe(true);
    expect(listeners.has('SIGTERM')).toBe(true);
  });

  it('calls cleanup function on signal', async () => {
    const cleanupFn = vi.fn().mockResolvedValue(undefined);
    setupGracefulShutdown(cleanupFn);

    // Trigger SIGTERM handler
    const handler = listeners.get('SIGTERM')![0];
    await handler();

    expect(cleanupFn).toHaveBeenCalledOnce();
    expect(process.exit).toHaveBeenCalledWith(0);
  });

  it('only runs cleanup once even if signaled twice', async () => {
    const cleanupFn = vi.fn().mockResolvedValue(undefined);
    setupGracefulShutdown(cleanupFn);

    const handler = listeners.get('SIGINT')![0];
    await handler();
    await handler();

    expect(cleanupFn).toHaveBeenCalledOnce();
  });

  it('still exits when cleanup throws', async () => {
    const cleanupFn = vi.fn().mockRejectedValue(new Error('cleanup failed'));
    setupGracefulShutdown(cleanupFn);

    const handler = listeners.get('SIGTERM')![0];
    await handler();

    expect(cleanupFn).toHaveBeenCalledOnce();
    expect(process.exit).toHaveBeenCalledWith(0);
  });
});
