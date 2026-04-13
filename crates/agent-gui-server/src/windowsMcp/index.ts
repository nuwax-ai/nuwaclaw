/**
 * Windows-MCP 模块导出
 */

export { WindowsMcpManager } from './manager.js';
export { healthCheck, waitForReady } from './healthCheck.js';
export type { HealthCheckOptions, HealthCheckResult } from './healthCheck.js';
export type {
  WindowsMcpStatus,
  ProcessConfig,
  ProcessRunner,
  StartResult,
  StopResult,
  WindowsMcpConfig,
} from './types.js';
