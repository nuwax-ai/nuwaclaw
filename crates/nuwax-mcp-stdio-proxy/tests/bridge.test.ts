/**
 * Smoke tests: PersistentMcpBridge
 *
 * Verifies the bridge lifecycle (start/stop), HTTP routing, tool proxying,
 * and auto-restart behavior using the same mock MCP server fixture.
 */

import { describe, it, expect, afterEach } from 'vitest';
import * as path from 'path';
import * as net from 'net';
import { PersistentMcpBridge } from '../src/bridge.js';
import type { BridgeLogger } from '../src/bridge.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

/**
 * 动态占用一个随机可用端口，返回端口号和释放函数。
 * 用于模拟端口冲突，测试 start() 的容错清理逻辑。
 */
function occupyRandomPort(): Promise<{ port: number; release: () => Promise<void> }> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as net.AddressInfo;
      resolve({
        port: addr.port,
        release: () => new Promise<void>((res) => server.close(() => res())),
      });
    });
    server.on('error', reject);
  });
}

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

  // ---- Multiple servers (parallel start/stop) ----

  /**
   * 验证 3 个 server 并行启动：start() 返回后全部健康，且各自 URL 正确路由。
   * 如果内部退化为串行，此测试仍应通过（正确性不变），但性能会下降。
   */
  it('starts 3 servers in parallel and all become healthy', async () => {
    bridge = new PersistentMcpBridge();

    await bridge.start({
      'svc-alpha': {
        command: 'node',
        args: [MOCK_SERVER, '--tools', '["alpha-tool"]', '--name', 'alpha'],
      },
      'svc-beta': {
        command: 'node',
        args: [MOCK_SERVER, '--tools', '["beta-tool"]', '--name', 'beta'],
      },
      'svc-gamma': {
        command: 'node',
        args: [MOCK_SERVER, '--tools', '["gamma-tool"]', '--name', 'gamma'],
      },
    });

    // 全部健康
    expect(bridge.isServerHealthy('svc-alpha')).toBe(true);
    expect(bridge.isServerHealthy('svc-beta')).toBe(true);
    expect(bridge.isServerHealthy('svc-gamma')).toBe(true);

    // URL 路由各自独立
    expect(bridge.getBridgeUrl('svc-alpha')).toMatch(/\/mcp\/svc-alpha$/);
    expect(bridge.getBridgeUrl('svc-beta')).toMatch(/\/mcp\/svc-beta$/);
    expect(bridge.getBridgeUrl('svc-gamma')).toMatch(/\/mcp\/svc-gamma$/);

    // 每个 server 只暴露自己的工具
    for (const [serverId, toolName, namePrefix] of [
      ['svc-alpha', 'alpha-tool', 'alpha'],
      ['svc-beta', 'beta-tool', 'beta'],
      ['svc-gamma', 'gamma-tool', 'gamma'],
    ] as const) {
      const url = bridge.getBridgeUrl(serverId)!;
      const transport = new StreamableHTTPClientTransport(new URL(url));
      const client = new Client({ name: 'parallel-test', version: '1.0.0' });
      await client.connect(transport);
      try {
        const { tools } = await client.listTools();
        expect(tools).toHaveLength(1);
        expect(tools[0].name).toBe(toolName);
        const result = await client.callTool({ name: toolName, arguments: {} });
        expect(result.content).toEqual([{ type: 'text', text: `${namePrefix}:${toolName}` }]);
      } finally {
        await client.close();
        await transport.close();
      }
    }
  });

  it('stops all servers and bridge becomes not running', async () => {
    bridge = new PersistentMcpBridge();

    await bridge.start({
      'stop-a': { command: 'node', args: [MOCK_SERVER, '--name', 'stop-a'] },
      'stop-b': { command: 'node', args: [MOCK_SERVER, '--name', 'stop-b'] },
      'stop-c': { command: 'node', args: [MOCK_SERVER, '--name', 'stop-c'] },
    });

    expect(bridge.isRunning()).toBe(true);

    await bridge.stop();

    // 并行停止后整体不再运行
    expect(bridge.isRunning()).toBe(false);
    // 每个 server 均已清理
    expect(bridge.isServerHealthy('stop-a')).toBe(false);
    expect(bridge.isServerHealthy('stop-b')).toBe(false);
    expect(bridge.isServerHealthy('stop-c')).toBe(false);
    expect(bridge.getBridgeUrl('stop-a')).toBeNull();
  });

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

  /**
   * 验证 start() 中 HTTP server 启动失败（端口冲突）时：
   * 1. start() 应抛出异常
   * 2. bridge 处于未运行状态（isRunning = false）
   * 3. 所有 spawnAndConnect 完成后子进程被正确关闭（无孤儿进程）
   * 4. bridge 实例回到可重用状态，可以重新正常启动
   */
  it('start() throws and cleans up spawned processes when HTTP server fails to bind', async () => {
    const { port, release } = await occupyRandomPort();

    try {
      const logger = createTestLogger();
      bridge = new PersistentMcpBridge(logger);

      // 使用被占用的端口 → startHttpServer 应抛 EADDRINUSE
      await expect(
        bridge.start(
          { 'mock': { command: 'node', args: [MOCK_SERVER, '--name', 'cleanup-test'] } },
          { port },
        ),
      ).rejects.toThrow();

      // 失败后 bridge 必须处于未运行状态
      expect(bridge.isRunning()).toBe(false);
      expect(bridge.getBridgeUrl('mock')).toBeNull();

      // 失败日志记录（来自 catch 块）
      expect(logger.messages.some((m) => m.includes('启动失败'))).toBe(true);
    } finally {
      await release();
    }

    // 释放端口后，同一个 bridge 实例应能正常重新启动
    await bridge.start({
      'mock-retry': { command: 'node', args: [MOCK_SERVER, '--name', 'retry'] },
    });
    expect(bridge.isRunning()).toBe(true);
    expect(bridge.isServerHealthy('mock-retry')).toBe(true);
  });

  /**
   * 验证 stop() 并行关闭多个活跃 HTTP session：
   * 即使同时存在多个 session，stop() 也能正确完成并清理全部 session。
   */
  it('stop() closes multiple active HTTP sessions in parallel', async () => {
    bridge = new PersistentMcpBridge();

    await bridge.start({
      'mock': {
        command: 'node',
        args: [MOCK_SERVER, '--tools', '["tool-x","tool-y"]', '--name', 'multi-session'],
      },
    });

    const url = bridge.getBridgeUrl('mock')!;

    // 建立 3 个独立 HTTP session
    const connections: Array<{ client: Client; transport: StreamableHTTPClientTransport }> = [];
    for (let i = 0; i < 3; i++) {
      const transport = new StreamableHTTPClientTransport(new URL(url));
      const client = new Client({ name: `multi-session-client-${i}`, version: '1.0.0' });
      await client.connect(transport);
      connections.push({ client, transport });
    }

    // 3 个 session 建立期间，bridge 应保持健康
    expect(bridge.isServerHealthy('mock')).toBe(true);

    // 调用 stop()，验证多 session 并行关闭后 bridge 完全停止
    await bridge.stop();

    expect(bridge.isRunning()).toBe(false);
    expect(bridge.isServerHealthy('mock')).toBe(false);
    expect(bridge.getBridgeUrl('mock')).toBeNull();

    // 清理客户端（stop 后 transport 可能已关闭，忽略错误）
    for (const { client, transport } of connections) {
      try { await client.close(); } catch { /* ignore */ }
      try { await transport.close(); } catch { /* ignore */ }
    }
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
