/**
 * nuwax-mcp-stdio-proxy — CLI entry point
 *
 * A pure TypeScript MCP proxy with three operating modes:
 *
 * 1. **Default (stdio aggregation)**: Aggregates multiple MCP servers
 *    (stdio + streamable-http + SSE) into a single stdio endpoint.
 *    Usage: nuwax-mcp-stdio-proxy --config '{"mcpServers":{...}}'
 *
 * 2. **convert**: Connects to a single remote MCP service and exposes via stdio.
 *    Usage: nuwax-mcp-stdio-proxy convert [URL] [OPTIONS]
 *
 * 3. **proxy**: Starts PersistentMcpBridge as a Streamable HTTP server.
 *    Usage: nuwax-mcp-stdio-proxy proxy --port 18099 --config '{"mcpServers":{...}}'
 *
 * This file handles CLI argument parsing and routes to the appropriate mode.
 * Mode implementations live in modes/*.ts.
 */

import * as fs from 'fs';
import type { McpServersConfig } from './types.js';
import { logError } from './logger.js';
import { runStdio } from './modes/stdio.js';
import { runConvert } from './modes/convert.js';
import { runProxy } from './modes/proxy.js';
import { validateConfig } from './validation.js';

// ========== CLI Argument Types ==========

type CliArgs =
  | { mode: 'stdio'; config: McpServersConfig; allowTools?: string[]; denyTools?: string[] }
  | {
      mode: 'convert';
      url?: string;
      config?: McpServersConfig;
      name?: string;
      protocol?: 'sse' | 'stream';
      allowTools?: string[];
      denyTools?: string[];
      pingIntervalMs?: number;
      pingTimeoutMs?: number;
    }
  | { mode: 'proxy'; port: number; config: McpServersConfig };

// ========== CLI Parser ==========

function parseCliArgs(): CliArgs {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    logError('Missing arguments');
    printUsage();
    process.exit(1);
  }

  const subcommand = args[0];

  // Mode: convert
  if (subcommand === 'convert') {
    return parseConvertArgs(args.slice(1));
  }

  // Mode: proxy
  if (subcommand === 'proxy') {
    return parseProxyArgs(args.slice(1));
  }

  // Default mode: stdio aggregation (--config required)
  return parseStdioArgs(args);
}

function parseStdioArgs(args: string[]): CliArgs & { mode: 'stdio' } {
  let configJson: string | undefined;
  let configFile: string | undefined;
  let allowTools: string[] | undefined;
  let denyTools: string[] | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--config' && i + 1 < args.length) {
      i++;
      configJson = args[i];
    } else if (arg === '--config-file' && i + 1 < args.length) {
      i++;
      configFile = args[i];
    } else if (arg === '--allow-tools' && i + 1 < args.length) {
      i++;
      allowTools = args[i].split(',').map((s) => s.trim()).filter(Boolean);
    } else if (arg === '--deny-tools' && i + 1 < args.length) {
      i++;
      denyTools = args[i].split(',').map((s) => s.trim()).filter(Boolean);
    }
  }

  if (!configJson && !configFile) {
    logError('Missing --config or --config-file argument');
    logError('Usage: nuwax-mcp-stdio-proxy --config \'{"mcpServers":{...}}\'');
    logError('   or: nuwax-mcp-stdio-proxy --config-file /path/to/config.json');
    process.exit(1);
  }

  if (configJson && configFile) {
    logError('Cannot use both --config and --config-file');
    process.exit(1);
  }

  if (allowTools && denyTools) {
    logError('Cannot use both --allow-tools and --deny-tools');
    process.exit(1);
  }

  const config = configFile ? parseConfigFile(configFile) : parseConfigJson(configJson!);
  return { mode: 'stdio', config, allowTools, denyTools };
}

function parseConvertArgs(args: string[]): CliArgs & { mode: 'convert' } {
  let url: string | undefined;
  let config: McpServersConfig | undefined;
  let name: string | undefined;
  let protocol: 'sse' | 'stream' | undefined;
  let allowTools: string[] | undefined;
  let denyTools: string[] | undefined;
  let pingIntervalMs: number | undefined;
  let pingTimeoutMs: number | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--config' && i + 1 < args.length) {
      i++;
      config = parseConfigJson(args[i]);
    } else if ((arg === '-n' || arg === '--name') && i + 1 < args.length) {
      i++;
      name = args[i];
    } else if (arg === '--protocol' && i + 1 < args.length) {
      i++;
      const p = args[i];
      if (p !== 'sse' && p !== 'stream') {
        logError(`Invalid protocol: "${p}" (must be "sse" or "stream")`);
        process.exit(1);
      }
      protocol = p;
    } else if (arg === '--allow-tools' && i + 1 < args.length) {
      i++;
      allowTools = args[i].split(',').map((s) => s.trim()).filter(Boolean);
    } else if (arg === '--deny-tools' && i + 1 < args.length) {
      i++;
      denyTools = args[i].split(',').map((s) => s.trim()).filter(Boolean);
    } else if (arg === '--ping-interval' && i + 1 < args.length) {
      i++;
      pingIntervalMs = parseInt(args[i], 10);
      if (isNaN(pingIntervalMs)) {
        logError(`Invalid ping interval: "${args[i]}"`);
        process.exit(1);
      }
    } else if (arg === '--ping-timeout' && i + 1 < args.length) {
      i++;
      pingTimeoutMs = parseInt(args[i], 10);
      if (isNaN(pingTimeoutMs)) {
        logError(`Invalid ping timeout: "${args[i]}"`);
        process.exit(1);
      }
    } else if (!arg.startsWith('-') && !url) {
      url = arg;
    } else {
      logError(`Unknown argument: "${arg}"`);
      printConvertUsage();
      process.exit(1);
    }
  }

  if (!url && !config) {
    logError('Either URL or --config is required for convert mode');
    printConvertUsage();
    process.exit(1);
  }

  if (allowTools && denyTools) {
    logError('Cannot use both --allow-tools and --deny-tools');
    process.exit(1);
  }

  return { mode: 'convert', url, config, name, protocol, allowTools, denyTools, pingIntervalMs, pingTimeoutMs };
}

