/**
 * Shared helpers — deduplicated logic used across modes
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';

import { logInfo, logError } from './logger.js';
import { PKG_NAME, PKG_VERSION } from './constants.js';

// ========== Tool Discovery ==========

/**
 * Discover all tools from a connected MCP client, handling pagination.
 */
export async function discoverTools(client: Client): Promise<Tool[]> {
  const tools: Tool[] = [];
  let cursor: string | undefined;
  do {
    const page = await client.listTools(cursor ? { cursor } : undefined);
    tools.push(...page.tools);
    cursor = page.nextCursor;
  } while (cursor);
  return tools;
}

// ========== Tool Proxy Server ==========

/**
 * Callback that resolves a tool name to the client that owns it.
 * Returns undefined if the tool is unknown or filtered.
 */
export type ToolResolver = (toolName: string) => Client | undefined;

export interface ToolProxyServerOptions {
  /** Tools to expose via ListTools */
  tools: Tool[];
  /** Resolves a tool name to the upstream client */
  resolveClient: ToolResolver;
  /** Optional label for error logging (e.g. server name) */
  errorLabel?: (toolName: string) => string;
}

/**
 * Create a stdio MCP server that proxies tool calls to upstream clients.
 *
 * Sets up Server with ListTools + CallTool handlers, connects to a
 * StdioServerTransport, and returns both for lifecycle management.
 */
export async function createToolProxyServer(
  opts: ToolProxyServerOptions,
): Promise<{ server: Server; transport: StdioServerTransport }> {
  const { tools, resolveClient, errorLabel } = opts;

  const server = new Server(
    { name: PKG_NAME, version: PKG_VERSION },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return { tools };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: toolArgs } = request.params;
    const client = resolveClient(name);

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
      const label = errorLabel ? errorLabel(name) : `"${name}"`;
      logError(`Tool ${label} call failed: ${e}`);
      return {
        content: [{ type: 'text' as const, text: `Tool call failed: ${e}` }],
        isError: true,
      };
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);

  return { server, transport };
}

// ========== Graceful Shutdown ==========

/**
 * Register SIGINT/SIGTERM handlers that run a cleanup function once,
 * then exit. Guards against double-invocation.
 */
export function setupGracefulShutdown(cleanupFn: () => Promise<void>): void {
  let isShuttingDown = false;

  const shutdown = async (signal: string) => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    logInfo(`Received ${signal}, shutting down...`);

    try {
      await cleanupFn();
    } catch (e) {
      logError(`Shutdown cleanup error: ${e}`);
    }

    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}
