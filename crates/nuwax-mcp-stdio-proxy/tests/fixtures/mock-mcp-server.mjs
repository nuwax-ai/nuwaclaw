#!/usr/bin/env node
/**
 * Mock MCP Server — test fixture for nuwax-mcp-stdio-proxy
 *
 * Usage:
 *   node mock-mcp-server.mjs --tools '["tool-a","tool-b"]' --name 'my-server'
 *
 * Flags:
 *   --tools <json>           Array of tool names to register (default: ["mock-tool"])
 *   --name <string>          Server name (default: "mock-server")
 *   --assert-no-env <VAR>    Exit with error if env variable VAR is set (for env isolation tests)
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

// ---- Parse arguments ----

function getArg(flag) {
  const idx = process.argv.indexOf(flag);
  return idx >= 0 && idx + 1 < process.argv.length ? process.argv[idx + 1] : null;
}

const toolNames = JSON.parse(getArg('--tools') || '["mock-tool"]');
const serverName = getArg('--name') || 'mock-server';

// ---- Env assertion (for testing env isolation) ----

const assertNoEnv = getArg('--assert-no-env');
if (assertNoEnv && process.env[assertNoEnv]) {
  process.stderr.write(
    `[${serverName}] ASSERTION FAILED: env var "${assertNoEnv}" should not be set (value: "${process.env[assertNoEnv]}")\n`,
  );
  process.exit(1);
}

// ---- Build tools ----

const tools = toolNames.map((name) => ({
  name,
  description: `Mock tool: ${name} (from ${serverName})`,
  inputSchema: { type: 'object', properties: {} },
}));

// ---- Create server ----

const server = new Server(
  { name: serverName, version: '1.0.0' },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));

server.setRequestHandler(CallToolRequestSchema, async (request) => ({
  content: [{ type: 'text', text: `${serverName}:${request.params.name}` }],
}));

// ---- Start ----

const transport = new StdioServerTransport();
await server.connect(transport);
process.stderr.write(`[${serverName}] Mock MCP server running with tools: ${toolNames.join(', ')}\n`);
