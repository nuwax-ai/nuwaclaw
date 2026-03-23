/**
 * Library entry point — re-exports for consumers
 *
 * CLI entry point remains at index.ts (bundled by esbuild).
 * This file provides typed exports for library consumers (e.g. Electron client).
 */

// Bridge
export { PersistentMcpBridge } from './bridge.js';
export type { BridgeLogger } from './bridge.js';

// Custom stdio transport
export { CustomStdioClientTransport } from './customStdio.js';
export type { CustomStdioServerParameters } from './customStdio.js';

// Transport module
export {
  buildBaseEnv,
  buildRequestHeaders,
  connectStdio,
  connectStreamable,
  connectSse,
  connectBridge,
  connectHttp,
} from './transport/index.js';
export type { ConnectedClient } from './transport/types.js';

// Types
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

// Filter
export { filterTools } from './filter.js';
export type { ToolFilter } from './filter.js';

// Protocol detection
export { detectProtocol } from './detect.js';

// Shared module
export { discoverTools, createToolProxyServer, setupGracefulShutdown } from './shared/index.js';
export type { ToolResolver, ToolProxyServerOptions } from './shared/index.js';

// Errors
export { ConnectionError, ToolCallError, HealthCheckError, ConfigError } from './errors.js';

// Validation
export { validateConfig } from './validation.js';
