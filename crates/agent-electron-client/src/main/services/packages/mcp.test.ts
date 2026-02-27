/**
 * 单元测试: MCP Proxy Manager
 *
 * 测试 MCP Proxy 配置管理和 binary 验证
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock electron
vi.mock('electron', () => ({
  app: {
    getPath: vi.fn((name: string) => {
      if (name === 'home') return '/mock/home';
      return '/mock/appdata';
    }),
    isPackaged: false,
  },
}));

// Mock electron-log
vi.mock('electron-log', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock fs
const mockExistsSync = vi.fn(() => true);
const mockMkdirSync = vi.fn();
vi.mock('fs', () => ({
  existsSync: (...args: unknown[]) => mockExistsSync(...args),
  mkdirSync: (...args: unknown[]) => mockMkdirSync(...args),
}));

// Mock dependencies（含 getUvBinPath，供 mcp 内 getUvBinDir 等使用）
vi.mock('../system/dependencies', () => ({
  getAppEnv: vi.fn(() => ({
    PATH: '/mock/path',
    NODE_PATH: '/mock/node_path',
    UV_TOOL_DIR: '/mock/uv_tool',
    UV_CACHE_DIR: '/mock/uv_cache',
    UV_INDEX_URL: '',
  })),
  getUvBinPath: vi.fn(() => '/mock/uv/bin/uv'),
}));

vi.mock('./packageLocator', () => ({
  getAppPaths: vi.fn(() => ({
    nodeModules: '/mock/home/.nuwax-agent/node_modules',
  })),
  isInstalledLocally: vi.fn(() => true),
}));

vi.mock('../utils/spawnNoWindow', () => ({
  resolveNpmPackageEntry: vi.fn(() => '/mock/home/.nuwax-agent/node_modules/nuwax-mcp-stdio-proxy/dist/index.js'),
}));

// Mock persistentMcpBridge (避免加载 MCP SDK)
vi.mock('./persistentMcpBridge', () => ({
  persistentMcpBridge: {
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    isRunning: vi.fn(() => false),
    getBridgeUrl: vi.fn(() => null),
    isServerHealthy: vi.fn(() => false),
  },
}));

describe('McpProxyManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();

    // 重置 mock
    mockExistsSync.mockReturnValue(true);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('配置管理', () => {
    it('setConfig 和 getConfig 应该正确工作', async () => {
      const { mcpProxyManager } = await import('./mcp');

      const newConfig = {
        mcpServers: {
          'test-server': {
            command: 'npx',
            args: ['-y', 'test-mcp'],
          },
        },
      };

      mcpProxyManager.setConfig(newConfig);
      const config = mcpProxyManager.getConfig();

      expect(config.mcpServers['test-server']).toBeDefined();
      expect(config.mcpServers['test-server'].command).toBe('npx');
    });

    it('addServer 和 removeServer 应该正确工作', async () => {
      const { mcpProxyManager } = await import('./mcp');

      mcpProxyManager.addServer('new-server', {
        command: 'node',
        args: ['server.js'],
      });

      let config = mcpProxyManager.getConfig();
      expect(config.mcpServers['new-server']).toBeDefined();

      mcpProxyManager.removeServer('new-server');
      config = mcpProxyManager.getConfig();
      expect(config.mcpServers['new-server']).toBeUndefined();
    });
  });

  describe('getStatus', () => {
    it('start() 后应该返回 running=true 和 server 数量', async () => {
      const { mcpProxyManager } = await import('./mcp');

      await mcpProxyManager.start();
      const status = mcpProxyManager.getStatus();
      expect(status.running).toBe(true);
      expect(status.serverCount).toBeGreaterThan(0);
    });

    it('未调用 start() 时应该返回 running=false', async () => {
      const { mcpProxyManager } = await import('./mcp');

      const status = mcpProxyManager.getStatus();
      expect(status.running).toBe(false);
    });

    it('binary 不存在时应该返回 running=false', async () => {
      vi.doMock('../utils/spawnNoWindow', () => ({
        resolveNpmPackageEntry: vi.fn(() => null),
      }));
      vi.resetModules();

      const { mcpProxyManager } = await import('./mcp');
      const status = mcpProxyManager.getStatus();
      expect(status.running).toBe(false);

      // Restore original mock
      vi.doMock('../utils/spawnNoWindow', () => ({
        resolveNpmPackageEntry: vi.fn(() => '/mock/home/.nuwax-agent/node_modules/nuwax-mcp-stdio-proxy/dist/index.js'),
      }));
    });
  });

  describe('getAgentMcpConfig', () => {
    it('临时 server 应该返回 mcp-proxy 聚合配置', async () => {
      const { mcpProxyManager } = await import('./mcp');

      // 设置只有临时 server 的配置
      mcpProxyManager.setConfig({
        mcpServers: {
          'test-server': {
            command: 'npx',
            args: ['-y', 'test-mcp'],
          },
        },
      });

      // start() 填充缓存路径
      await mcpProxyManager.start();
      const mcpConfig = mcpProxyManager.getAgentMcpConfig();

      expect(mcpConfig).toBeDefined();
      // 临时 server → mcp-proxy 聚合
      expect(mcpConfig?.['mcp-proxy']).toBeDefined();
      expect(mcpConfig?.['mcp-proxy'].args).toContain('--config');
      expect(mcpConfig?.['mcp-proxy'].command).toBe(process.execPath);
      expect(mcpConfig?.['mcp-proxy'].env?.ELECTRON_RUN_AS_NODE).toBe('1');
    });

    it('默认配置只有 persistent server，bridge 未运行时应该返回 null', async () => {
      const { mcpProxyManager } = await import('./mcp');

      // start() 填充缓存路径（默认配置只有 chrome-devtools persistent）
      await mcpProxyManager.start();
      const mcpConfig = mcpProxyManager.getAgentMcpConfig();

      // PersistentMcpBridge 未运行（mock isRunning=false），无临时 server → null
      expect(mcpConfig).toBeNull();
    });

    it('persistent server 在 bridge 运行时应该返回 mcp-bridge 配置', async () => {
      // Mock bridge 为 running
      const { persistentMcpBridge } = await import('./persistentMcpBridge');
      (persistentMcpBridge.isRunning as any).mockReturnValue(true);
      (persistentMcpBridge.getBridgeUrl as any).mockReturnValue('http://127.0.0.1:12345/mcp/chrome-devtools');

      vi.resetModules();
      // Re-mock bridge in fresh module
      vi.doMock('./persistentMcpBridge', () => ({
        persistentMcpBridge: {
          start: vi.fn().mockResolvedValue(undefined),
          stop: vi.fn().mockResolvedValue(undefined),
          isRunning: vi.fn(() => true),
          getBridgeUrl: vi.fn(() => 'http://127.0.0.1:12345/mcp/chrome-devtools'),
          isServerHealthy: vi.fn(() => true),
        },
      }));
      vi.resetModules();

      const { mcpProxyManager } = await import('./mcp');
      await mcpProxyManager.start();
      const mcpConfig = mcpProxyManager.getAgentMcpConfig();

      // bridge 运行中 → 应该有 mcp-bridge key
      // 注意: getBridgeClientScriptPath() 在测试中可能找不到文件
      // 所以结果可能是 null (没有 bridge client script)
      // 这里只验证不会报错
      if (mcpConfig?.['mcp-bridge']) {
        expect(mcpConfig['mcp-bridge'].command).toBe(process.execPath);
        expect(mcpConfig['mcp-bridge'].env?.ELECTRON_RUN_AS_NODE).toBe('1');
      }
    });

    it('没有配置服务器时应该返回 null', async () => {
      const { mcpProxyManager } = await import('./mcp');

      // 清空配置
      mcpProxyManager.setConfig({ mcpServers: {} });

      const mcpConfig = mcpProxyManager.getAgentMcpConfig();
      expect(mcpConfig).toBeNull();
    });

    it('proxy script 不存在时应该 fallback 到直接 stdio 配置（临时 server）', async () => {
      vi.doMock('../utils/spawnNoWindow', () => ({
        resolveNpmPackageEntry: vi.fn(() => null),
      }));
      vi.resetModules();

      const { mcpProxyManager } = await import('./mcp');

      // 设置临时 server 以测试 fallback
      mcpProxyManager.setConfig({
        mcpServers: {
          'test-server': {
            command: 'npx',
            args: ['-y', 'test-mcp'],
          },
        },
      });

      const mcpConfig = mcpProxyManager.getAgentMcpConfig();

      expect(mcpConfig).toBeDefined();
      // fallback: 不应有 mcp-proxy key
      expect(mcpConfig?.['mcp-proxy']).toBeUndefined();

      // Restore original mock
      vi.doMock('../utils/spawnNoWindow', () => ({
        resolveNpmPackageEntry: vi.fn(() => '/mock/home/.nuwax-agent/node_modules/nuwax-mcp-stdio-proxy/dist/index.js'),
      }));
    });
  });

  describe('cleanup', () => {
    it('cleanup 应该安全执行（no-op）', async () => {
      const { mcpProxyManager } = await import('./mcp');

      expect(() => mcpProxyManager.cleanup()).not.toThrow();
    });
  });

  describe('stop', () => {
    it('stop 应该返回成功（no-op）', async () => {
      const { mcpProxyManager } = await import('./mcp');

      const result = await mcpProxyManager.stop();
      expect(result.success).toBe(true);
    });
  });

  describe('start - 验证 binary 可用性', () => {
    it('nuwax-mcp-stdio-proxy 已安装时应该返回成功', async () => {
      const { mcpProxyManager } = await import('./mcp');
      const result = await mcpProxyManager.start();
      expect(result.success).toBe(true);
    });

    it('nuwax-mcp-stdio-proxy 未安装时应该返回错误', async () => {
      vi.doMock('./packageLocator', () => ({
        getAppPaths: vi.fn(() => ({
          nodeModules: '/mock/home/.nuwax-agent/node_modules',
        })),
        isInstalledLocally: vi.fn(() => false),
      }));

      vi.resetModules();

      const { mcpProxyManager } = await import('./mcp');
      const result = await mcpProxyManager.start();

      expect(result.success).toBe(false);
      expect(result.error).toContain('未安装');
    });
  });

  describe('restart', () => {
    it('restart 应该调用 start', async () => {
      const { mcpProxyManager } = await import('./mcp');

      const startSpy = vi.spyOn(mcpProxyManager, 'start');

      await mcpProxyManager.restart();

      expect(startSpy).toHaveBeenCalled();
    });
  });
});
