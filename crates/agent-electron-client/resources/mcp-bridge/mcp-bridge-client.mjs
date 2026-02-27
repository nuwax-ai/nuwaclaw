#!/usr/bin/env node
/**
 * mcp-bridge-client.mjs — stdio ↔ HTTP 桥接客户端 (ESM)
 *
 * 由 ACP 引擎每 session spawn，连接 Electron 主进程的 PersistentMcpBridge HTTP server，
 * 聚合持久化 MCP server 的 tools 并暴露为 stdio MCP endpoint。
 *
 * 用法:
 *   node mcp-bridge-client.mjs '{"chrome-devtools":"http://127.0.0.1:PORT/mcp/chrome-devtools"}'
 *
 * 依赖 @modelcontextprotocol/sdk（通过 NODE_PATH 从 ~/.nuwax-agent/node_modules/ 解析；
 * Node 20+ 需确保运行时可解析到该包，如从含 node_modules 的目录执行或设置 NODE_PATH）
 */

import { Client } from '@modelcontextprotocol/sdk/client';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { Server } from '@modelcontextprotocol/sdk/server';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

// ==================== Parse Args ====================

const bridgeUrlsJson = process.argv[2];
if (!bridgeUrlsJson) {
  process.stderr.write('Usage: mcp-bridge-client.mjs \'{"name":"http://..."}\'\n');
  process.exit(1);
}

let bridgeUrls;
try {
  bridgeUrls = JSON.parse(bridgeUrlsJson);
} catch (e) {
  process.stderr.write(`Failed to parse bridge URLs: ${e.message}\n`);
  process.exit(1);
}

// ==================== Connect to Persistent Servers ====================

/** @type {Map<string, {client: InstanceType<typeof Client>, tools: Array<{name: string}>}>} */
const connectedServers = new Map();

/** @type {Map<string, string>} tool name → server ID */
const toolToServer = new Map();

/** @type {Array<object>} aggregated tools */
let allTools = [];

async function connectAll() {
  const entries = Object.entries(bridgeUrls);
  process.stderr.write(`[mcp-bridge-client] Connecting to ${entries.length} persistent server(s)...\n`);

  await Promise.all(entries.map(async ([serverId, url]) => {
    try {
      const transport = new StreamableHTTPClientTransport(new URL(url));
      const client = new Client(
        { name: `bridge-client-${serverId}`, version: '1.0.0' },
        { capabilities: {} },
      );

      await client.connect(transport);

      const result = await client.listTools();
      const tools = result.tools || [];

      connectedServers.set(serverId, { client, tools });

      for (const tool of tools) {
        toolToServer.set(tool.name, serverId);
        allTools.push(tool);
      }

      process.stderr.write(`[mcp-bridge-client] Connected to "${serverId}": ${tools.length} tools (${tools.map(t => t.name).join(', ')})\n`);
    } catch (e) {
      process.stderr.write(`[mcp-bridge-client] Failed to connect to "${serverId}" at ${url}: ${e.message}\n`);
    }
  }));

  process.stderr.write(`[mcp-bridge-client] Total: ${allTools.length} tools from ${connectedServers.size} server(s)\n`);
}

// ==================== Expose via Stdio ====================

async function main() {
  await connectAll();

  if (allTools.length === 0) {
    process.stderr.write('[mcp-bridge-client] No tools available, exiting\n');
    process.exit(1);
  }

  // Create an MCP Server that aggregates all persistent tools
  const server = new Server(
    { name: 'nuwax-mcp-bridge-client', version: '1.0.0' },
    {
      capabilities: {
        tools: {},
      },
    },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return { tools: allTools };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const toolName = request.params.name;
    const serverId = toolToServer.get(toolName);

    if (!serverId) {
      return {
        content: [{ type: 'text', text: `Unknown tool: ${toolName}` }],
        isError: true,
      };
    }

    const entry = connectedServers.get(serverId);
    if (!entry) {
      return {
        content: [{ type: 'text', text: `Server "${serverId}" not connected` }],
        isError: true,
      };
    }

    try {
      const result = await entry.client.callTool({
        name: toolName,
        arguments: request.params.arguments,
      });
      return result;
    } catch (e) {
      return {
        content: [{ type: 'text', text: `Tool call failed: ${e.message}` }],
        isError: true,
      };
    }
  });

  // Connect to stdio (parent process communication)
  const transport = new StdioServerTransport();
  await server.connect(transport);

  process.stderr.write('[mcp-bridge-client] Stdio server ready\n');

  // Graceful shutdown
  process.on('SIGTERM', async () => {
    process.stderr.write('[mcp-bridge-client] SIGTERM received, shutting down...\n');
    await server.close();
    for (const [, entry] of connectedServers) {
      try { await entry.client.close(); } catch { /* ignore */ }
    }
    process.exit(0);
  });

  process.on('SIGINT', async () => {
    await server.close();
    process.exit(0);
  });
}

main().catch((e) => {
  process.stderr.write(`[mcp-bridge-client] Fatal error: ${e.message}\n${e.stack}\n`);
  process.exit(1);
});
