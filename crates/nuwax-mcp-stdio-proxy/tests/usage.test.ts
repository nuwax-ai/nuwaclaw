/**
 * Usage Examples & Integration Tests
 *
 * This test suite demonstrates how a downstream client (like an Electron app
 * or Agent OS manager) configuration translates to nuwax-mcp-stdio-proxy execution.
 * It is adapted from real usage patterns in agent-electron-client.
 */

import { describe, it, expect } from 'vitest';
import { spawn } from 'child_process';
import * as path from 'path';

const PROXY_SCRIPT = path.resolve('dist/index.js');

/**
 * Helper to test CLI arg parsing and proxy behavior
 * without actually completing a full connection (we just check its stderr rejection to see if it understood args).
 */
function spawnProxy(
  args: string[],
  options?: { env?: Record<string, string>; timeoutMs?: number },
): Promise<{ code: number | null; stderr: string; stdout: string }> {
  return new Promise((resolve) => {
    const proc = spawn('node', [PROXY_SCRIPT, ...args], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ...options?.env }, // inherit to keep vitest happy
    });

    let stderr = '';
    let stdout = '';
    
    proc.stderr?.on('data', (d) => (stderr += d.toString()));
    proc.stdout?.on('data', (d) => (stdout += d.toString()));

    proc.on('exit', (code) => {
      resolve({ code, stderr, stdout });
    });

    setTimeout(() => proc.kill(), options?.timeoutMs ?? 15000);
  });
}

describe('Proxy Usage Examples (from agent-electron-client)', () => {
  it('Example 1: Downstream client creates temporary stdio proxy configuration', async () => {
    // In agent-electron-client, mcpProxyManager builds a config for the proxy
    // to aggregate multiple temporary MCP servers.
    const config = {
      mcpServers: {
        'test-mcp': {
          command: 'node',
          args: ['-e', 'console.log("dummy-server")'],
        },
      },
    };
    
    const configString = JSON.stringify(config);

    // The proxy is then invoked with this config via standard stdio
    const { code, stderr } = await spawnProxy(['--config', configString]);
    
    // We expect the proxy to start and immediately fail because our dummy server isn't a REAL MCP server
    // (it just prints 'dummy-server' and exits), but we can verify the proxy accepted the config
    // and attempted to spawn "test-mcp".
    expect(code).toBe(1); // Exits 1 because child server dies immediately
    expect(stderr).toContain('test-mcp');
    expect(stderr).toContain('Failed to connect to any MCP server');
  });

  it('Example 2: Downstream client routes to a persistent bridge', async () => {
    // When the PersistentMcpBridge is running in agent-electron-client,
    // it maps standard subprocess configs to HTTP URLs.
    const proxyConfig = {
      mcpServers: {
        'chrome-devtools': {
          url: 'http://127.0.0.1:12345/mcp/chrome-devtools',
        },
      },
    };
    
    const configString = JSON.stringify(proxyConfig);
    
    // The downstream client spawns the proxy expecting it to convert that HTTP URL into stdio
    const { code, stderr } = await spawnProxy(['--config', configString]);
    
    // It should fail to connect (fetch error) since port 12345 has no real server,
    // but the CLI should parse it cleanly as a bridged remote server.
    // Due to the timeout wrapper, it throws "timed out after 5s".
    expect(stderr).toContain('chrome-devtools');
    expect(stderr).toContain('timed out'); // fetch failed via timeout wrapper
  }, 20000);

  it('Example 3: Downstream client mixed temporary and bridged configs', async () => {
    // agent-electron-client frequently mixes "temporary" (stdio) tools
    // with "persistent" (bridged) tools in the same proxy call.
    const mixedConfig = {
      mcpServers: {
        'local-tool': {
          command: 'node',
          args: ['-e', 'process.exit(1)'],
        },
        'remote-bridge': {
          url: 'http://127.0.0.1:12346/mcp/remote-bridge'
        }
      }
    };
    
    const { code, stderr } = await spawnProxy(['--config', JSON.stringify(mixedConfig)]);
    
    // Proxy should try to aggregate both
    expect(stderr).toContain('local-tool');
    expect(stderr).toContain('timed out');
  }, 20000);
});
