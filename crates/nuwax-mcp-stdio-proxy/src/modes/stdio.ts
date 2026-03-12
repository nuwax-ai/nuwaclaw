/**
 * Mode: stdio aggregation
 *
 * Aggregates multiple MCP servers (stdio + streamable-http + SSE)
 * into a single stdio MCP endpoint.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';

import type { McpServersConfig } from '../types.js';
import { isSseEntry, isStreamableEntry, needsProtocolDetection } from '../types.js';
import { logInfo, logWarn, logError } from '../logger.js';
import { buildBaseEnv, connectStdio, connectStreamable, connectSse, buildRequestHeaders } from '../transport/index.js';
import { discoverTools, createToolProxyServer, setupGracefulShutdown } from '../shared/index.js';
import { filterTools } from '../filter.js';
import type { ToolFilter } from '../filter.js';
import { detectProtocol } from '../detect.js';

export async function runStdio(
  config: McpServersConfig,
  allowTools?: string[],
  denyTools?: string[],
): Promise<void> {
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

  // Filter out persistent entries (handled by PersistentMcpBridge, not this proxy)
  const connectableEntries = entries.filter(([id, entry]) => {
    if ((entry as any).persistent) {
      logWarn(`Skipping persistent server "${id}" (handled by PersistentMcpBridge)`);
      return false;
    }
    return true;
  });

  // Connect to all servers in parallel
  const results = await Promise.allSettled(
    connectableEntries.map(async ([id, entry]) => {
      try {
        let connected: { client: Client; cleanup: () => Promise<void> };

        if (isSseEntry(entry)) {
          connected = await connectSse(id, entry);
        } else if (isStreamableEntry(entry)) {
          connected = await connectStreamable(id, entry);
        } else if (needsProtocolDetection(entry)) {
          // No explicit transport — probe the URL to determine protocol
          const detected = await detectProtocol(entry.url, buildRequestHeaders(entry));
          if (detected === 'sse') {
            connected = await connectSse(id, { ...entry, transport: 'sse' });
          } else {
            connected = await connectStreamable(id, entry);
          }
        } else {
          connected = await connectStdio(id, entry, baseEnv);
        }

        return { id, entry, connected };
      } catch (e) {
        throw new Error(`Server "${id}": ${e}`);
      }
    }),
  );

  for (const result of results) {
    if (result.status === 'rejected') {
      logError(`Failed to connect: ${result.reason}`);
      continue;
    }

    const { id, entry, connected } = result.value;
    const { client, cleanup } = connected;
    clients.set(id, client);
    cleanups.set(id, cleanup);

    let serverTools = await discoverTools(client);

    // Per-server tool filtering (allowTools/denyTools in config entry)
    if (entry.allowTools || entry.denyTools) {
      const perFilter: ToolFilter = {};
      if (entry.allowTools) perFilter.allowTools = new Set(entry.allowTools);
      if (entry.denyTools) perFilter.denyTools = new Set(entry.denyTools);
      const before = serverTools.length;
      serverTools = filterTools(serverTools, perFilter);
      if (serverTools.length !== before) {
        logInfo(`Server "${id}": filtered ${before} → ${serverTools.length} tool(s)`);
      }
    }

    logInfo(
      `Server "${id}": ${serverTools.length} tool(s)${serverTools.length > 0 ? ' — ' + serverTools.map((t) => t.name).join(', ') : ''}`,
    );

    for (const tool of serverTools) {
      if (toolToClient.has(tool.name)) {
        logWarn(
          `Tool "${tool.name}" from "${id}" shadows existing tool from "${toolToServer.get(tool.name)}"`,
        );
      }
      toolToClient.set(tool.name, client);
      toolToServer.set(tool.name, id);
      toolsByName.set(tool.name, tool);
    }
  }

  if (clients.size === 0) {
    logError('Failed to connect to any MCP server');
    process.exit(1);
  }

  const aggregatedTools = Array.from(toolsByName.values());
  logInfo(`Aggregated ${aggregatedTools.length} unique tool(s) from ${clients.size} server(s)`);

  // ---- Phase 1.5: Apply tool filtering (allow/deny) ----

  const toolFilter: ToolFilter = {};
  if (allowTools) toolFilter.allowTools = new Set(allowTools);
  if (denyTools) toolFilter.denyTools = new Set(denyTools);

  const filteredTools = filterTools(aggregatedTools, toolFilter);
  const filteredNames = new Set(filteredTools.map((t) => t.name));

  if (filteredTools.length !== aggregatedTools.length) {
    logInfo(`After filtering: ${filteredTools.length} tool(s) — ${filteredTools.map((t) => t.name).join(', ')}`);
  }

  // ---- Phase 2: Create the aggregating MCP server ----

  const { server } = await createToolProxyServer({
    tools: filteredTools,
    resolveClient: (name) => filteredNames.has(name) ? toolToClient.get(name) : undefined,
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
