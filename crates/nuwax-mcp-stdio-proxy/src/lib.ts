/**
 * Library entry point — re-exports for consumers
 *
 * CLI entry point remains at index.ts (bundled by esbuild).
 * This file provides typed exports for library consumers (e.g. Electron client).
 */

export { PersistentMcpBridge } from './bridge.js';
export type { BridgeLogger } from './bridge.js';
export { CustomStdioClientTransport } from './customStdio.js';
export type { CustomStdioServerParameters } from './customStdio.js';
export {
  buildBaseEnv,
  buildRequestHeaders,
  connectStdio,
  connectStreamable,
  connectSse,
  connectBridge,
} from './transport.js';
export type { ConnectedClient } from './transport.js';
export type {
  StdioServerEntry,
  StreamableServerEntry,
  SseServerEntry,
  BridgeServerEntry,
  HttpServerEntry,
  McpServerEntry,
  McpServersConfig,
} from './types.js';
export { isSseEntry, isStreamableEntry, isBridgeEntry } from './types.js';
export { filterTools } from './filter.js';
export type { ToolFilter } from './filter.js';
export { detectProtocol } from './detect.js';
export { discoverTools, createToolProxyServer, setupGracefulShutdown } from './shared.js';
export type { ToolResolver, ToolProxyServerOptions } from './shared.js';
