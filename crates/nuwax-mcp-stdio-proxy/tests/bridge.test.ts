/**
 * Smoke tests: PersistentMcpBridge
 *
 * Verifies the bridge lifecycle (start/stop), HTTP routing, tool proxying,
 * and auto-restart behavior using the same mock MCP server fixture.
 */

import { describe, it, expect, afterEach } from 'vitest';
import * as path from 'path';
import { PersistentMcpBridge } from '../src/bridge.js';
import type { BridgeLogger } from '../src/bridge.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const MOCK_SERVER = path.resolve('tests/fixtures/mock-mcp-server.mjs');

/** Silent logger that captures messages for assertions */
function createTestLogger(): BridgeLogger & { messages: string[] } {
  const messages: string[] = [];
  return {
    messages,
    info: (...args: unknown[]) => messages.push(`INFO: ${args.map(String).join(' ')}`),
    warn: (...args: unknown[]) => messages.push(`WARN: ${args.map(String).join(' ')}`),
    error: (...args: unknown[]) => messages.push(`ERROR: ${args.map(String).join(' ')}`),
  };
}

describe('PersistentMcpBridge', () => {
  let bridge: PersistentMcpBridge;

  afterEach(async () => {
    if (bridge) {
      await bridge.stop();
    }
  });

  // ---- Construction & initial state ----

  it('isRunning() returns false before start()', () => {
    bridge = new PersistentMcpBridge();
    expect(bridge.isRunning()).toBe(false);
  });

  it('getBridgeUrl() returns null before start()', () => {
    bridge = new PersistentMcpBridge();
    expect(bridge.getBridgeUrl('anything')).toBeNull();
  });

  it('isServerHealthy() returns false for unknown server', () => {
    bridge = new PersistentMcpBridge();
    expect(bridge.isServerHealthy('nonexistent')).toBe(false);
  });

  it('accepts a custom logger', () => {
    const logger = createTestLogger();
    bridge = new PersistentMcpBridge(logger);
    expect(bridge.isRunning()).toBe(false);
  });

  it('stop() is safe to call before start()', async () => {
    bridge = new PersistentMcpBridge();
    await expect(bridge.stop()).resolves.toBeUndefined();
  });

  // ---- Lifecycle with real mock server ----

  it('start() spawns server and exposes HTTP bridge', async () => {
    const logger = createTestLogger();
    bridge = new PersistentMcpBridge(logger);

    await bridge.start({
      'mock': {
        command: 'node',
        args: [MOCK_SERVER, '--tools', '["bridge-tool-a","bridge-tool-b"]', '--name', 'bridge-mock'],
      },
    });

    expect(bridge.isRunning()).toBe(true);
    expect(bridge.isServerHealthy('mock')).toBe(true);

    const url = bridge.getBridgeUrl('mock');
    expect(url).not.toBeNull();
    expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/mcp\/mock$/);
  });

  it('getBridgeUrl() returns null for unknown server after start', async () => {
    bridge = new PersistentMcpBridge();

    await bridge.start({
      'mock': {
        command: 'node',
        args: [MOCK_SERVER],
      },
    });

    expect(bridge.getBridgeUrl('nonexistent')).toBeNull();
  });

  it('stop() cleans up and sets isRunning to false', async () => {
    bridge = new PersistentMcpBridge();

    await bridge.start({
      'mock': {
        command: 'node',
        args: [MOCK_SERVER],
      },
    });

    expect(bridge.isRunning()).toBe(true);

    await bridge.stop();
    expect(bridge.isRunning()).toBe(false);
    expect(bridge.isServerHealthy('mock')).toBe(false);
    expect(bridge.getBridgeUrl('mock')).toBeNull();
  });

  // ---- HTTP bridge integration ----

  it('proxies tools via HTTP bridge (list + call)', async () => {
    bridge = new PersistentMcpBridge();

    await bridge.start({
      'mock': {
        command: 'node',
        args: [MOCK_SERVER, '--tools', '["alpha"]', '--name', 'proxy-test'],
      },
    });

    const url = bridge.getBridgeUrl('mock')!;
    expect(url).toBeTruthy();

    // Connect as an MCP client via StreamableHTTP
    const transport = new StreamableHTTPClientTransport(new URL(url));
    const client = new Client({ name: 'test-client', version: '1.0.0' });
    await client.connect(transport);

    try {
      // List tools
      const { tools } = await client.listTools();
      expect(tools).toHaveLength(1);
      expect(tools[0].name).toBe('alpha');

      // Call tool
      const result = await client.callTool({ name: 'alpha', arguments: {} });
      expect(result.content).toEqual([
        { type: 'text', text: 'proxy-test:alpha' },
      ]);
    } finally {
      await client.close();
      await transport.close();
    }
  });

  it('returns 404 for invalid HTTP paths', async () => {
    bridge = new PersistentMcpBridge();

    await bridge.start({
      'mock': { command: 'node', args: [MOCK_SERVER] },
    });

    const url = bridge.getBridgeUrl('mock')!;
    // Extract base URL (without /mcp/mock)
    const baseUrl = url.replace('/mcp/mock', '');

    const res = await fetch(`${baseUrl}/invalid`);
    expect(res.status).toBe(404);
  });

  it('returns 503 for unknown server ID', async () => {
    bridge = new PersistentMcpBridge();

    await bridge.start({
      'mock': { command: 'node', args: [MOCK_SERVER] },
    });

    const url = bridge.getBridgeUrl('mock')!;
    const baseUrl = url.replace('/mcp/mock', '');

    const res = await fetch(`${baseUrl}/mcp/nonexistent`, { method: 'POST' });
    expect(res.status).toBe(503);
  });

  // ---- Multiple servers ----

  it('handles multiple concurrent servers', async () => {
    bridge = new PersistentMcpBridge();

    await bridge.start({
      'server-a': {
        command: 'node',
        args: [MOCK_SERVER, '--tools', '["tool-a"]', '--name', 'a'],
      },
      'server-b': {
        command: 'node',
        args: [MOCK_SERVER, '--tools', '["tool-b"]', '--name', 'b'],
      },
    });

    expect(bridge.isServerHealthy('server-a')).toBe(true);
    expect(bridge.isServerHealthy('server-b')).toBe(true);

    const urlA = bridge.getBridgeUrl('server-a')!;
    const urlB = bridge.getBridgeUrl('server-b')!;
    expect(urlA).toContain('/mcp/server-a');
    expect(urlB).toContain('/mcp/server-b');

    // Verify each proxies its own tools
    for (const [url, expectedTool, expectedPrefix] of [
      [urlA, 'tool-a', 'a:tool-a'],
      [urlB, 'tool-b', 'b:tool-b'],
    ] as const) {
      const transport = new StreamableHTTPClientTransport(new URL(url));
      const client = new Client({ name: 'test', version: '1.0.0' });
      await client.connect(transport);
      try {
        const { tools } = await client.listTools();
        expect(tools[0].name).toBe(expectedTool);
        const result = await client.callTool({ name: expectedTool, arguments: {} });
        expect(result.content).toEqual([{ type: 'text', text: expectedPrefix }]);
      } finally {
        await client.close();
        await transport.close();
      }
    }
  });

  // ---- Error handling ----

  it('handles server spawn failure gracefully', async () => {
    const logger = createTestLogger();
    bridge = new PersistentMcpBridge(logger);

    await bridge.start({
      'bad': {
        command: 'nonexistent-binary-that-does-not-exist',
        args: [],
      },
    });

    // Bridge should still be running (HTTP server started)
    expect(bridge.isRunning()).toBe(true);
    // But the server should not be healthy
    expect(bridge.isServerHealthy('bad')).toBe(false);
    expect(bridge.getBridgeUrl('bad')).toBeNull();

    // Logger should capture the failure
    const hasError = logger.messages.some((m) => m.includes('Failed to start server'));
    expect(hasError).toBe(true);
  });

  // ---- Logger ----

  it('logs lifecycle events via injected logger', async () => {
    const logger = createTestLogger();
    bridge = new PersistentMcpBridge(logger);

    await bridge.start({
      'mock': { command: 'node', args: [MOCK_SERVER] },
    });

    await bridge.stop();

    const hasStarting = logger.messages.some((m) => m.includes('Starting with'));
    const hasReady = logger.messages.some((m) => m.includes('Bridge ready'));
    const hasStopped = logger.messages.some((m) => m.includes('Stopped'));
    expect(hasStarting).toBe(true);
    expect(hasReady).toBe(true);
    expect(hasStopped).toBe(true);
  });

  // ---- Explicit port ----

  it('start() with explicit port listens on that port', async () => {
    bridge = new PersistentMcpBridge();

    await bridge.start(
      {
        'mock': {
          command: 'node',
          args: [MOCK_SERVER, '--tools', '["port-tool"]', '--name', 'port-test'],
        },
      },
      { port: 18199 },
    );

    expect(bridge.isRunning()).toBe(true);

    const url = bridge.getBridgeUrl('mock');
    expect(url).toBe('http://127.0.0.1:18199/mcp/mock');

    // Verify it's actually listening on that port by connecting
    const transport = new StreamableHTTPClientTransport(new URL(url!));
    const client = new Client({ name: 'port-test-client', version: '1.0.0' });
    await client.connect(transport);

    try {
      const { tools } = await client.listTools();
      expect(tools).toHaveLength(1);
      expect(tools[0].name).toBe('port-tool');
    } finally {
      await client.close();
      await transport.close();
    }
  });
});
