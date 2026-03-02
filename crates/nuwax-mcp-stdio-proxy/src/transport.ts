/**
 * Transport layer — connect to upstream MCP servers via stdio, Streamable HTTP, or SSE
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { CustomStdioClientTransport } from './customStdio.js';
import type { StdioServerEntry, StreamableServerEntry, SseServerEntry } from './types.js';
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
 * Build HTTP headers from entry config (merge headers + authToken)
 */
export function buildRequestHeaders(
  entry: StreamableServerEntry | SseServerEntry,
): Record<string, string> | undefined {
  const headers: Record<string, string> = {};
  if (entry.headers) {
    Object.assign(headers, entry.headers);
  }
  if (entry.authToken) {
    headers['Authorization'] = `Bearer ${entry.authToken}`;
  }
  return Object.keys(headers).length > 0 ? headers : undefined;
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

  const transport = new CustomStdioClientTransport({
    command: entry.command,
    args: entry.args || [],
    env: { ...baseEnv, ...(entry.env || {}) },
    stderr: 'pipe',
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
 * Connect to a Streamable HTTP MCP server
 *
 * Supports PersistentMcpBridge endpoints and any remote MCP service using
 * the Streamable HTTP transport protocol.
 */
export async function connectStreamable(
  id: string,
  entry: StreamableServerEntry,
): Promise<ConnectedClient> {
  logInfo(`Connecting to "${id}" (streamable-http): ${entry.url}`);

  const headers = buildRequestHeaders(entry);
  const url = new URL(entry.url);

  const transport = new StreamableHTTPClientTransport(
    url,
    headers ? { requestInit: { headers } } : undefined,
  );
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
 * Connect to an SSE MCP server
 *
 * Uses the legacy SSE (Server-Sent Events) transport for MCP servers
 * that don't support the newer Streamable HTTP protocol.
 */
export async function connectSse(
  id: string,
  entry: SseServerEntry,
): Promise<ConnectedClient> {
  logInfo(`Connecting to "${id}" (sse): ${entry.url}`);

  const headers = buildRequestHeaders(entry);
  const url = new URL(entry.url);

  const transport = new SSEClientTransport(
    url,
    headers ? { requestInit: { headers } } : undefined,
  );
  const client = new Client({ name: `proxy-${id}`, version: '1.0.0' });
  await client.connect(transport);

  return {
    client,
    cleanup: async () => {
      try { await transport.close(); } catch { /* ignore */ }
    },
  };
}

/** @deprecated Use connectStreamable instead */
export const connectBridge = connectStreamable;

/** @deprecated Use connectStreamable instead */
export const connectHttp = connectStreamable;
