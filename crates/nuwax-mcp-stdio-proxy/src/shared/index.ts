/**
 * Shared helpers — deduplicated logic used across modes
 *
 * This module re-exports utilities from sub-modules:
 * - discovery: Tool discovery from MCP clients
 * - proxy-server: Tool proxy server creation
 * - shutdown: Graceful shutdown handlers
 */

export { discoverTools } from './discovery.js';
export { createToolProxyServer } from './proxy-server.js';
export type { ToolResolver, ToolProxyServerOptions } from './proxy-server.js';
export { setupGracefulShutdown } from './shutdown.js';
