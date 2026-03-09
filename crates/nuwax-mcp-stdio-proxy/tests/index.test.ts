/**
 * Integration tests: nuwax-mcp-stdio-proxy
 *
 * Tests the proxy as a whole by spawning it as a child process and communicating
 * via MCP protocol (JSON-RPC over stdio). Uses a mock MCP server fixture for
 * child server simulation.
 *
 * Cross-platform: tests run on Windows, macOS, and Linux.
 * Requires `npm run build` before running (tests use compiled dist/index.js).
 */

import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { spawn } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

// ========== Paths ==========

const PROXY_SCRIPT = path.resolve('dist/index.js');
const MOCK_SERVER = path.resolve('tests/fixtures/mock-mcp-server.mjs');
const isWindows = process.platform === 'win32';

// ========== Helpers ==========

/** Build a clean env Record<string, string> from process.env (filter undefined) */
function cleanEnv(extra?: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined) env[k] = v;
  }
  return { ...env, ...extra };
}

/** Spawn proxy process and collect exit code + stderr */
function spawnProxy(
  args: string[],
  options?: { env?: Record<string, string>; timeoutMs?: number },
): Promise<{ code: number | null; stderr: string }> {
  return new Promise((resolve) => {
    const proc = spawn('node', [PROXY_SCRIPT, ...args], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: options?.env,
    });

    let stderr = '';
    proc.stderr?.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    proc.on('exit', (code) => {
      resolve({ code, stderr });
    });

    // Safety timeout
    const timeout = options?.timeoutMs ?? 10000;
    setTimeout(() => proc.kill(), timeout);
  });
}

/** Create config JSON for a single mock MCP server */
function singleServerConfig(
  toolNames: string[] = ['mock-tool'],
  serverName = 'mock',
  extra?: { assertNoEnv?: string },
): string {
  const args = [MOCK_SERVER, '--tools', JSON.stringify(toolNames), '--name', serverName];
  if (extra?.assertNoEnv) {
    args.push('--assert-no-env', extra.assertNoEnv);
  }
  return JSON.stringify({
    mcpServers: { [serverName]: { command: 'node', args } },
  });
}

/** Create config JSON for multiple mock MCP servers */
function multiServerConfig(
  servers: { name: string; tools: string[]; assertNoEnv?: string }[],
): string {
  const mcpServers: Record<string, { command: string; args: string[] }> = {};
  for (const s of servers) {
    const args = [MOCK_SERVER, '--tools', JSON.stringify(s.tools), '--name', s.name];
    if (s.assertNoEnv) args.push('--assert-no-env', s.assertNoEnv);
    mcpServers[s.name] = { command: 'node', args };
  }
  return JSON.stringify({ mcpServers });
}

/** Connect an MCP client to the proxy (for E2E tests) */
async function connectToProxy(
  configJson: string,
  extraEnv?: Record<string, string>,
): Promise<Client> {
  const transport = new StdioClientTransport({
    command: 'node',
    args: [PROXY_SCRIPT, '--config', configJson],
    ...(extraEnv ? { env: cleanEnv(extraEnv) } : {}),
  });

  const client = new Client({ name: 'test-client', version: '1.0.0' });
  await client.connect(transport);
  return client;
}

// ========== Tests ==========

