/**
 * Mode: convert (remote URL → stdio)
 *
 * Connects to a single remote MCP service (SSE or Streamable HTTP)
 * and exposes it as a stdio MCP endpoint. Supports tool filtering.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';

import type { McpServersConfig, StreamableServerEntry, SseServerEntry } from '../types.js';
import { logInfo, logWarn, logError } from '../logger.js';
import { connectStreamable, connectSse, buildRequestHeaders } from '../transport.js';
import { filterTools } from '../filter.js';
import type { ToolFilter } from '../filter.js';
import { detectProtocol } from '../detect.js';
import { discoverTools, createToolProxyServer, setupGracefulShutdown } from '../shared.js';

export interface ConvertArgs {
  url?: string;
  config?: McpServersConfig;
  name?: string;
  protocol?: 'sse' | 'stream';
  allowTools?: string[];
  denyTools?: string[];
  pingIntervalMs?: number;
  pingTimeoutMs?: number;
}

export async function runConvert(args: ConvertArgs): Promise<void> {
  // 1. Resolve the target URL and headers
  let targetUrl: string;
  let targetHeaders: Record<string, string> | undefined;
  let protocolHint: 'sse' | 'stream' | undefined = args.protocol;

  if (args.url) {
    targetUrl = args.url;
  } else if (args.config) {
    const serverEntries = Object.entries(args.config.mcpServers);
    if (serverEntries.length === 0) {
      logError('No servers found in config');
      process.exit(1);
    }

    // If --name specified, find that entry; otherwise use the first entry
    let selected: [string, typeof serverEntries[0][1]];
    if (args.name) {
      const found = serverEntries.find(([id]) => id === args.name);
      if (!found) {
        logError(`Server "${args.name}" not found in config. Available: ${serverEntries.map(([id]) => id).join(', ')}`);
        process.exit(1);
      }
      selected = found;
    } else {
      if (serverEntries.length > 1) {
        logWarn(`Multiple servers in config, using first: "${serverEntries[0][0]}". Use --name to select.`);
      }
      selected = serverEntries[0];
    }

    const [, entry] = selected;
    if (!('url' in entry) || typeof entry.url !== 'string') {
      logError('Selected server entry must have a "url" field for convert mode');
      process.exit(1);
    }
    targetUrl = entry.url;

    // Extract headers/authToken from entry
    const httpEntry = entry as StreamableServerEntry | SseServerEntry;
    targetHeaders = buildRequestHeaders(httpEntry);
    // If entry has explicit transport, use it as protocol hint
    if ('transport' in entry && entry.transport === 'sse' && !protocolHint) {
      protocolHint = 'sse';
    }
  } else {
    logError('Either URL or --config is required');
    process.exit(1);
  }

  // 2. Detect protocol
  let protocol = protocolHint;
  if (!protocol) {
    protocol = await detectProtocol(targetUrl, targetHeaders);
  }

  logInfo(`Connecting to ${targetUrl} via ${protocol === 'sse' ? 'SSE' : 'Streamable HTTP'}...`);

  // 3. Connect to the remote server
  const entryId = 'remote';
  let connected: { client: Client; cleanup: () => Promise<void> };

  if (protocol === 'sse') {
    const sseEntry: SseServerEntry = { url: targetUrl, transport: 'sse', pingIntervalMs: args.pingIntervalMs, pingTimeoutMs: args.pingTimeoutMs };
    if (targetHeaders) sseEntry.headers = targetHeaders;
    connected = await connectSse(entryId, sseEntry);
  } else {
    const streamEntry: StreamableServerEntry = { url: targetUrl, pingIntervalMs: args.pingIntervalMs, pingTimeoutMs: args.pingTimeoutMs };
    if (targetHeaders) streamEntry.headers = targetHeaders;
    connected = await connectStreamable(entryId, streamEntry);
  }

  const { client: remoteClient, cleanup } = connected;

  // 4. Discover tools
  const allTools = await discoverTools(remoteClient);
  logInfo(`Remote server has ${allTools.length} tool(s)`);

  // 5. Apply tool filtering
  const toolFilter: ToolFilter = {};
  if (args.allowTools) toolFilter.allowTools = new Set(args.allowTools);
  if (args.denyTools) toolFilter.denyTools = new Set(args.denyTools);

  const filteredTools = filterTools(allTools, toolFilter);
  const filteredNames = new Set(filteredTools.map((t) => t.name));

  if (filteredTools.length !== allTools.length) {
    logInfo(`After filtering: ${filteredTools.length} tool(s)`);
  }

  // 6. Create stdio MCP server that proxies to the remote client
  const { server } = await createToolProxyServer({
    tools: filteredTools,
    resolveClient: (name) => filteredNames.has(name) ? remoteClient : undefined,
  });

  logInfo('Convert proxy running on stdio');

  // Graceful shutdown
  setupGracefulShutdown(async () => {
    try { await remoteClient.close(); } catch { /* ignore */ }
    try { await cleanup(); } catch { /* ignore */ }
    try { await server.close(); } catch { /* ignore */ }
  });
}
