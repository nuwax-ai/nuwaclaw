/**
 * Unit tests: detect.ts — protocol auto-detection
 *
 * Spins up minimal HTTP servers to simulate Streamable HTTP and SSE endpoints
 * so detectProtocol can probe them.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import * as http from 'http';
import { detectProtocol } from '../src/detect.js';
import { MCP_SESSION_ID_HEADER } from '../src/constants.js';

/** Start an HTTP server that responds according to the handler, returns URL + close fn */
async function startMockServer(
  handler: (req: http.IncomingMessage, res: http.ServerResponse) => void,
): Promise<{ url: string; close: () => Promise<void> }> {
  const server = http.createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address() as { port: number };
  return {
    url: `http://127.0.0.1:${addr.port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

describe('detectProtocol', () => {
  const servers: Array<{ close: () => Promise<void> }> = [];

  afterEach(async () => {
    for (const s of servers) {
      await s.close();
    }
    servers.length = 0;
  });

  it('detects streamable-http when server responds with JSON to POST', async () => {
    const mock = await startMockServer((req, res) => {
      if (req.method === 'POST') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ jsonrpc: '2.0', id: 1, result: {} }));
      } else if (req.method === 'DELETE') {
        res.writeHead(200);
        res.end();
      } else {
        res.writeHead(404);
        res.end();
      }
    });
    servers.push(mock);

    const result = await detectProtocol(mock.url);
    expect(result).toBe('stream');
  });

  it('defaults to SSE when POST probe is rejected (e.g. 405)', async () => {
    const mock = await startMockServer((req, res) => {
      if (req.method === 'POST') {
        // Reject POST so streamable-http probe fails
        res.writeHead(405);
        res.end();
      } else if (req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        // Write initial SSE comment to keep connection alive briefly
        res.write(': keep-alive\n\n');
        // Don't end — SSE streams are long-lived; detectProtocol will abort
      } else {
        res.writeHead(404);
        res.end();
      }
    });
    servers.push(mock);

    const result = await detectProtocol(mock.url);
    expect(result).toBe('sse');
  });

  it('defaults to sse when server rejects probe', async () => {
    const mock = await startMockServer((_req, res) => {
      res.writeHead(500);
      res.end('Internal Server Error');
    });
    servers.push(mock);

    const result = await detectProtocol(mock.url);
    expect(result).toBe('sse');
  });

  it('defaults to sse when server is unreachable', async () => {
    // Use a port that's almost certainly not listening
    const result = await detectProtocol('http://127.0.0.1:1');
    expect(result).toBe('sse');
  });

  it('passes custom headers to probes', async () => {
    let receivedAuth = '';
    const mock = await startMockServer((req, res) => {
      if (req.method === 'POST') {
        receivedAuth = req.headers['authorization'] as string;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ jsonrpc: '2.0', id: 1, result: {} }));
      } else if (req.method === 'DELETE') {
        res.writeHead(200);
        res.end();
      } else {
        res.writeHead(404);
        res.end();
      }
    });
    servers.push(mock);

    await detectProtocol(mock.url, { Authorization: 'Bearer test-token' });
    expect(receivedAuth).toBe('Bearer test-token');
  });

  it('sends DELETE to clean up orphan session after streamable-http detection', async () => {
    let deleteReceived = false;
    let deleteSessionId = '';
    const mock = await startMockServer((req, res) => {
      if (req.method === 'POST') {
        res.writeHead(200, {
          'Content-Type': 'application/json',
          [MCP_SESSION_ID_HEADER]: 'test-session-123',
        });
        res.end(JSON.stringify({ jsonrpc: '2.0', id: 1, result: {} }));
      } else if (req.method === 'DELETE') {
        deleteReceived = true;
        deleteSessionId = req.headers[MCP_SESSION_ID_HEADER] as string;
        res.writeHead(200);
        res.end();
      } else {
        res.writeHead(404);
        res.end();
      }
    });
    servers.push(mock);

    const result = await detectProtocol(mock.url);
    expect(result).toBe('stream');
    // Poll for the fire-and-forget DELETE to arrive
    await vi.waitFor(() => {
      expect(deleteReceived).toBe(true);
      expect(deleteSessionId).toBe('test-session-123');
    }, { timeout: 2000 });
  });
});
