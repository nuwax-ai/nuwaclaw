/**
 * Unified error types for nuwax-mcp-stdio-proxy
 *
 * Provides structured error handling across all modules.
 */

/** Connection error - used for transport layer connection failures */
export class ConnectionError extends Error {
  constructor(
    public readonly serverId: string,
    public readonly cause: Error,
  ) {
    super(`Connection failed for "${serverId}": ${cause.message}`);
    this.name = 'ConnectionError';
  }
}

/** Tool call error - used for tool execution failures */
export class ToolCallError extends Error {
  constructor(
    public readonly toolName: string,
    public readonly serverId: string | undefined,
    public readonly cause: Error,
  ) {
    super(`Tool "${toolName}" call failed: ${cause.message}`);
    this.name = 'ToolCallError';
  }
}

/** Health check error - used for heartbeat detection failures */
export class HealthCheckError extends Error {
  constructor(
    public readonly serverId: string,
    public readonly consecutiveFailures: number,
  ) {
    super(`Health check failed for "${serverId}" (${consecutiveFailures} consecutive failures)`);
    this.name = 'HealthCheckError';
  }
}

/** Configuration error - used for config validation failures */
export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}
