/**
 * Mode: stdio aggregation
 *
 * Aggregates multiple MCP servers (stdio + streamable-http + SSE)
 * into a single stdio MCP endpoint.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';

import type { McpServersConfig } from '../types.js';
import { isSseEntry, isStreamableEntry } from '../types.js';
import { logInfo, logWarn, logError } from '../logger.js';
import { buildBaseEnv, connectStdio, connectStreamable, connectSse } from '../transport.js';
import { discoverTools, createToolProxyServer, setupGracefulShutdown } from '../shared.js';

export async function runStdio(config: McpServersConfig): Promise<void> {
  const entries = Object.entries(config.mcpServers);

  if (entries.length === 0) {
    logError('No MCP servers configured in mcpServers');
    process.exit(1);
  }

  logInfo(
    `Starting proxy with ${entries.length} server(s): ${entries.map(([id]) => id).join(', ')}`,
  );

  // ---- Phase 1: Connect to all MCP servers (stdio + streamable + sse) ----

  const baseEnv = buildBaseEnv();

  const clients = new Map<string, Client>();
  const cleanups = new Map<string, () => Promise<void>>();
  const toolToClient = new Map<string, Client>();
  const toolToServer = new Map<string, string>();
  const toolsByName = new Map<string, Tool>();

  for (const [id, entry] of entries) {
    try {
      let connected: { client: Client; cleanup: () => Promise<void> };

      if (isSseEntry(entry)) {
        connected = await connectSse(id, entry);
      } else if (isStreamableEntry(entry)) {
        connected = await connectStreamable(id, entry);
      } else {
        connected = await connectStdio(id, entry, baseEnv);
      }

      const { client, cleanup } = connected;
      clients.set(id, client);
      cleanups.set(id, cleanup);

      const allServerTools = await discoverTools(client);

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

  const { server } = await createToolProxyServer({
    tools: aggregatedTools,
    resolveClient: (name) => toolToClient.get(name),
    errorLabel: (name) => `"${name}" (server: "${toolToServer.get(name) || 'unknown'}")`,
  });

  logInfo('Proxy server running on stdio');

  // ---- Graceful shutdown ----

  setupGracefulShutdown(async () => {
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
  });
}
