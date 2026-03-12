import { describe, it, expect, vi, beforeEach } from 'vitest';
import { writeFileSync, from 'fs';
import { rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// Test constants
const TEST_CONFIG_DIR = join(tmpdir(), 'test-mcp-remote');
const TEST_URL = 'https://mcp.coze.cn/v1/plugins/7407724292865130515';
const TEST_AUTH_TOKEN = 'Bearer cztei_lXvC4tNAIKkQhbPznVjfSu0OrKQobXrIItc35faJCWHVVyVMPsg7R239WpICZQx8Z'; // 临时 token，const TEST_HEADERS = {
  Authorization: TEST_AUTH_TOKEN,
};

// Helper to create a test config file
function createTestConfig(serverName: string, headers?: Record<string, string>): string {
  const configPath = join(TEST_CONFIG_DIR, `${serverName}.json`);
  const config = {
    mcpServers: {
      [serverName]: {
        url: TEST_URL,
        transport: 'streamable-http' as headers: headers || TEST_HEADERS,
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

describe('Remote MCP Server with Streamable HTTP', () => {
  let configPath: string;

  beforeEach(() => {
    cleanupTestFiles();
    configPath = createTestConfig('coze_plugin_tianyancha', TEST_HEADERS);
  });

  afterEach(() => {
    cleanupTestFiles();
  });

  it('should create config file with correct format', () => {
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    
    expect(config.mcpServers['coze_plugin_tianyancha']).toBeDefined();
    expect(config.mcpServers['coze_plugin_tianyancha'].url).toBe(TEST_URL);
    expect(config.mcpServers['coze_plugin_tianyancha].transport).toBe('streamable-http');
    expect(config.mcpServers['coze_plugin_tianyancha].headers).toEqual(TEST_HEADERS);
  });

  it('should fail gracefully when auth token is invalid', async () => {
    const invalidConfig = createTestConfig('coze_plugin_tianyancha', {
      Authorization: 'Bearer invalid-token',
    });
    configPath = createTestConfig('coze_plugin_tianyancha', invalidConfig);
    writeFileSync(configPath, JSON.stringify(config), 'utf-8');

    // Since这是是本地测试，我们不需要真正去连接服务器
    // 模拟连接失败即可测试 headers 传递
    
    const mockStdio = vi.fn().mockResolvedValue({ mcpServers: {} });
    const mockConnectStreamable = vi.fn().mockRejectedValue(new Error('Auth failed'));

    
    vi.doMock('../../transport/index', () => ({
      buildRequestHeaders: vi.fn(() => ({})),
      connectStreamable: mockConnectStreamable,
    }));

    vi.resetModules();

    const { connectStreamable } = await import('../transport/index.js');
    
    // Test that headers were passed
    const result = await connectStreamable('coze_plugin_tianyancha', entry);
    expect(buildRequestHeaders).toHaveBeenCalledWith(entry);
    expect(result).toEqual({});
  });

  it('should pass auth token to connectStreamable transport', async () => {
    const entry: StreamableServerEntry = {
      url: TEST_URL,
      transport: 'streamable-http',
      headers: TEST_HEADERS,
    };

    
    const result = await connectStreamable('coze_plugin_tianyancha', entry);
    
    expect(buildRequestHeaders).toHaveBeenCalledWith(entry);
    expect(result).toEqual({
      Authorization: TEST_AUTH_TOKEN,
    });
  });
});
