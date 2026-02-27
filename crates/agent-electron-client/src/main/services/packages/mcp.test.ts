/**
 * 单元测试: MCP Proxy Manager
 *
 * 测试 MCP Proxy 进程管理相关功能
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

// Mock net - 端口检测返回 false（端口可用）
vi.mock('net', () => ({
  Socket: class MockSocket {
    setTimeout() { return this; }
    on(event: string, callback: Function) {
      // 立即触发 error 事件，表示端口可用
      if (event === 'error') {
        setTimeout(() => callback(new Error('Connection refused')), 0);
      }
      return this;
    }
    connect() { return this; }
    destroy() { return this; }
  },
}));

// Mock child_process
const mockSpawn = vi.fn();
const mockExec = vi.fn();
vi.mock('child_process', () => ({
  spawn: (...args: unknown[]) => mockSpawn(...args),
  exec: (...args: unknown[]) => mockExec(...args),
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

describe('McpProxyManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();

    // 重置 mock
    mockExistsSync.mockReturnValue(true);
    mockSpawn.mockReset();
    mockExec.mockReset();
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

    it('setPort 和 getPort 应该正确工作', async () => {
      const { mcpProxyManager } = await import('./mcp');

      mcpProxyManager.setPort(19000);
      expect(mcpProxyManager.getPort()).toBe(19000);
    });
  });

  describe('getStatus', () => {
    it('进程未启动时应该返回 running=false', async () => {
      const { mcpProxyManager } = await import('./mcp');

      const status = mcpProxyManager.getStatus();
      expect(status.running).toBe(false);
      expect(status.pid).toBeUndefined();
    });
  });

  describe('getAgentMcpConfig', () => {
    it('进程未运行时应该返回直接 stdio 配置', async () => {
      const { mcpProxyManager } = await import('./mcp');

      const mcpConfig = mcpProxyManager.getAgentMcpConfig();

      // 默认配置中有 chrome-devtools
      expect(mcpConfig).toBeDefined();
      // 进程未运行时，不应该返回 mcp-proxy convert 配置
      expect(mcpConfig?.['mcp-proxy']).toBeUndefined();
    });

    it('没有配置服务器时应该返回 null', async () => {
      const { mcpProxyManager } = await import('./mcp');

      // 清空配置
      mcpProxyManager.setConfig({ mcpServers: {} });

      const mcpConfig = mcpProxyManager.getAgentMcpConfig();
      expect(mcpConfig).toBeNull();
    });
  });

  describe('cleanup', () => {
    it('进程未运行时 cleanup 应该安全执行', async () => {
      const { mcpProxyManager } = await import('./mcp');

      // 不应该抛出错误
      expect(() => mcpProxyManager.cleanup()).not.toThrow();
    });
  });

  describe('stop', () => {
    it('进程未运行时 stop 应该返回成功', async () => {
      const { mcpProxyManager } = await import('./mcp');

      const result = await mcpProxyManager.stop();
      expect(result.success).toBe(true);
    });
  });

  describe('start - 错误处理', () => {
    it('mcp-stdio-proxy 未安装时应该返回错误', async () => {
      // 重新 mock isInstalledLocally 返回 false
      vi.doMock('./packageLocator', () => ({
        getAppPaths: vi.fn(() => ({
          nodeModules: '/mock/home/.nuwax-agent/node_modules',
        })),
        isInstalledLocally: vi.fn(() => false),
      }));

      // 需要重新导入模块
      vi.resetModules();

      const { mcpProxyManager } = await import('./mcp');
      const result = await mcpProxyManager.start();

      expect(result.success).toBe(false);
      expect(result.error).toContain('未安装');
    });
  });

  describe('restart', () => {
    it('restart 应该先 stop 再 start', async () => {
      const { mcpProxyManager } = await import('./mcp');

      // Mock stop 和 start
      const stopSpy = vi.spyOn(mcpProxyManager, 'stop');
      const startSpy = vi.spyOn(mcpProxyManager, 'start');

      await mcpProxyManager.restart();

      expect(stopSpy).toHaveBeenCalled();
      expect(startSpy).toHaveBeenCalled();
    });
  });
});
