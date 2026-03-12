/**
 * Runtime configuration validation
 */

import type { McpServersConfig, McpServerEntry, StdioServerEntry, StreamableServerEntry, SseServerEntry } from './types.js';
import { ConfigError } from './errors.js';

/**
 * Validate config at runtime
 */
export function validateConfig(config: unknown): McpServersConfig {
  if (!config || typeof config !== 'object') {
    throw new ConfigError('Config must be an object');
  }

  const cfg = config as Record<string, unknown>;

  if (!cfg.mcpServers || typeof cfg.mcpServers !== 'object') {
    throw new ConfigError('Config must contain a "mcpServers" object');
  }

  for (const [id, entry] of Object.entries(cfg.mcpServers as Record<string, unknown>)) {
    validateServerEntry(id, entry);
  }

  return cfg as unknown as McpServersConfig;
}

function validateServerEntry(id: string, entry: unknown): void {
  if (!entry || typeof entry !== 'object') {
    throw new ConfigError(`Server "${id}": entry must be an object`);
  }

  const e = entry as Record<string, unknown>;

  // Check if it's a URL type (streamable-http or sse)
  if (typeof e.url === 'string') {
    validateUrlEntry(id, e as Partial<StreamableServerEntry>);
  } else if (typeof e.command === 'string') {
    validateStdioEntry(id, e as Partial<StdioServerEntry>);
  } else {
    throw new ConfigError(`Server "${id}": must have either "url" or "command" property`);
  }
}

function validateUrlEntry(id: string, entry: Partial<StreamableServerEntry>): void {
  try {
    new URL(entry.url!);
  } catch {
    throw new ConfigError(`Server "${id}": invalid URL "${entry.url}"`);
  }

  if (entry.transport && !['streamable-http', 'sse'].includes(entry.transport)) {
    throw new ConfigError(`Server "${id}": transport must be "streamable-http" or "sse"`);
  }
}

function validateStdioEntry(id: string, entry: Partial<StdioServerEntry>): void {
  if (entry.args && !Array.isArray(entry.args)) {
    throw new ConfigError(`Server "${id}": args must be an array`);
  }

  if (entry.env && typeof entry.env !== 'object') {
    throw new ConfigError(`Server "${id}": env must be an object`);
  }
}
