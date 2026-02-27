#!/usr/bin/env node

/**
 * nuwax-mcp-stdio-proxy
 *
 * A pure TypeScript stdio MCP proxy that aggregates multiple child MCP servers
 * into a single MCP server endpoint. Eliminates HTTP/port management and
 * avoids Windows console popup issues when invoked via Node.js directly.
 *
 * Usage:
 *   nuwax-mcp-stdio-proxy --config '{"mcpServers":{"name":{"command":"...","args":["..."]}}}'
 *
 * Architecture:
 *   Agent Engine (stdin/stdout)  ←→  This Proxy (StdioServerTransport)
 *                                         ├→ Child MCP Server A (StdioClientTransport)
 *                                         ├→ Child MCP Server B (StdioClientTransport)
 *                                         └→ ...
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';

// ========== Types ==========

interface McpServerEntry {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

interface McpServersConfig {
  mcpServers: Record<string, McpServerEntry>;
}

// ========== Logging (stderr only — stdout is MCP JSON-RPC channel) ==========

function log(level: string, msg: string): void {
  process.stderr.write(`[nuwax-mcp-proxy] ${level}: ${msg}\n`);
}

const logInfo = (msg: string) => log('INFO', msg);
const logWarn = (msg: string) => log('WARN', msg);
const logError = (msg: string) => log('ERROR', msg);

// ========== CLI Argument Parsing ==========

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

// ========== Build Clean Environment for Child Processes ==========

function buildBaseEnv(): Record<string, string> {
  const env: Record<string, string> = {};

  // Copy current process.env, filtering out undefined values
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) {
      env[key] = value;
    }
  }

  // Remove ELECTRON_RUN_AS_NODE — child MCP servers should run normally,
  // not as Electron Node.js instances
  delete env.ELECTRON_RUN_AS_NODE;

  return env;
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
    `Starting proxy with ${entries.length} child server(s): ${entries.map(([id]) => id).join(', ')}`,
  );

  // ---- Phase 1: Connect to all child MCP servers ----

  // Build base env once — per-server env is merged on top
  const baseEnv = buildBaseEnv();

  const clients = new Map<string, Client>();
  const toolToClient = new Map<string, Client>();
  const toolToServer = new Map<string, string>();
  const toolsByName = new Map<string, Tool>();

  for (const [id, entry] of entries) {
    let transport: StdioClientTransport | null = null;
    try {
      logInfo(`Connecting to "${id}": ${entry.command} ${(entry.args || []).join(' ')}`);

      transport = new StdioClientTransport({
        command: entry.command,
        args: entry.args || [],
        env: { ...baseEnv, ...(entry.env || {}) },
        // stderr defaults to 'pipe' in the SDK; child errors captured via transport.stderr
      });

      // Attach stderr listener BEFORE connect to catch early child errors
      // (SDK returns a PassThrough stream immediately for this purpose)
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
      clients.set(id, client);

      // Discover tools from this child server (handle pagination)
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
      // Clean up transport to prevent child process leak
      if (transport) {
        try { await transport.close(); } catch { /* ignore */ }
      }
      // Continue with remaining servers — partial startup is acceptable
    }
  }

  if (clients.size === 0) {
    logError('Failed to connect to any child MCP server');
    process.exit(1);
  }

  const aggregatedTools = Array.from(toolsByName.values());
  logInfo(`Aggregated ${aggregatedTools.length} unique tool(s) from ${clients.size} server(s)`);

  // ---- Phase 2: Create the aggregating MCP server ----

  const server = new Server(
    { name: 'nuwax-mcp-stdio-proxy', version: '1.0.0' },
    { capabilities: { tools: {} } },
  );

  // tools/list → return all aggregated tools
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return { tools: aggregatedTools };
  });

  // tools/call → route to the correct child server
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
        logInfo(`Closed child client "${id}"`);
      } catch (e) {
        logError(`Failed to close child client "${id}": ${e}`);
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
