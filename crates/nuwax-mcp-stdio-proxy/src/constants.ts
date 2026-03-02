/**
 * Package constants — injected at build time by esbuild define (see build.mjs)
 *
 * Falls back to static values when running via tsc in development.
 */

export const PKG_NAME = process.env.__MCP_PROXY_PKG_NAME__ || 'nuwax-mcp-stdio-proxy';
export const PKG_VERSION = process.env.__MCP_PROXY_PKG_VERSION__ || '0.0.0-dev';