function parseProxyArgs(args: string[]): CliArgs & { mode: 'proxy' } {
  let port: number | undefined;
  let config: McpServersConfig | undefined;
  let configFile: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--port' && i + 1 < args.length) {
      i++;
      const portStr = args[i];
      port = parseInt(portStr, 10);
      if (isNaN(port) || port < 0 || port > 65535) {
        logError(`Invalid port: "${portStr}"`);
        process.exit(1);
      }
    } else if (arg === '--config' && i + 1 < args.length) {
      i++;
      config = parseConfigJson(args[i]);
    } else if (arg === '--config-file' && i + 1 < args.length) {
      i++;
      configFile = args[i];
    } else {
      logError(`Unknown argument: "${arg}"`);
      printProxyUsage();
      process.exit(1);
    }
  }

  if (port === undefined) {
    logError('--port is required for proxy mode');
    printProxyUsage();
    process.exit(1);
  }

  if (configFile) {
    config = parseConfigFile(configFile);
  }

  if (!config) {
    logError('--config or --config-file is required for proxy mode');
    printProxyUsage();
    process.exit(1);
  }

  return { mode: 'proxy', port, config };
}

function parseConfigJson(json: string): McpServersConfig {
  try {
    const raw = JSON.parse(json);
    return validateConfig(raw);
  } catch (e) {
    logError(`Failed to parse --config JSON: ${e}`);
    process.exit(1);
  }
}

function parseConfigFile(filePath: string): McpServersConfig {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const raw = JSON.parse(content);
    return validateConfig(raw);
  } catch (e) {
    logError(`Failed to read or parse config file "${filePath}": ${e}`);
    process.exit(1);
  }
}

// ========== Usage Messages ==========

function printUsage(): void {
  logError('Usage:');
  logError('  nuwax-mcp-stdio-proxy --config \'{"mcpServers":{...}}\' [OPTIONS]  (stdio aggregation)');
  logError('  nuwax-mcp-stdio-proxy --config-file <FILE> [OPTIONS]             (stdio aggregation from file)');
  logError('  nuwax-mcp-stdio-proxy convert [URL] [OPTIONS]                    (remote → stdio)');
  logError('  nuwax-mcp-stdio-proxy proxy --port <PORT> --config \'...\'         (HTTP server)');
  logError('');
  logError('Options (stdio / convert):');
  logError('  --config <JSON>                MCP config JSON string');
  logError('  --config-file <FILE>           MCP config JSON file path');
  logError('  --allow-tools <TOOLS>          Tool whitelist (comma-separated)');
  logError('  --deny-tools <TOOLS>           Tool blacklist (comma-separated)');
}

function printConvertUsage(): void {
  logError('Usage: nuwax-mcp-stdio-proxy convert [URL] [OPTIONS]');
  logError('');
  logError('Arguments:');
  logError('  [URL]                          MCP service URL');
  logError('');
  logError('Options:');
  logError('  --config <JSON>                MCP config JSON (alternative to URL)');
  logError('  -n, --name <NAME>              Service name (for multi-service configs)');
  logError('  --protocol <sse|stream>        Protocol type (auto-detect if omitted)');
  logError('  --allow-tools <TOOLS>          Tool whitelist (comma-separated)');
  logError('  --deny-tools <TOOLS>           Tool blacklist (comma-separated)');
  logError('  --ping-interval <MS>           Heartbeat ping interval (default: 20000)');
  logError('  --ping-timeout <MS>            Heartbeat ping timeout (default: 5000)');
}

function printProxyUsage(): void {
  logError('Usage: nuwax-mcp-stdio-proxy proxy --port <PORT> --config \'{"mcpServers":{...}}\'');
  logError('   or: nuwax-mcp-stdio-proxy proxy --port <PORT> --config-file <FILE>');
}

// ========== Entry Point ==========

async function main(): Promise<void> {
  const args = parseCliArgs();

  switch (args.mode) {
    case 'stdio':
      await runStdio(args.config, args.allowTools, args.denyTools);
      break;
    case 'convert':
      await runConvert(args);
      break;
    case 'proxy':
      await runProxy(args);
      break;
  }
}

process.on('unhandledRejection', (reason) => {
  logError(`Unhandled rejection: ${reason}`);
  process.exit(1);
});

main().catch((error) => {
  logError(`Fatal error: ${error}`);
  process.exit(1);
});
