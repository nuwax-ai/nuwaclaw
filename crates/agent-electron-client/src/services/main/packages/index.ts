// Main process package management services
export {
  mcpProxyManager,
  DEFAULT_MCP_PROXY_CONFIG,
  type McpServersConfig,
} from './mcp';
export { getAppPaths, isInstalledLocally } from './packageLocator';
// Re-export ports from constants
export { DEFAULT_MCP_PROXY_PORT, DEFAULT_MCP_PROXY_HOST } from '../constants';

