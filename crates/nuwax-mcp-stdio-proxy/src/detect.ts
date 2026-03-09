/**
 * Protocol auto-detection — determine whether a URL serves Streamable HTTP or SSE
 *
 * Aligned with workspace/mcp-proxy (Rust) detection logic:
 * - Only probe Streamable HTTP (POST initialize)
 * - Default to SSE if probe fails
 */

import { logInfo, logWarn } from './logger.js';

/**
 * Detect the MCP transport protocol of a remote URL.
 *
 * Strategy (matches Rust mcp-proxy):
 * 1. Send a JSON-RPC initialize POST to probe for Streamable HTTP.
 * 2. Check 4 criteria — any match means streamable-http:
 *    a. Response has `mcp-session-id` header
 *    b. Content-Type is `text/event-stream` with 2xx status
 *    c. Response body is valid JSON-RPC 2.0
 *    d. Status is 406 Not Acceptable
 * 3. If probe fails or no criteria match → default to SSE.
 */
export async function detectProtocol(
  url: string,
  headers?: Record<string, string>,
): Promise<'sse' | 'stream'> {
  logInfo(`Auto-detecting protocol for ${url}...`);

  try {
    const reqHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      ...headers,
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5_000);

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

    // Check 1: mcp-session-id header (definitive Streamable HTTP marker)
    if (res.headers.get('mcp-session-id')) {
      logInfo(`Detected streamable-http protocol for ${url} (mcp-session-id header)`);
      cleanupSession(url, res.headers.get('mcp-session-id')!, headers);
      await res.text().catch(() => {});
      return 'stream';
    }

    const ct = res.headers.get('content-type') || '';

    // Check 2: text/event-stream content-type with success status
    if (ct.includes('text/event-stream') && res.ok) {
      logInfo(`Detected streamable-http protocol for ${url} (event-stream response)`);
      cleanupSession(url, res.headers.get('mcp-session-id'), headers);
      // Abort the stream to free the connection
      controller.abort();
      return 'stream';
    }

    // Read body for JSON-RPC check
    let bodyText = '';
    try { bodyText = await res.text(); } catch { /* ignore */ }

    // Check 3: valid JSON-RPC 2.0 response
    try {
      const json = JSON.parse(bodyText);
      if (json && json.jsonrpc === '2.0') {
        logInfo(`Detected streamable-http protocol for ${url} (JSON-RPC 2.0 response)`);
        cleanupSession(url, res.headers.get('mcp-session-id'), headers);
        return 'stream';
      }
    } catch { /* not JSON */ }

    // Check 4: 406 Not Acceptable (may indicate Streamable HTTP)
    if (res.status === 406) {
      logInfo(`Detected streamable-http protocol for ${url} (406 Not Acceptable)`);
      return 'stream';
    }
  } catch {
    // Probe failed (timeout, connection refused, etc.)
  }

  // Default to SSE (matches Rust mcp-proxy behavior)
  logWarn(`Could not detect streamable-http for ${url}, defaulting to SSE`);
  return 'sse';
}

/**
 * Clean up orphan session — fire-and-forget DELETE so the server
 * can discard the half-initialized session we created during probing.
 */
function cleanupSession(
  url: string,
  sessionId: string | null,
  headers?: Record<string, string>,
): void {
  if (!sessionId) return;
  fetch(url, {
    method: 'DELETE',
    headers: { 'mcp-session-id': sessionId, ...headers },
    signal: AbortSignal.timeout(5_000),
  }).catch(() => {});
}
