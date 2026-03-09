/**
 * Demo: MCP SSE Server (Legacy)
 *
 * 用于本地测试 ResilientTransportWrapper 对 SSE transport 的重连 + re-initialize。
 *
 * 用法:
 *   node demo/sse-server.mjs [port]
 *
 * 默认监听:
 *   SSE 连接: GET  http://127.0.0.1:18081/sse
 *   消息接收: POST http://127.0.0.1:18081/message?sessionId=xxx
 *
 * 测试方式:
 *   1. 启动此 server
 *   2. 用 mcp-proxy 连接 http://127.0.0.1:18081/sse
 *   3. Ctrl+C 杀掉 server → proxy 触发重连
 *   4. 重新启动 server → proxy 自动 re-initialize + heartbeat 恢复
 */

import { createServer } from 'node:http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';

const PORT = parseInt(process.argv[2] || '18081', 10);

// --- MCP Server with demo tools ---

function createMcpServer() {
  const server = new McpServer({
    name: 'demo-sse',
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

/** @type {Record<string, SSEServerTransport>} */
const sessions = {};

const httpServer = createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);

  if (url.pathname === '/sse' && req.method === 'GET') {
    // New SSE connection
    const transport = new SSEServerTransport('/message', res);
    const sessionId = transport.sessionId;
    sessions[sessionId] = transport;

    console.log(`✅ SSE session created: ${sessionId}`);

    transport.onclose = () => {
      delete sessions[sessionId];
      console.log(`🔴 SSE session closed: ${sessionId}`);
    };

    const mcpServer = createMcpServer();
    // connect() internally calls transport.start(), do NOT call start() again
    await mcpServer.connect(transport);
    return;
  }

  if (url.pathname === '/message' && req.method === 'POST') {
    const sessionId = url.searchParams.get('sessionId');
    if (!sessionId || !sessions[sessionId]) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        jsonrpc: '2.0',
        error: { code: -32000, message: 'Invalid or missing sessionId' },
        id: null,
      }));
      return;
    }

    // Read body
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks).toString();

    await sessions[sessionId].handlePostMessage(req, res, JSON.parse(body));
    return;
  }

  res.writeHead(404);
  res.end('Not Found');
});

httpServer.listen(PORT, '127.0.0.1', () => {
  console.log(`🚀 SSE MCP Server listening on http://127.0.0.1:${PORT}/sse`);
  console.log(`   Tools: echo, time`);
  console.log(`   Ctrl+C to stop (simulate server crash for reconnect testing)`);
});
