/**
 * CLI entry point for agent-gui-server.
 *
 * Usage:
 *   agent-gui-server [--port <number>] [--transport <http|stdio>]
 *
 * Environment variables:
 *   GUI_AGENT_API_KEY (required) - LLM API key
 *   GUI_AGENT_* - See config.ts for all options
 */

import { loadConfig } from './config.js';
import { createGuiAgentServer } from './mcp/server.js';
import { logInfo, logError } from './utils/logger.js';

function parseArgs(argv: string[]): { port?: number; transport?: 'http' | 'stdio' } {
  const result: { port?: number; transport?: 'http' | 'stdio' } = {};

  for (let i = 2; i < argv.length; i++) {
    switch (argv[i]) {
      case '--port':
        result.port = parseInt(argv[++i], 10);
        break;
      case '--transport':
        result.transport = argv[++i] as 'http' | 'stdio';
        break;
      case '--help':
      case '-h':
        printUsage();
        process.exit(0);
        break;
    }
  }

  return result;
}

function printUsage(): void {
  console.error(`
agent-gui-server — GUI Agent MCP Server

Usage:
  agent-gui-server [options]

Options:
  --port <number>         HTTP server port (default: 60008)
  --transport <http|stdio> Transport mode (default: http)
  --help, -h              Show this help

Environment Variables:
  GUI_AGENT_API_KEY       (required) LLM API key
  GUI_AGENT_PROVIDER      LLM provider (default: anthropic)
  GUI_AGENT_MODEL         LLM model (default: claude-sonnet-4-20250514)
  GUI_AGENT_BASE_URL      Custom API base URL
  GUI_AGENT_PORT          HTTP port (default: 60008)
  GUI_AGENT_TRANSPORT     Transport mode: http or stdio (default: http)
  GUI_AGENT_DISPLAY_INDEX Target display index (default: 0)
  GUI_AGENT_JPEG_QUALITY  Screenshot JPEG quality 1-100 (default: 75)
  GUI_AGENT_MAX_STEPS     Max steps per task 1-200 (default: 50)
  GUI_AGENT_STEP_DELAY_MS Delay between steps 100-30000 (default: 1500)
  GUI_AGENT_LOG_FILE      Optional log file path
`);
}

async function main() {
  const args = parseArgs(process.argv);

  let config;
  try {
    config = loadConfig({
      port: args.port,
      transport: args.transport,
    });
  } catch (err) {
    logError(`Configuration error: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }

  const server = createGuiAgentServer(config);

  // Graceful shutdown
  let stopping = false;
  const shutdown = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    logInfo(`Received ${signal}, shutting down...`);
    try {
      await server.stop();
    } catch (err) {
      logError(`Shutdown error: ${err instanceof Error ? err.message : String(err)}`);
    }
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('unhandledRejection', (reason) => {
    logError(`Unhandled rejection: ${reason}`);
    process.exit(1);
  });

  try {
    await server.start();
  } catch (err) {
    logError(`Failed to start: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

main();
