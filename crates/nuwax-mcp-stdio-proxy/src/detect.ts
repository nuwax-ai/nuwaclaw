/**
 * Protocol auto-detection — determine whether a URL serves Streamable HTTP or SSE
 */

import { logInfo, logWarn } from './logger.js';

/**
 * Detect the MCP transport protocol of a remote URL.
 *
 * Strategy:
 * 1. Try Streamable HTTP first: send a JSON-RPC initialize POST.
 *    If the server responds with 200 and JSON, it's streamable-http.
 *    Then clean up the orphan session via DELETE.
 * 2. If that fails, try SSE: send a GET and check for text/event-stream content-type.
 * 3. Default to 'stream' (Streamable HTTP) if both probes fail.
 */
export async function detectProtocol(
  url: string,
  headers?: Record<string, string>,
): Promise<'sse' | 'stream'> {
  logInfo(`Auto-detecting protocol for ${url}...`);

  // 1. Try Streamable HTTP — POST a JSON-RPC initialize request
  try {
    const reqHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      ...headers,
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);

    const res = await fetch(url, {
      method: 'POST',
      headers: reqHeaders,
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-03-26',
          capabilities: {},
          clientInfo: { name: 'nuwax-mcp-detect', version: '1.0.0' },
        },
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    const ct = res.headers.get('content-type') || '';
    if (res.ok && (ct.includes('application/json') || ct.includes('text/event-stream'))) {
      logInfo(`Detected streamable-http protocol for ${url}`);
      // Consume body to avoid socket hang
      await res.text().catch(() => {});

      // Clean up orphan session — fire-and-forget DELETE so the server
      // can discard the half-initialized session we created during probing.
      // Not awaited: cleanup is best-effort and must not block detection.
      const sessionId = res.headers.get('mcp-session-id');
      if (sessionId) {
        fetch(url, {
          method: 'DELETE',
          headers: { 'mcp-session-id': sessionId, ...headers },
          signal: AbortSignal.timeout(5_000),
        }).catch(() => {});
      }

      return 'stream';
    }
    await res.text().catch(() => {});
  } catch {
    // Streamable HTTP probe failed, try SSE
  }

  // 2. Try SSE — GET and check for event-stream
  try {
    const reqHeaders: Record<string, string> = {
      Accept: 'text/event-stream',
      ...headers,
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);

    const res = await fetch(url, {
      method: 'GET',
      headers: reqHeaders,
      signal: controller.signal,
    });

    const ct = res.headers.get('content-type') || '';
    if (ct.includes('text/event-stream')) {
      // Detected SSE — abort the stream before clearing the timeout
      clearTimeout(timeout);
      logInfo(`Detected SSE protocol for ${url}`);
      controller.abort();
      return 'sse';
    }

    clearTimeout(timeout);
    await res.text().catch(() => {});
  } catch {
    // SSE probe failed
  }

  // 3. Default to streamable-http
  logWarn(`Could not auto-detect protocol for ${url}, defaulting to streamable-http`);
  return 'stream';
}
