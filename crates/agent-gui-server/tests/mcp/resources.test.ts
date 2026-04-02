/**
 * Unit tests for mcp/resources.ts — registerResources, 3 resource handlers.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock platform
const mockGetPlatform = vi.fn();
const mockCheckScreenRecording = vi.fn();
const mockCheckAccessibility = vi.fn();
vi.mock('../../src/utils/platform.js', () => ({
  getPlatform: () => mockGetPlatform(),
  checkScreenRecordingPermission: () => mockCheckScreenRecording(),
  checkAccessibilityPermission: () => mockCheckAccessibility(),
}));

import { registerResources } from '../../src/mcp/resources.js';
import { AuditLog } from '../../src/safety/auditLog.js';
import type { GuiAgentConfig } from '../../src/config.js';

// Minimal Server mock that captures request handlers
class MockServer {
  handlers = new Map<any, Function>();

  setRequestHandler(schema: any, handler: Function) {
    // Use the schema method name or the schema itself as key
    this.handlers.set(schema, handler);
  }

  // Get handler by schema
  getHandler(schema: any): Function | undefined {
    return this.handlers.get(schema);
  }
}

// We need the actual schemas to register & retrieve handlers
// Import them for use as keys
import {
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

const baseConfig: GuiAgentConfig = {
  apiKey: 'test-key',
  provider: 'anthropic',
  model: 'claude-sonnet-4-20250514',
  port: 60008,
  transport: 'http' as const,
  maxSteps: 50,
  stepDelayMs: 1500,
  stuckThreshold: 3,
  jpegQuality: 75,
  displayIndex: 0,
};

describe('registerResources', () => {
  let server: MockServer;
  let auditLog: AuditLog;

  beforeEach(() => {
    vi.clearAllMocks();
    server = new MockServer();
    auditLog = new AuditLog();
    mockGetPlatform.mockReturnValue('macos');
    registerResources(server as any, baseConfig, auditLog);
  });

  describe('ListResources', () => {
    it('returns 3 resources', async () => {
      const handler = server.getHandler(ListResourcesRequestSchema)!;
      const result = await handler({});
      expect(result.resources).toHaveLength(3);
    });

    it('includes gui://status, gui://permissions, gui://audit-log', async () => {
      const handler = server.getHandler(ListResourcesRequestSchema)!;
      const result = await handler({});
      const uris = result.resources.map((r: any) => r.uri);
      expect(uris).toContain('gui://status');
      expect(uris).toContain('gui://permissions');
      expect(uris).toContain('gui://audit-log');
    });
  });

  describe('ReadResource: gui://status', () => {
    it('returns platform, transport, port, model', async () => {
      const handler = server.getHandler(ReadResourceRequestSchema)!;
      const result = await handler({ params: { uri: 'gui://status' } });
      const status = JSON.parse(result.contents[0].text);
      expect(status.platform).toBe('macos');
      expect(status.transport).toBe('http');
      expect(status.port).toBe(60008);
      expect(status.model).toBe('claude-sonnet-4-20250514');
      expect(status.running).toBe(true);
    });
  });

  describe('ReadResource: gui://permissions', () => {
    it('returns screen recording and accessibility status', async () => {
      mockCheckScreenRecording.mockResolvedValue(true);
      mockCheckAccessibility.mockResolvedValue(false);

      const handler = server.getHandler(ReadResourceRequestSchema)!;
      const result = await handler({ params: { uri: 'gui://permissions' } });
      const perms = JSON.parse(result.contents[0].text);
      expect(perms.screenRecording).toBe(true);
      expect(perms.accessibility).toBe(false);
      expect(perms.platform).toBe('macos');
    });
  });

  describe('ReadResource: gui://audit-log', () => {
    it('returns empty entries when no audit records', async () => {
      const handler = server.getHandler(ReadResourceRequestSchema)!;
      const result = await handler({ params: { uri: 'gui://audit-log' } });
      const entries = JSON.parse(result.contents[0].text);
      expect(entries).toHaveLength(0);
    });

    it('returns recorded audit entries', async () => {
      auditLog.record({ tool: 'gui_click', args: { x: 100 }, success: true });
      auditLog.record({ tool: 'gui_type', args: { text: 'hi' }, success: true });

      const handler = server.getHandler(ReadResourceRequestSchema)!;
      const result = await handler({ params: { uri: 'gui://audit-log' } });
      const entries = JSON.parse(result.contents[0].text);
      expect(entries).toHaveLength(2);
      expect(entries[0].tool).toBe('gui_type'); // most recent first
    });
  });

  describe('ReadResource: unknown URI', () => {
    it('throws for unknown resource URI', async () => {
      const handler = server.getHandler(ReadResourceRequestSchema)!;
      await expect(handler({ params: { uri: 'gui://unknown' } })).rejects.toThrow('Unknown resource');
    });
  });
});
