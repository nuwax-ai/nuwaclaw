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
export { buildBaseEnv, connectStdio, connectBridge } from './transport.js';
export type { ConnectedClient } from './transport.js';
export type { StdioServerEntry, BridgeServerEntry, McpServerEntry, McpServersConfig } from './types.js';
