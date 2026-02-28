/**
 * nuwax-mcp-stdio-proxy
 *
 * A pure TypeScript stdio MCP proxy that aggregates multiple MCP servers
 * into a single MCP server endpoint. Supports two upstream transport types:
 *
 * - **stdio**: Spawns child MCP server processes (StdioClientTransport)
 * - **bridge**: Connects to persistent MCP Bridge servers via StreamableHTTP (StreamableHTTPClientTransport)
 *
 * Usage:
 *   nuwax-mcp-stdio-proxy --config '{"mcpServers":{
 *     "local":  {"command":"npx","args":["-y","some-mcp"]},
 *     "remote": {"url":"http://127.0.0.1:8080/mcp/name"}  // bridge to persistent server
 *   }}'
 *
 * Architecture:
 *   Agent Engine (stdin/stdout)  ←→  This Proxy (StdioServerTransport)
 *                                         ├→ Child MCP Server A (StdioClientTransport)
 *                                         ├→ Bridge MCP Server B (StreamableHTTPClientTransport)
 *                                         └→ ...
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';

import type { McpServersConfig } from './types.js';
import { isHttpEntry } from './types.js';
import { logInfo, logWarn, logError } from './logger.js';
import { buildBaseEnv, connectStdio, connectBridge } from './transport.js';

// Injected at build time by esbuild define (see build.mjs)
// Falls back to static values when running via tsc in development
const PKG_NAME = process.env.__MCP_PROXY_PKG_NAME__ || 'nuwax-mcp-stdio-proxy';
const PKG_VERSION = process.env.__MCP_PROXY_PKG_VERSION__ || '0.0.0-dev';

// ========== CLI ==========

function parseConfig(): McpServersConfig {
  const args = process.argv.slice(2);
  const idx = args.indexOf('--config');

  if (idx === -1 || idx + 1 >= args.length) {
    logError('Missing --config argument');
    logError('Usage: nuwax-mcp-stdio-proxy --config \'{"mcpServers":{...}}\'');
    process.exit(1);
  }

  try {
    const config = JSON.parse(args[idx + 1]) as McpServersConfig;
    if (!config.mcpServers || typeof config.mcpServers !== 'object') {
      throw new Error('config must contain a "mcpServers" object');
    }
    return config;
  } catch (e) {
    logError(`Failed to parse --config JSON: ${e}`);
    process.exit(1);
  }
}

// ========== Main ==========

async function main(): Promise<void> {
  const config = parseConfig();
  const entries = Object.entries(config.mcpServers);

  if (entries.length === 0) {
    logError('No MCP servers configured in mcpServers');
    process.exit(1);
  }

  logInfo(
    `Starting proxy with ${entries.length} server(s): ${entries.map(([id]) => id).join(', ')}`,
  );

  // ---- Phase 1: Connect to all MCP servers (stdio + bridge) ----

  const baseEnv = buildBaseEnv();

  const clients = new Map<string, Client>();
  const cleanups = new Map<string, () => Promise<void>>();
  const toolToClient = new Map<string, Client>();
  const toolToServer = new Map<string, string>();
  const toolsByName = new Map<string, Tool>();

  for (const [id, entry] of entries) {
    try {
      const { client, cleanup } = isHttpEntry(entry)
        ? await connectBridge(id, entry)
        : await connectStdio(id, entry, baseEnv);

      clients.set(id, client);
      cleanups.set(id, cleanup);

      // Discover tools (handle pagination)
      const allServerTools: Tool[] = [];
      let cursor: string | undefined;
      do {
        const page = await client.listTools(cursor ? { cursor } : undefined);
        allServerTools.push(...page.tools);
        cursor = page.nextCursor;
      } while (cursor);

      logInfo(
        `Server "${id}": ${allServerTools.length} tool(s)${allServerTools.length > 0 ? ' — ' + allServerTools.map((t) => t.name).join(', ') : ''}`,
      );

      for (const tool of allServerTools) {
        if (toolToClient.has(tool.name)) {
          logWarn(
            `Tool "${tool.name}" from "${id}" shadows existing tool from "${toolToServer.get(tool.name)}"`,
          );
        }
        toolToClient.set(tool.name, client);
        toolToServer.set(tool.name, id);
        toolsByName.set(tool.name, tool);
      }
    } catch (e) {
      logError(`Failed to connect to server "${id}": ${e}`);
      // Continue with remaining servers — partial startup is acceptable
    }
  }

  if (clients.size === 0) {
    logError('Failed to connect to any MCP server');
    process.exit(1);
  }

  const aggregatedTools = Array.from(toolsByName.values());
  logInfo(`Aggregated ${aggregatedTools.length} unique tool(s) from ${clients.size} server(s)`);

  // ---- Phase 2: Create the aggregating MCP server ----

  const server = new Server(
    { name: PKG_NAME, version: PKG_VERSION },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return { tools: aggregatedTools };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: toolArgs } = request.params;
    const client = toolToClient.get(name);

    if (!client) {
      return {
        content: [{ type: 'text' as const, text: `Unknown tool: "${name}"` }],
        isError: true,
      };
    }

    try {
      const result = await client.callTool({ name, arguments: toolArgs });
      return result;
    } catch (e) {
      const serverName = toolToServer.get(name) || 'unknown';
      logError(`Tool "${name}" (server: "${serverName}") call failed: ${e}`);
      return {
        content: [{ type: 'text' as const, text: `Tool call failed: ${e}` }],
        isError: true,
      };
    }
  });

  // ---- Phase 3: Start stdio transport ----

  const transport = new StdioServerTransport();
  await server.connect(transport);

  logInfo('Proxy server running on stdio');

  // ---- Graceful shutdown ----

  let isShuttingDown = false;

  const shutdown = async (signal: string) => {
    if (isShuttingDown) return;
    isShuttingDown = true;

    logInfo(`Received ${signal}, shutting down...`);

    for (const [id, client] of clients) {
      try {
        await client.close();
        logInfo(`Closed client "${id}"`);
      } catch (e) {
        logError(`Failed to close client "${id}": ${e}`);
      }
    }

    for (const [id, cleanup] of cleanups) {
      try {
        await cleanup();
      } catch (e) {
        logError(`Failed cleanup for "${id}": ${e}`);
      }
    }

    try {
      await server.close();
    } catch {
      // Ignore close errors during shutdown
    }

    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

process.on('unhandledRejection', (reason) => {
  logError(`Unhandled rejection: ${reason}`);
  process.exit(1);
});

main().catch((error) => {
  logError(`Fatal error: ${error}`);
  process.exit(1);
});
