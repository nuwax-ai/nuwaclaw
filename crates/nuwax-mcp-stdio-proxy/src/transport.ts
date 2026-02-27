/**
 * Transport layer — connect to upstream MCP servers via stdio or bridge (HTTP)
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { StdioServerEntry, BridgeServerEntry } from './types.js';
import { logInfo } from './logger.js';

export interface ConnectedClient {
  client: Client;
  cleanup: () => Promise<void>;
}

/**
 * Build a clean env for child processes (strips ELECTRON_RUN_AS_NODE)
 */
export function buildBaseEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) {
      env[key] = value;
    }
  }
  // Child MCP servers should run normally, not as Electron Node.js instances
  delete env.ELECTRON_RUN_AS_NODE;
  return env;
}

/**
 * Connect to a stdio MCP server (spawn child process)
 */
export async function connectStdio(
  id: string,
  entry: StdioServerEntry,
  baseEnv: Record<string, string>,
): Promise<ConnectedClient> {
  logInfo(`Connecting to "${id}" (stdio): ${entry.command} ${(entry.args || []).join(' ')}`);

  const transport = new StdioClientTransport({
    command: entry.command,
    args: entry.args || [],
    env: { ...baseEnv, ...(entry.env || {}) },
  });

  // Attach stderr listener BEFORE connect to catch early child errors
  if (transport.stderr) {
    transport.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString().trim();
      if (text) {
        process.stderr.write(`[child:${id}] ${text}\n`);
      }
    });
  }

  const client = new Client({ name: `proxy-${id}`, version: '1.0.0' });
  await client.connect(transport);

  return {
    client,
    cleanup: async () => {
      try { await transport.close(); } catch { /* ignore */ }
    },
  };
}

/**
 * Connect to a bridge MCP server (StreamableHTTP → PersistentMcpBridge)
 *
 * Bridge connections target long-lived MCP servers managed by PersistentMcpBridge
 * in the Electron main process, accessed via HTTP endpoints.
 */
export async function connectBridge(
  id: string,
  entry: BridgeServerEntry,
): Promise<ConnectedClient> {
  logInfo(`Connecting to "${id}" (bridge): ${entry.url}`);

  const transport = new StreamableHTTPClientTransport(new URL(entry.url));
  const client = new Client({ name: `proxy-${id}`, version: '1.0.0' });
  await client.connect(transport);

  return {
    client,
    cleanup: async () => {
      try { await transport.close(); } catch { /* ignore */ }
    },
  };
}

/** @deprecated Use connectBridge instead */
export const connectHttp = connectBridge;
