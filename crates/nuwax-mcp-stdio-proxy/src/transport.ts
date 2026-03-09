/**
 * Transport layer — connect to upstream MCP servers via stdio, Streamable HTTP, or SSE
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { CustomStdioClientTransport } from './customStdio.js';
import type { StdioServerEntry, StreamableServerEntry, SseServerEntry } from './types.js';
import { logInfo } from './logger.js';

import { ResilientTransportWrapper } from './resilient.js';

const DEFAULT_STDIO_CONNECTION_TIMEOUT_MS = 60_000;
const DEFAULT_HTTP_CONNECTION_TIMEOUT_MS = 30_000;

export interface ConnectedClient {
  client: Client;
  cleanup: () => Promise<void>;
  transport: Transport;
}

/**
 * Helper to wrap a promise with a timeout
 */
async function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout>;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(message)), ms);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    clearTimeout(timeoutId!);
  }
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

  const wrapper = new ResilientTransportWrapper({
    name: id,
    connectParams: async () => {
      const t = new CustomStdioClientTransport({
        command: entry.command,
        args: entry.args || [],
        env: { ...baseEnv, ...(entry.env || {}) },
        stderr: 'pipe',
      });
      if (t.stderr) {
        t.stderr.on('data', (chunk: Buffer) => {
          const text = chunk.toString().trim();
          if (text) {
            process.stderr.write(`[child:${id}] ${text}\n`);
          }
        });
      }
      return t;
    },
    // No heartbeat for stdio — child process close/error events handle detection
    pingIntervalMs: 0,
  });

  const client = new Client({ name: `proxy-${id}`, version: '1.0.0' });

  const timeoutMs = entry.connectionTimeoutMs ?? DEFAULT_STDIO_CONNECTION_TIMEOUT_MS;

  try {
    await withTimeout(
      (async () => {
        await wrapper.start();
        await client.connect(wrapper);
      })(),
      timeoutMs,
      `Connection initialization timed out after ${timeoutMs / 1000}s`
    );
  } catch (err) {
    try { await wrapper.close(); } catch { /* ignore */ }
    throw err;
  }

  return {
    client,
    transport: wrapper,
    cleanup: async () => {
      try { await wrapper.close(); } catch { /* ignore */ }
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

  const wrapper = new ResilientTransportWrapper({
    name: id,
    connectParams: async () => {
      return new StreamableHTTPClientTransport(
        url,
        headers ? { requestInit: { headers } } : undefined,
      );
    },
    pingIntervalMs: entry.pingIntervalMs,
    pingTimeoutMs: entry.pingTimeoutMs,
  });

  const client = new Client({ name: `proxy-${id}`, version: '1.0.0' });

  const timeoutMs = entry.connectionTimeoutMs ?? DEFAULT_HTTP_CONNECTION_TIMEOUT_MS;

  try {
    await withTimeout(
      (async () => {
        await wrapper.start();
        await client.connect(wrapper);
        wrapper.enableHeartbeat(); // Start heartbeat AFTER MCP initialize completes
      })(),
      timeoutMs,
      `Connection initialization timed out after ${timeoutMs / 1000}s`
    );
  } catch (err) {
    try { await wrapper.close(); } catch { /* ignore */ }
    throw err;
  }

  return {
    client,
    transport: wrapper,
    cleanup: async () => {
      try { await wrapper.close(); } catch { /* ignore */ }
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

  const wrapper = new ResilientTransportWrapper({
    name: id,
    connectParams: async () => {
      return new SSEClientTransport(
        url,
        headers ? { requestInit: { headers } } : undefined,
      );
    },
    pingIntervalMs: entry.pingIntervalMs,
    pingTimeoutMs: entry.pingTimeoutMs,
  });

  const client = new Client({ name: `proxy-${id}`, version: '1.0.0' });

  const timeoutMs = entry.connectionTimeoutMs ?? DEFAULT_HTTP_CONNECTION_TIMEOUT_MS;

  try {
    await withTimeout(
      (async () => {
        await wrapper.start();
        await client.connect(wrapper);
        wrapper.enableHeartbeat(); // Start heartbeat AFTER MCP initialize completes
      })(),
      timeoutMs,
      `Connection initialization timed out after ${timeoutMs / 1000}s`
    );
  } catch (err) {
    try { await wrapper.close(); } catch { /* ignore */ }
    throw err;
  }

  return {
    client,
    transport: wrapper,
    cleanup: async () => {
      try { await wrapper.close(); } catch { /* ignore */ }
    },
  };
}

/** @deprecated Use connectStreamable instead */
export const connectBridge = connectStreamable;

/** @deprecated Use connectStreamable instead */
export const connectHttp = connectStreamable;
