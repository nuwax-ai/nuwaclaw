/**
 * Demo: MCP Streamable HTTP Server
 *
 * 用于本地测试 ResilientTransportWrapper 的重连 + re-initialize 行为。
 *
 * 用法:
 *   node demo/streamable-http-server.mjs [port]
 *
 * 默认监听 http://127.0.0.1:18080/mcp
 *
 * 测试方式:
 *   1. 启动此 server
 *   2. 用 mcp-proxy 连接 http://127.0.0.1:18080/mcp
 *   3. Ctrl+C 杀掉 server → proxy 触发重连
 *   4. 重新启动 server → proxy 自动 re-initialize + heartbeat 恢复
 */

import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

const PORT = parseInt(process.argv[2] || '18080', 10);

// --- MCP Server with demo tools ---

function createMcpServer() {
  const server = new McpServer({
    name: 'demo-streamable-http',
    version: '1.0.0',
  });

  server.tool('echo', 'Echo back the input', { message: { type: 'string' } }, async ({ message }) => ({
    content: [{ type: 'text', text: `[echo] ${message}` }],
  }));

  server.tool('time', 'Return current server time', {}, async () => ({
    content: [{ type: 'text', text: new Date().toISOString() }],
  }));

  return server;
}

// --- Session management ---

/** @type {Record<string, StreamableHTTPServerTransport>} */
const sessions = {};

const httpServer = createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  if (url.pathname !== '/mcp') {
    res.writeHead(404);
    res.end('Not Found');
    return;
  }

  const sessionId = req.headers['mcp-session-id'];

  if (req.method === 'POST') {
    // Read body
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString());

    if (sessionId && sessions[sessionId]) {
      // Existing session
      await sessions[sessionId].handleRequest(req, res, body);
      return;
    }

    // New session (initialize request)
    if (!sessionId && body?.method === 'initialize') {
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (id) => {
          sessions[id] = transport;
          console.log(`✅ Session created: ${id}`);
        },
      });

      transport.onclose = () => {
        if (transport.sessionId) {
          delete sessions[transport.sessionId];
          console.log(`🔴 Session closed: ${transport.sessionId}`);
        }
      };

      const mcpServer = createMcpServer();
      await mcpServer.connect(transport);
      await transport.handleRequest(req, res, body);
      return;
    }

    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      jsonrpc: '2.0',
      error: { code: -32000, message: 'Bad Request: Server not initialized' },
      id: body?.id ?? null,
    }));
    return;
  }

  if (req.method === 'GET') {
    // SSE stream for existing session
    if (sessionId && sessions[sessionId]) {
      await sessions[sessionId].handleRequest(req, res);
      return;
    }
    res.writeHead(400);
    res.end('Invalid session');
    return;
  }

  if (req.method === 'DELETE') {
    // Session termination
    if (sessionId && sessions[sessionId]) {
      await sessions[sessionId].handleRequest(req, res);
      return;
    }
    res.writeHead(404);
    res.end('Session not found');
    return;
  }

  res.writeHead(405);
  res.end('Method Not Allowed');
});

httpServer.listen(PORT, '127.0.0.1', () => {
  console.log(`🚀 Streamable HTTP MCP Server listening on http://127.0.0.1:${PORT}/mcp`);
  console.log(`   Tools: echo, time`);
  console.log(`   Ctrl+C to stop (simulate server crash for reconnect testing)`);
});
