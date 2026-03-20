/**
 * Transport layer — connect to upstream MCP servers via stdio, Streamable HTTP, or SSE
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { CustomStdioClientTransport } from '../customStdio.js';
import type { StdioServerEntry, StreamableServerEntry, SseServerEntry } from '../types.js';
import { logInfo } from '../logger.js';
import { ResilientTransportWrapper } from '../resilient.js';

// Re-export sub-modules
export { buildBaseEnv } from './env.js';
export { buildRequestHeaders } from './headers.js';
export type { ConnectedClient } from './types.js';

const DEFAULT_STDIO_CONNECTION_TIMEOUT_MS = 60_000;
// HTTP timeout reduced to 20s to avoid race with nuwaxcode's 30s session/new timeout
// When a server fails (e.g., auth error), ResilientTransportWrapper retries indefinitely,
// but this timeout ensures we fail fast and let other servers load.
const DEFAULT_HTTP_CONNECTION_TIMEOUT_MS = 20_000;

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
 * Connect to a stdio MCP server (spawn child process)
 */
export async function connectStdio(
  id: string,
  entry: StdioServerEntry,
  baseEnv: Record<string, string>,
): Promise<import('./types.js').ConnectedClient> {
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

  // Set reconnect handler to re-establish MCP session via client.connect()
  // Note: Must close the client first to clear the "already connected" state
  wrapper.onreconnect = async () => {
    try { await client.close(); } catch { /* ignore */ }
    await client.connect(wrapper);
  };

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
): Promise<import('./types.js').ConnectedClient> {
  logInfo(`Connecting to "${id}" (streamable-http): ${entry.url}`);

  const { buildRequestHeaders } = await import('./headers.js');
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
    // Use provided interval or default (15s)
    pingIntervalMs: entry.pingIntervalMs,
    pingTimeoutMs: entry.pingTimeoutMs,
  });

  const client = new Client({ name: `proxy-${id}`, version: '1.0.0' });

  // Set health check function to use listTools() for keeping connection alive
  // Each heartbeat is a new HTTP request but reuses session via mcp-session-id
  wrapper.setHealthCheckFn(async () => {
    try {
      await client.listTools();
      return true;
    } catch {
      return false;
    }
  });

  // Set reconnect handler to re-establish MCP session via client.connect()
  // Note: Must close the client first to clear the "already connected" state
  wrapper.onreconnect = async () => {
    try { await client.close(); } catch { /* ignore */ }
    await client.connect(wrapper);
  };

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
): Promise<import('./types.js').ConnectedClient> {
  logInfo(`Connecting to "${id}" (sse): ${entry.url}`);

  const { buildRequestHeaders } = await import('./headers.js');
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
    // Use provided interval or default (15s)
    pingIntervalMs: entry.pingIntervalMs,
    pingTimeoutMs: entry.pingTimeoutMs,
  });

  const client = new Client({ name: `proxy-${id}`, version: '1.0.0' });

  // Set health check function to use listTools() for keeping connection alive
  // Each heartbeat is a new HTTP request but reuses session via mcp-session-id
  wrapper.setHealthCheckFn(async () => {
    try {
      await client.listTools();
      return true;
    } catch {
      return false;
    }
  });

  // Set reconnect handler to re-establish MCP session via client.connect()
  // Note: Must close the client first to clear the "already connected" state
  wrapper.onreconnect = async () => {
    try { await client.close(); } catch { /* ignore */ }
    await client.connect(wrapper);
  };

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
