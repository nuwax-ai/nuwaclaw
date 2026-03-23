/**
 * Tool proxy server creation
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';

import { logError } from '../logger.js';
import { PKG_NAME, PKG_VERSION } from '../constants.js';

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
