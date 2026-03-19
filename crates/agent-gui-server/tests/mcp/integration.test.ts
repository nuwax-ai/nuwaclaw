/**
 * MCP Integration Test
 *
 * Tests the full MCP server lifecycle:
 * 1. Start server on a random port
 * 2. Connect MCP client via Streamable HTTP
 * 3. List tools (should return 14)
 * 4. Verify tool names
 * 5. Stop server
 *
 * Note: gui_screenshot and gui_execute_task require actual desktop access,
 * so we only verify tool listing and schema in this test.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createGuiAgentServer, type GuiAgentServer } from '../../src/mcp/server.js';
import type { GuiAgentConfig } from '../../src/config.js';

const TEST_PORT = 60099; // Use a high port unlikely to conflict

function createTestConfig(): GuiAgentConfig {
  return {
    provider: 'anthropic',
    model: 'claude-sonnet-4-20250514',
    apiKey: 'test-integration-key',
    port: TEST_PORT,
    maxSteps: 10,
    stepDelayMs: 100,
    stuckThreshold: 3,
    jpegQuality: 75,
    displayIndex: 0,
    transport: 'http',
  };
}

const EXPECTED_ATOMIC_TOOLS = [
  'gui_screenshot',
  'gui_click',
  'gui_double_click',
  'gui_move_mouse',
  'gui_drag',
  'gui_scroll',
  'gui_type',
  'gui_press_key',
  'gui_hotkey',
  'gui_cursor_position',
  'gui_list_displays',
  'gui_find_image',
  'gui_wait_for_image',
];

const EXPECTED_TASK_TOOLS = [
  'gui_execute_task',
];

describe('MCP Integration', () => {
  let server: GuiAgentServer;
  let client: Client;
  let transport: StreamableHTTPClientTransport;

  beforeAll(async () => {
    // Start server
    server = createGuiAgentServer(createTestConfig());
    await server.start();

    // Connect client
    transport = new StreamableHTTPClientTransport(
      new URL(`http://127.0.0.1:${TEST_PORT}/mcp`),
    );
    client = new Client({ name: 'test-client', version: '1.0.0' });
    await client.connect(transport);
  }, 10000);

  afterAll(async () => {
    try { await client?.close(); } catch { /* ignore */ }
    try { await server?.stop(); } catch { /* ignore */ }
  }, 10000);

  it('should list all 14 tools', async () => {
    const result = await client.listTools();
    expect(result.tools).toHaveLength(14);
  });

  it('should include all atomic tools', async () => {
    const result = await client.listTools();
    const toolNames = result.tools.map(t => t.name);
    for (const name of EXPECTED_ATOMIC_TOOLS) {
      expect(toolNames).toContain(name);
    }
  });

  it('should include gui_execute_task tool', async () => {
    const result = await client.listTools();
    const toolNames = result.tools.map(t => t.name);
    for (const name of EXPECTED_TASK_TOOLS) {
      expect(toolNames).toContain(name);
    }
  });

  it('should have correct schema for gui_execute_task', async () => {
    const result = await client.listTools();
    const taskTool = result.tools.find(t => t.name === 'gui_execute_task');
    expect(taskTool).toBeDefined();
    expect(taskTool!.inputSchema).toBeDefined();
    expect(taskTool!.inputSchema.properties).toHaveProperty('task');
    expect(taskTool!.inputSchema.required).toContain('task');
  });

  it('should have correct schema for gui_click', async () => {
    const result = await client.listTools();
    const clickTool = result.tools.find(t => t.name === 'gui_click');
    expect(clickTool).toBeDefined();
    expect(clickTool!.inputSchema.properties).toHaveProperty('x');
    expect(clickTool!.inputSchema.properties).toHaveProperty('y');
    expect(clickTool!.inputSchema.required).toContain('x');
    expect(clickTool!.inputSchema.required).toContain('y');
  });

  it('should list resources', async () => {
    const result = await client.listResources();
    expect(result.resources.length).toBeGreaterThanOrEqual(3);
    const uris = result.resources.map(r => r.uri);
    expect(uris).toContain('gui://status');
    expect(uris).toContain('gui://permissions');
    expect(uris).toContain('gui://audit-log');
  });

  it('should read gui://status resource', async () => {
    const result = await client.readResource({ uri: 'gui://status' });
    expect(result.contents).toHaveLength(1);
    expect(result.contents[0].mimeType).toBe('application/json');

    const status = JSON.parse(result.contents[0].text as string);
    expect(status).toHaveProperty('platform');
    expect(status).toHaveProperty('model');
    expect(status.model).toBe('claude-sonnet-4-20250514');
  });

  it('should read gui://audit-log resource', async () => {
    const result = await client.readResource({ uri: 'gui://audit-log' });
    expect(result.contents).toHaveLength(1);
    const log = JSON.parse(result.contents[0].text as string);
    expect(Array.isArray(log)).toBe(true);
  });
});