describe('nuwax-mcp-stdio-proxy', () => {
  beforeAll(() => {
    if (!fs.existsSync(PROXY_SCRIPT)) {
      throw new Error(
        `Build output not found at ${PROXY_SCRIPT}. Run "npm run build" first.`,
      );
    }
    if (!fs.existsSync(MOCK_SERVER)) {
      throw new Error(`Mock server fixture not found at ${MOCK_SERVER}.`);
    }
  });

  // Track clients for cleanup after each test
  const activeClients: Client[] = [];

  afterEach(async () => {
    for (const client of activeClients) {
      try {
        await client.close();
      } catch {
        /* ignore */
      }
    }
    activeClients.length = 0;
  });

  // ---- CLI Error Handling (all platforms) ----

  describe('CLI error handling', () => {
    it('exits with error when --config is missing', async () => {
      const { code, stderr } = await spawnProxy([]);
      expect(code).toBe(1);
      expect(stderr).toContain('Missing');
      expect(stderr).toContain('Usage:');
    });

    it('exits with error for invalid JSON config', async () => {
      const { code, stderr } = await spawnProxy(['--config', '{not-json!!}']);
      expect(code).toBe(1);
      expect(stderr).toContain('Failed to parse --config JSON');
    });

    it('exits with error when mcpServers key is missing', async () => {
      const { code, stderr } = await spawnProxy(['--config', '{"foo":"bar"}']);
      expect(code).toBe(1);
      expect(stderr).toContain('must contain a "mcpServers" object');
    });

    it('exits with error for empty mcpServers', async () => {
      const { code, stderr } = await spawnProxy(['--config', '{"mcpServers":{}}']);
      expect(code).toBe(1);
      expect(stderr).toContain('No MCP servers configured');
    });

    it('exits with error when all child servers fail to connect', async () => {
      const config = JSON.stringify({
        mcpServers: {
          bad: { command: 'node', args: ['-e', 'process.exit(1)'], connectionTimeoutMs: 5000 },
        },
      });
      const { code, stderr } = await spawnProxy(['--config', config]);
      expect(code).toBe(1);
      expect(stderr).toContain('Failed to connect');
      expect(stderr).toContain('Failed to connect to any MCP server');
    });
  });

  // ---- Tool Aggregation (all platforms) ----

  describe('Tool aggregation — single server', () => {
    it('lists tools from a single child server', async () => {
      const client = await connectToProxy(
        singleServerConfig(['tool-alpha', 'tool-beta']),
      );
      activeClients.push(client);

      const { tools } = await client.listTools();
      expect(tools).toHaveLength(2);
      expect(tools.map((t) => t.name).sort()).toEqual(['tool-alpha', 'tool-beta']);
    });

    it('returns tool descriptions from child server', async () => {
      const client = await connectToProxy(singleServerConfig(['described-tool'], 'desc-srv'));
      activeClients.push(client);

      const { tools } = await client.listTools();
      expect(tools[0].description).toContain('described-tool');
    });
  });

  describe('Tool aggregation — multiple servers', () => {
    it('aggregates tools from multiple child servers', async () => {
      const client = await connectToProxy(
        multiServerConfig([
          { name: 'server-a', tools: ['tool-a1', 'tool-a2'] },
          { name: 'server-b', tools: ['tool-b1'] },
        ]),
      );
      activeClients.push(client);

      const { tools } = await client.listTools();
      expect(tools).toHaveLength(3);
      expect(tools.map((t) => t.name).sort()).toEqual(['tool-a1', 'tool-a2', 'tool-b1']);
    });

    it('handles tool name collision — last server wins, tool appears once', async () => {
      const client = await connectToProxy(
        multiServerConfig([
          { name: 'server-first', tools: ['shared-tool', 'unique-first'] },
          { name: 'server-second', tools: ['shared-tool', 'unique-second'] },
        ]),
      );
      activeClients.push(client);

      const { tools } = await client.listTools();
      // shared-tool should appear only once (from server-second, which overwrites server-first)
      const sharedTools = tools.filter((t) => t.name === 'shared-tool');
      expect(sharedTools).toHaveLength(1);
      // Description should be from server-second (last writer)
      expect(sharedTools[0].description).toContain('server-second');
      // Total: shared-tool + unique-first + unique-second = 3
      expect(tools).toHaveLength(3);
    });
  });

  // ---- Tool Routing (all platforms) ----

  describe('Tool routing', () => {
    it('routes tools/call to the correct child server', async () => {
      const client = await connectToProxy(
        multiServerConfig([
          { name: 'alpha', tools: ['tool-from-alpha'] },
          { name: 'beta', tools: ['tool-from-beta'] },
        ]),
      );
      activeClients.push(client);

      // Call tool-from-alpha → should be routed to "alpha" server
      const resultA = await client.callTool({ name: 'tool-from-alpha', arguments: {} });
      expect(resultA.content).toBeDefined();
      // Mock server responds with "serverName:toolName"
      const textA = (resultA.content as { type: string; text: string }[])[0]?.text;
      expect(textA).toBe('alpha:tool-from-alpha');

      // Call tool-from-beta → should be routed to "beta" server
      const resultB = await client.callTool({ name: 'tool-from-beta', arguments: {} });
      const textB = (resultB.content as { type: string; text: string }[])[0]?.text;
      expect(textB).toBe('beta:tool-from-beta');
    });

    it('returns error for unknown tool name', async () => {
      const client = await connectToProxy(singleServerConfig(['existing-tool']));
      activeClients.push(client);

      const result = await client.callTool({ name: 'nonexistent-tool', arguments: {} });
      expect(result.isError).toBe(true);
      const text = (result.content as { type: string; text: string }[])[0]?.text;
      expect(text).toContain('Unknown tool');
      expect(text).toContain('nonexistent-tool');
    });

    it('routes collision tool to last-registered server', async () => {
      const client = await connectToProxy(
        multiServerConfig([
          { name: 'first', tools: ['colliding-tool'] },
          { name: 'second', tools: ['colliding-tool'] },
        ]),
      );
      activeClients.push(client);

      const result = await client.callTool({ name: 'colliding-tool', arguments: {} });
      const text = (result.content as { type: string; text: string }[])[0]?.text;
      // Should be routed to "second" (last writer wins)
      expect(text).toBe('second:colliding-tool');
    });
  });

  // ---- Partial Startup (all platforms) ----

  describe('Partial startup', () => {
    it('continues with remaining servers when one fails to connect', async () => {
      const config = JSON.stringify({
        mcpServers: {
          'bad-server': {
            command: 'node',
            args: ['-e', 'process.exit(1)'],
            connectionTimeoutMs: 5000,
          },
          'good-server': {
            command: 'node',
            args: [MOCK_SERVER, '--tools', '["working-tool"]', '--name', 'good'],
          },
        },
      });

      const client = await connectToProxy(config);
      activeClients.push(client);

      const { tools } = await client.listTools();
      expect(tools).toHaveLength(1);
      expect(tools[0].name).toBe('working-tool');

      // Verify the working tool is callable
      const result = await client.callTool({ name: 'working-tool', arguments: {} });
      const text = (result.content as { type: string; text: string }[])[0]?.text;
      expect(text).toBe('good:working-tool');
    });
  });

  // ---- Environment Handling (all platforms) ----

  describe('Environment handling', () => {
    it('strips ELECTRON_RUN_AS_NODE from child server environment', async () => {
      // The mock server uses --assert-no-env to exit(1) if the var is set.
      // If the proxy correctly strips ELECTRON_RUN_AS_NODE, the mock server
      // starts successfully. If not stripped, mock server exits and proxy
      // fails to connect → client.connect() would throw.
      const config = singleServerConfig(['env-tool'], 'env-test', {
        assertNoEnv: 'ELECTRON_RUN_AS_NODE',
      });

      const client = await connectToProxy(config, { ELECTRON_RUN_AS_NODE: '1' });
      activeClients.push(client);

      // If we reach here, the mock server started → env was stripped
      const { tools } = await client.listTools();
      expect(tools).toHaveLength(1);
      expect(tools[0].name).toBe('env-tool');
    });

    it('merges per-server env variables into child environment', async () => {
      const config = JSON.stringify({
        mcpServers: {
          test: {
            command: 'node',
            args: [MOCK_SERVER, '--tools', '["env-merge-tool"]', '--name', 'env-merge'],
            env: { CUSTOM_TEST_VAR: 'hello-from-config' },
          },
        },
      });

      const client = await connectToProxy(config);
      activeClients.push(client);

      // If env merge fails, child server won't start and this will throw
      const { tools } = await client.listTools();
      expect(tools).toHaveLength(1);
    });
  });

  // ---- Signal Handling (macOS/Linux only — Windows has no POSIX signals) ----

  describe.skipIf(isWindows)('Signal handling (macOS/Linux)', () => {
    it('gracefully shuts down on SIGTERM', async () => {
      const config = singleServerConfig(['signal-tool']);

      const proc = spawn('node', [PROXY_SCRIPT, '--config', config], {
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let stderr = '';
      proc.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      // Wait for proxy to be fully ready
      await new Promise<void>((resolve) => {
        const onData = (data: Buffer) => {
          if (data.toString().includes('Proxy server running')) {
            proc.stderr?.off('data', onData);
            resolve();
          }
        };
        proc.stderr?.on('data', onData);
        // Timeout fallback
        setTimeout(resolve, 8000);
      });

      // Send SIGTERM
      proc.kill('SIGTERM');

      // Wait for exit
      const code = await new Promise<number | null>((resolve) => {
        proc.on('exit', (c) => resolve(c));
        setTimeout(() => {
          proc.kill('SIGKILL');
          resolve(null);
        }, 5000);
      });

      expect(code).toBe(0);
      expect(stderr).toContain('Received SIGTERM');
      expect(stderr).toContain('shutting down');
    });
  });

  // ---- Cross-Platform Smoke (all platforms) ----

  describe('Cross-platform compatibility', () => {
    it('proxy starts and serves tools on current platform', async () => {
      // Basic smoke test: proxy + mock server work on current OS
      const client = await connectToProxy(
        singleServerConfig(['cross-platform-tool'], 'platform-test'),
      );
      activeClients.push(client);

      const { tools } = await client.listTools();
      expect(tools).toHaveLength(1);

      const result = await client.callTool({
        name: 'cross-platform-tool',
        arguments: {},
      });
      expect(result.isError).toBeFalsy();
      const text = (result.content as { type: string; text: string }[])[0]?.text;
      expect(text).toBe('platform-test:cross-platform-tool');
    });

    it('handles config with special characters in tool names', async () => {
      const client = await connectToProxy(
        singleServerConfig(['tool-with-dashes', 'tool_with_underscores', 'tool.with.dots']),
      );
      activeClients.push(client);

      const { tools } = await client.listTools();
      expect(tools).toHaveLength(3);
      expect(tools.map((t) => t.name).sort()).toEqual([
        'tool-with-dashes',
        'tool.with.dots',
        'tool_with_underscores',
      ]);
    });
  });

  // ---- Convert CLI error handling ----

  describe('convert CLI error handling', () => {
    it('exits with error when no URL or --config provided', async () => {
      const { code, stderr } = await spawnProxy(['convert']);
      expect(code).toBe(1);
      expect(stderr).toContain('Either URL or --config is required');
    });

    it('exits with error for invalid --protocol value', async () => {
      const { code, stderr } = await spawnProxy(['convert', 'http://example.com', '--protocol', 'invalid']);
      expect(code).toBe(1);
      expect(stderr).toContain('Invalid protocol');
    });

    it('exits with error when both --allow-tools and --deny-tools used', async () => {
      const { code, stderr } = await spawnProxy([
        'convert', 'http://example.com',
        '--allow-tools', 'a',
        '--deny-tools', 'b',
      ]);
      expect(code).toBe(1);
      expect(stderr).toContain('Cannot use both --allow-tools and --deny-tools');
    });

    it('exits with error for unknown convert argument', async () => {
      const { code, stderr } = await spawnProxy(['convert', '--bad-flag']);
      expect(code).toBe(1);
      expect(stderr).toContain('Unknown argument');
    });

    it('exits with error when --name not found in config', async () => {
      const config = JSON.stringify({
        mcpServers: { svc: { url: 'http://example.com' } },
      });
      const { code, stderr } = await spawnProxy([
        'convert', '--config', config, '--name', 'nonexistent',
      ]);
      expect(code).toBe(1);
      expect(stderr).toContain('not found in config');
    });
  });

  // ---- Proxy CLI error handling ----

  describe('proxy CLI error handling', () => {
    it('exits with error when --port is missing', async () => {
      const config = singleServerConfig(['tool']);
      const { code, stderr } = await spawnProxy(['proxy', '--config', config]);
      expect(code).toBe(1);
      expect(stderr).toContain('--port is required');
    });

    it('exits with error when --config is missing', async () => {
      const { code, stderr } = await spawnProxy(['proxy', '--port', '9999']);
      expect(code).toBe(1);
      // CLI 支持 --config 或 --config-file，错误信息为 "--config or --config-file is required"
      expect(stderr).toContain('--config');
      expect(stderr).toContain('required');
    });

    it('exits with error for invalid port', async () => {
      const config = singleServerConfig(['tool']);
      const { code, stderr } = await spawnProxy(['proxy', '--port', '70000', '--config', config]);
      expect(code).toBe(1);
      expect(stderr).toContain('Invalid port');
    });
  });

  // ---- Proxy mode integration ----

  describe('proxy mode', () => {
    it('starts HTTP server and serves tools via StreamableHTTP', async () => {
      const config = singleServerConfig(['proxy-tool'], 'proxy-mock');

      // Start proxy in HTTP server mode (port 0 = random)
      const proc = spawn('node', [PROXY_SCRIPT, 'proxy', '--port', '0', '--config', config], {
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let stderrBuf = '';

      // 1) 等待 HTTP 端口输出
      const port = await new Promise<number>((resolve, reject) => {
        const tryMatch = () => {
          const match = stderrBuf.match(/HTTP server listening on 127\.0\.0\.1:(\d+)/);
          if (match) {
            resolve(parseInt(match[1], 10));
            return true;
          }
          return false;
        };
        proc.stderr?.on('data', (data: Buffer) => {
          stderrBuf += data.toString();
          tryMatch();
        });
        setTimeout(() => reject(new Error(`Timed out waiting for proxy server. stderr: ${stderrBuf}`)), 10000);
      });

      // 2) 等待 bridge 就绪（子进程 spawn 与 listTools 完成后再接受 /mcp/<serverId> 请求）
      await new Promise<void>((resolve, reject) => {
        if (stderrBuf.includes('Bridge ready on port')) {
          resolve();
          return;
        }
        const onData = (data: Buffer) => {
          stderrBuf += data.toString();
          if (stderrBuf.includes('Bridge ready on port')) {
            proc.stderr?.off('data', onData);
            resolve();
          }
        };
        proc.stderr?.on('data', onData);
        setTimeout(() => reject(new Error(`Timed out waiting for bridge ready. stderr: ${stderrBuf}`)), 15000);
      });

      try {
        // Connect via StreamableHTTP to the bridge endpoint
        const transport = new StreamableHTTPClientTransport(
          new URL(`http://127.0.0.1:${port}/mcp/proxy-mock`),
        );
        const client = new Client({ name: 'test', version: '1.0.0' });
        await client.connect(transport);

        const { tools } = await client.listTools();
        expect(tools).toHaveLength(1);
        expect(tools[0].name).toBe('proxy-tool');

        const result = await client.callTool({ name: 'proxy-tool', arguments: {} });
        const text = (result.content as { type: string; text: string }[])[0]?.text;
        expect(text).toBe('proxy-mock:proxy-tool');

        await client.close();
        await transport.close();
      } finally {
        proc.kill('SIGTERM');
        await new Promise<void>((resolve) => {
          proc.on('exit', () => resolve());
          setTimeout(() => { proc.kill('SIGKILL'); resolve(); }, 3000);
        });
      }
    });
  });
});
