/**
 * Test: Remote MCP Server with Streamable HTTP (auth headers)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { writeFileSync, rmSync, readdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { buildRequestHeaders } from '../src/transport/headers.js';
import type { StreamableServerEntry } from '../src/types.js';

// Test constants
const TEST_CONFIG_DIR = join(tmpdir(), 'test-mcp-remote-headers');
const TEST_URL = 'https://mcp.coze.cn/v1/plugins/7407724292865130515';

// 注意: 这是临时测试 token，不要固化到代码中
const TEST_AUTH_TOKEN = process.env.TEST_AUTH_TOKEN || 'Bearer cztei_xxx';
const TEST_HEADERS = {
  Authorization: TEST_AUTH_TOKEN,
};

// Helper to create a test config file
function createTestConfig(serverName: string, headers?: Record<string, string>): string {
  const configPath = join(TEST_CONFIG_DIR, `${serverName}.json`);
  const config = {
    mcpServers: {
      [serverName]: {
        url: TEST_URL,
        transport: 'streamable-http',
        headers: headers || TEST_HEADERS,
      },
    },
  };
  writeFileSync(configPath, JSON.stringify(config), 'utf-8');
  return configPath;
}

// Helper to cleanup test files
function cleanupTestFiles() {
  try {
    const files = readdirSync(TEST_CONFIG_DIR);
    for (const file of files) {
      rmSync(file);
    }
  } catch {
    // ignore
  }
}

describe('buildRequestHeaders', () => {
  beforeEach(() => {
    cleanupTestFiles();
  });

  it('should return undefined when entry has no headers or authToken', () => {
    const entry: StreamableServerEntry = {
      url: TEST_URL,
      transport: 'streamable-http',
    };

    const result = buildRequestHeaders(entry);
    expect(result).toBeUndefined();
  });

  it('should return headers with Bearer prefix when entry has authToken', () => {
    const rawToken = 'my-auth-token';
    const entry: StreamableServerEntry = {
      url: TEST_URL,
      transport: 'streamable-http',
      authToken: rawToken,
    };

    const result = buildRequestHeaders(entry);
    expect(result).toEqual({
      Authorization: `Bearer ${rawToken}`,
    });
  });

  it('should return headers directly when entry has headers', () => {
    const customHeaders = {
      'X-Custom-Header': 'custom-value',
      Authorization: 'CustomAuth custom-token',
    };
    const entry: StreamableServerEntry = {
      url: TEST_URL,
      transport: 'streamable-http',
      headers: customHeaders,
    };

    const result = buildRequestHeaders(entry);
    expect(result).toEqual(customHeaders);
  });

  it('should let authToken override headers.Authorization when both are provided', () => {
    const customHeaders = {
      Authorization: 'CustomAuth custom-token',
    };
    const entry: StreamableServerEntry = {
      url: TEST_URL,
      transport: 'streamable-http',
      headers: customHeaders,
      authToken: 'override-token',
    };

    const result = buildRequestHeaders(entry);
    // authToken 会覆盖 headers 中的 Authorization
    expect(result).toEqual({
      Authorization: 'Bearer override-token',
    });
  });

  it('should return undefined when entry is a stdio entry (no url)', () => {
    const entry = {
      command: 'npx',
      args: ['-y', 'some-mcp-server'],
    } as unknown as StreamableServerEntry;

    const result = buildRequestHeaders(entry);
    expect(result).toBeUndefined();
  });
});

describe('detectProtocol with auth failure', () => {
  // 这个测试需要真实的网络请求， 仅用于调试目的
  // 注意: 不要在 CI 中启用， 因为 token 会过期
  it.skip('should handle 401 auth failure gracefully', async () => {
    const { detectProtocol } = await import('../src/detect.js');

    const invalidToken = 'Bearer invalid-token-for-testing';
    const result = await detectProtocol(TEST_URL, {
      Authorization: invalidToken,
    });

    // 即使鉴权失败， 也应该返回一个协议类型（默认 sse）
    expect(['sse', 'stream']).toContain(result);
  });
});
