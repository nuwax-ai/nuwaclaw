/**
 * Mode: proxy (Streamable HTTP server)
 *
 * Starts PersistentMcpBridge as a Streamable HTTP server,
 * exposing stdio MCP servers over HTTP on a specified port.
 */

import type { McpServersConfig } from '../types.js';
import { logInfo, logWarn, logError } from '../logger.js';
import { PersistentMcpBridge } from '../bridge.js';
import { setupGracefulShutdown } from '../shared.js';

export interface ProxyArgs {
  port: number;
  config: McpServersConfig;
}

export async function runProxy(args: ProxyArgs): Promise<void> {
  const { port, config } = args;

  // Filter to only stdio entries for PersistentMcpBridge
  const stdioEntries: Record<string, { command: string; args?: string[]; env?: Record<string, string> }> = {};
  for (const [id, entry] of Object.entries(config.mcpServers)) {
    if (!('url' in entry)) {
      stdioEntries[id] = entry;
    } else {
      logWarn(`Skipping non-stdio server "${id}" in proxy mode (only stdio servers supported)`);
    }
  }

  if (Object.keys(stdioEntries).length === 0) {
    logError('No stdio servers found in config for proxy mode');
    process.exit(1);
  }

  logInfo(`Starting proxy HTTP server on port ${port} with ${Object.keys(stdioEntries).length} server(s)...`);

  const bridge = new PersistentMcpBridge({
    info: (...a: unknown[]) => logInfo(a.map(String).join(' ')),
    warn: (...a: unknown[]) => logWarn(a.map(String).join(' ')),
    error: (...a: unknown[]) => logError(a.map(String).join(' ')),
  });

  await bridge.start(stdioEntries, { port });

  logInfo(`Proxy HTTP server running on port ${port}`);

  setupGracefulShutdown(async () => {
    await bridge.stop();
  });
}
