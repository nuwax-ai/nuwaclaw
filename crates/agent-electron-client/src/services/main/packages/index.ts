// Main process package management services
export {
  mcpProxyManager,
  DEFAULT_MCP_PROXY_CONFIG,
  DEFAULT_MCP_PROXY_PORT,
  DEFAULT_MCP_PROXY_HOST,
  type McpServersConfig,
} from './mcp';
export { getAppPaths, isInstalledLocally } from './packageLocator';
