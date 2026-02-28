/**
 * 单元测试: dependencies
 *
 * 测试依赖管理相关函数
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import path from 'path';

// Mock electron
vi.mock('electron', () => ({
  app: {
    getPath: vi.fn((name: string) => {
      if (name === 'home') return '/mock/home';
      return '/mock/appdata';
    }),
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

// Mock fs - will be configured in each test as needed
const mockExistsSync = vi.fn(() => true);
const mockReaddirSync = vi.fn(() => []);
vi.mock('fs', () => ({
  existsSync: (...args: unknown[]) => mockExistsSync(...args),
  readdirSync: (...args: unknown[]) => mockReaddirSync(...args),
}));

describe('dependencies', () => {
  const { app } = require('electron');

  beforeEach(() => {
    vi.clearAllMocks();
    // Reset module cache to get fresh module state
    vi.resetModules();

    // Reset fs mocks to default behavior
    mockExistsSync.mockReturnValue(true);
    mockReaddirSync.mockReturnValue([]);

    // Set up test environment
    Object.defineProperty(process, 'platform', {
      value: 'darwin',
      writable: true,
      configurable: true,
    });
    process.env.HOME = '/mock/home';
    process.env.USER = 'testuser';
    process.env.USERNAME = 'testuser';
    process.env.LANG = 'en_US.UTF-8';
    process.env.PATH = '/usr/bin:/bin:/usr/local/bin:/mock/home/.nvm/versions/node/v20.0.0/bin';
    process.env.NVM_DIR = undefined;
  });

  afterEach(() => {
    delete process.env.HOME;
    delete process.env.USER;
    delete process.env.USERNAME;
    delete process.env.LANG;
    delete process.env.PATH;
    delete process.env.NVM_DIR;
  });

  describe('Mirror Config', () => {
    it('should return default mirror config', async () => {
      const { getMirrorConfig } = await import('../system/dependencies');
      const config = getMirrorConfig();

      expect(config).toEqual({
        npmRegistry: 'https://registry.npmmirror.com/',
        uvIndexUrl: 'https://mirrors.aliyun.com/pypi/simple/',
      });
    });

    it('should update npm registry', async () => {
      const { setMirrorConfig, getMirrorConfig } = await import('../system/dependencies');
      setMirrorConfig({ npmRegistry: 'https://registry.npmjs.org/' });
      const config = getMirrorConfig();

      expect(config.npmRegistry).toBe('https://registry.npmjs.org/');
    });

    it('should update uv index url', async () => {
      const { setMirrorConfig, getMirrorConfig } = await import('../system/dependencies');
      setMirrorConfig({ uvIndexUrl: 'https://pypi.org/simple/' });
      const config = getMirrorConfig();

      expect(config.uvIndexUrl).toBe('https://pypi.org/simple/');
    });

    it('should update both registry configs', async () => {
      const { setMirrorConfig, getMirrorConfig } = await import('../system/dependencies');
      setMirrorConfig({
        npmRegistry: 'https://npm.taobao.org/',
        uvIndexUrl: 'https://pypi.tuna.tsinghua.edu.cn/simple/',
      });
      const config = getMirrorConfig();

      expect(config.npmRegistry).toBe('https://npm.taobao.org/');
      expect(config.uvIndexUrl).toBe('https://pypi.tuna.tsinghua.edu.cn/simple/');
    });
  });

  describe('getAppEnv', () => {
    it('should include app-specific paths in PATH', async () => {
      const { getAppEnv } = await import('../system/dependencies');
      const env = getAppEnv();

      // 与实现一致：getAppEnv 用 process.platform 决定分隔符（darwin 在 beforeEach 已 mock）
      const pathSep = process.platform === 'win32' ? ';' : ':';
      const pathEntries = env.PATH?.split(pathSep) || [];
      const home = path.join('/mock', 'home');
      const appData = path.join(home, '.nuwax-agent');
      expect(pathEntries).toContain(path.join(appData, 'node_modules', '.bin'));
      expect(pathEntries).toContain(path.join(appData, 'bin'));
    });

    it('should set NODE_PATH to app node_modules', async () => {
      const { getAppEnv } = await import('../system/dependencies');
      const env = getAppEnv();

      const expected = path.join('/mock', 'home', '.nuwax-agent', 'node_modules');
      expect(env.NODE_PATH).toBe(expected);
    });

    it('should set npm config registry', async () => {
      const { getAppEnv } = await import('../system/dependencies');
      const env = getAppEnv();

      expect(env.NPM_CONFIG_REGISTRY).toBe('https://registry.npmmirror.com/');
    });

    it('should set npm userconfig to app directory', async () => {
      const { getAppEnv } = await import('../system/dependencies');
      const env = getAppEnv();

      const expected = path.join('/mock', 'home', '.nuwax-agent', '.npmrc');
      expect(env.NPM_CONFIG_USERCONFIG).toBe(expected);
    });

    it('should disable npm update notifier', async () => {
      const { getAppEnv } = await import('../system/dependencies');
      const env = getAppEnv();

      expect(env.NO_UPDATE_NOTIFIER).toBe('true');
    });

    it('should set UV_INDEX_URL to mirror config', async () => {
      const { getAppEnv } = await import('../system/dependencies');
      const env = getAppEnv();

      expect(env.UV_INDEX_URL).toBe('https://mirrors.aliyun.com/pypi/simple/');
    });

    it('should disable uv auto-install', async () => {
      const { getAppEnv } = await import('../system/dependencies');
      const env = getAppEnv();

      expect(env.UV_NO_INSTALL).toBe('1');
    });

    it('should preserve HOME environment variable', async () => {
      const { getAppEnv } = await import('../system/dependencies');
      const env = getAppEnv();

      expect(env.HOME).toBe('/mock/home');
    });

    it('should not include undefined values', async () => {
      const { getAppEnv } = await import('../system/dependencies');
      const env = getAppEnv();

      // All values should be strings, no undefined
      Object.values(env).forEach(val => {
        expect(typeof val).toBe('string');
      });
    });
  });

  describe('SETUP_REQUIRED_DEPENDENCIES', () => {
    it('should have uv as bundled dependency', async () => {
      const { SETUP_REQUIRED_DEPENDENCIES } = await import('../system/dependencies');
      const uvDep = SETUP_REQUIRED_DEPENDENCIES.find(d => d.name === 'uv');

      expect(uvDep).toBeDefined();
      expect(uvDep?.type).toBe('bundled');
      expect(uvDep?.required).toBe(true);
      expect(uvDep?.minVersion).toBe('0.5.0');
    });

    it('should have nuwax-file-server as npm-local dependency', async () => {
      const { SETUP_REQUIRED_DEPENDENCIES } = await import('../system/dependencies');
      const fileServerDep = SETUP_REQUIRED_DEPENDENCIES.find(
        d => d.name === 'nuwax-file-server',
      );

      expect(fileServerDep).toBeDefined();
      expect(fileServerDep?.type).toBe('npm-local');
      expect(fileServerDep?.required).toBe(true);
      expect(fileServerDep?.binName).toBe('nuwax-file-server');
    });

    it('should have nuwaxcode as npm-local dependency', async () => {
      const { SETUP_REQUIRED_DEPENDENCIES } = await import('../system/dependencies');
      const agentDep = SETUP_REQUIRED_DEPENDENCIES.find(
        d => d.name === 'nuwaxcode',
      );

      expect(agentDep).toBeDefined();
      expect(agentDep?.type).toBe('npm-local');
      expect(agentDep?.required).toBe(true);
    });

    it('should have nuwax-mcp-stdio-proxy as npm-local dependency', async () => {
      const { SETUP_REQUIRED_DEPENDENCIES } = await import('../system/dependencies');
      const mcpDep = SETUP_REQUIRED_DEPENDENCIES.find(
        d => d.name === 'nuwax-mcp-stdio-proxy',
      );

      expect(mcpDep).toBeDefined();
      expect(mcpDep?.type).toBe('npm-local');
      expect(mcpDep?.required).toBe(true);
      expect(mcpDep?.binName).toBe('nuwax-mcp-stdio-proxy');
    });

    it('should have all required dependencies', async () => {
      const { SETUP_REQUIRED_DEPENDENCIES } = await import('../system/dependencies');
      const requiredDeps = SETUP_REQUIRED_DEPENDENCIES.filter(d => d.required);

      expect(requiredDeps.length).toBeGreaterThan(0);
      requiredDeps.forEach(dep => {
        expect(dep.required).toBe(true);
      });
    });
  });

  describe('getSystemPaths', () => {
    it('should filter out project-level node_modules paths', async () => {
      process.env.PATH = '/usr/bin:/project/node_modules/.bin:/usr/local/bin';

      const { getAppEnv } = await import('../system/dependencies');
      const env = getAppEnv();
      const pathEntries = env.PATH?.split(':') || [];

      // Should not contain project node_modules
      expect(pathEntries.find(p => p.includes('node_modules/.bin') && !p.includes('.nuwax-agent'))).toBeUndefined();
      // Should contain system paths
      expect(pathEntries.some(p => p === '/usr/bin' || p === '/usr/local/bin')).toBe(true);
    });

    // macOS-specific test - skip on Windows
    const testOnMacOS = process.platform === 'darwin' ? it : it.skip;

    testOnMacOS('should include NVM node versions in PATH on macOS', async () => {
      process.env.PATH = '/usr/bin';
      process.env.NVM_DIR = '/mock/home/.nvm';

      // Mock NVM versions directory
      mockExistsSync.mockImplementation((p: string) => {
        if (p.includes('.nvm/versions/node')) return true;
        if (p.includes('v20.10.0/bin')) return true;
        return true;
      });
      mockReaddirSync.mockImplementation((p: string) => {
        if (p.includes('.nvm/versions/node')) {
          return ['v18.0.0', 'v20.10.0', 'v16.5.0'];
        }
        return [];
      });

      const { getAppEnv } = await import('../system/dependencies');
      const env = getAppEnv();
      const pathEntries = env.PATH?.split(':') || [];

      // Should include the latest NVM version bin path
      expect(pathEntries.some(p => p.includes('v20.10.0/bin'))).toBe(true);
    });

    testOnMacOS('should include fnm node versions in PATH on macOS', async () => {
      process.env.PATH = '/usr/bin';

      // Mock fnm directory
      mockExistsSync.mockImplementation((p: string) => {
        if (p.includes('.fnm')) return true;
        if (p.includes('node-installations')) return true;
        if (p.includes('v22.0.0/installation/bin')) return true;
        return true;
      });
      mockReaddirSync.mockImplementation((p: string) => {
        if (p.includes('node-installations')) {
          return ['v20.0.0', 'v22.0.0'];
        }
        return [];
      });

      const { getAppEnv } = await import('../system/dependencies');
      const env = getAppEnv();
      const pathEntries = env.PATH?.split(':') || [];

      // Should include the latest fnm version bin path
      expect(pathEntries.some(p => p.includes('v22.0.0/installation/bin'))).toBe(true);
    });

    it('should include Homebrew paths on macOS', async () => {
      process.env.PATH = '/usr/bin';

      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockReturnValue([]);

      const { getAppEnv } = await import('../system/dependencies');
      const env = getAppEnv();
      const pathEntries = env.PATH?.split(':') || [];

      // Should include common Homebrew paths
      expect(pathEntries).toContain('/usr/local/bin');
      expect(pathEntries).toContain('/opt/homebrew/bin');
    });

    it('should include Windows npm path on Windows', async () => {
      Object.defineProperty(process, 'platform', {
        value: 'win32',
        writable: true,
        configurable: true,
      });
      process.env.PATH = 'C:\\Windows\\System32';
      process.env.USERPROFILE = 'C:\\Users\\testuser';

      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockReturnValue([]);

      const { getAppEnv } = await import('../system/dependencies');
      const env = getAppEnv();
      const pathEntries = env.PATH?.split(';') || [];

      // Should include Windows npm path
      expect(pathEntries.some(p => p.includes('AppData\\Roaming\\npm') || p.includes('AppData/Roaming/npm'))).toBe(true);
    });

    it('should preserve system npm paths (not filter out NVM/fnm)', async () => {
      process.env.PATH = '/usr/bin:/mock/home/.nvm/versions/node/v20.0.0/bin:/mock/home/.fnm/node-installations/v18.0.0/installation/bin';

      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockReturnValue([]);

      const { getAppEnv } = await import('../system/dependencies');
      const env = getAppEnv();
      const pathEntries = env.PATH?.split(':') || [];

      // NVM and fnm paths should be preserved (not filtered out)
      expect(pathEntries.some(p => p.includes('.nvm/versions'))).toBe(true);
      expect(pathEntries.some(p => p.includes('.fnm'))).toBe(true);
    });

    it('should not include paths that do not exist', async () => {
      process.env.PATH = '/usr/bin';

      // Only some paths exist
      mockExistsSync.mockImplementation((p: string) => {
        if (p === '/usr/local/bin') return false;
        if (p === '/opt/homebrew/bin') return false;
        return true;
      });
      mockReaddirSync.mockReturnValue([]);

      const { getAppEnv } = await import('../system/dependencies');
      const env = getAppEnv();
      const pathEntries = env.PATH?.split(':') || [];

      // Non-existent paths should not be included
      expect(pathEntries).not.toContain('/usr/local/bin');
      expect(pathEntries).not.toContain('/opt/homebrew/bin');
    });

    testOnMacOS('should select latest semantic version from NVM versions', async () => {
      process.env.PATH = '/usr/bin';
      process.env.NVM_DIR = '/mock/home/.nvm';

      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockImplementation((p: string) => {
        if (p.includes('.nvm/versions/node')) {
          // Test version sorting: v10.0.0 should not be selected over v9.0.0 by string sort
          return ['v9.0.0', 'v10.0.0', 'v8.15.0'];
        }
        return [];
      });

      const { getAppEnv } = await import('../system/dependencies');
      const env = getAppEnv();
      const pathEntries = env.PATH?.split(':') || [];

      // Should select v10.0.0 (highest version), not v9.0.0 (alphabetically last)
      expect(pathEntries.some(p => p.includes('v10.0.0/bin'))).toBe(true);
      expect(pathEntries.some(p => p.includes('v9.0.0/bin'))).toBe(false);
    });

    it('should cache system paths result', async () => {
      process.env.PATH = '/usr/bin';

      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockReturnValue([]);

      // Import module twice
      const module1 = await import('../system/dependencies');
      const env1 = module1.getAppEnv();

      const module2 = await import('../system/dependencies');
      const env2 = module2.getAppEnv();

      // Both should return the same cached result
      expect(env1.PATH).toBe(env2.PATH);
    });
  });

  describe('bundled resources', () => {
    const mockLog = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };

    beforeEach(() => {
      vi.clearAllMocks();
      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockReturnValue([]);
    });

    describe('getNodeBinPath', () => {
      it('should return correct path on macOS x64', async () => {
        Object.defineProperty(process, 'platform', { value: 'darwin', writable: true });
        Object.defineProperty(process, 'arch', { value: 'x64', writable: true });

        const { getNodeBinPath } = await import('../system/dependencies');
        const result = getNodeBinPath();

        expect(result).toContain('darwin-x64');
        expect(result).toContain('bin/node');
        expect(result).not.toContain('node.exe');
      });

      it('should return correct path on macOS arm64', async () => {
        Object.defineProperty(process, 'platform', { value: 'darwin', writable: true });
        Object.defineProperty(process, 'arch', { value: 'arm64', writable: true });

        const { getNodeBinPath } = await import('../system/dependencies');
        const result = getNodeBinPath();

        expect(result).toContain('darwin-arm64');
        expect(result).toContain('bin/node');
      });

      it('should return correct path on Windows x64', async () => {
        Object.defineProperty(process, 'platform', { value: 'win32', writable: true });
        Object.defineProperty(process, 'arch', { value: 'x64', writable: true });

        const { getNodeBinPath } = await import('../system/dependencies');
        const result = getNodeBinPath();

        expect(result).toContain('win32-x64');
        expect(result).toContain('bin/node.exe');
      });

      it('should return correct path on Linux x64', async () => {
        Object.defineProperty(process, 'platform', { value: 'linux', writable: true });
        Object.defineProperty(process, 'arch', { value: 'x64', writable: true });

        const { getNodeBinPath } = await import('../system/dependencies');
        const result = getNodeBinPath();

        expect(result).toContain('linux-x64');
        expect(result).toContain('bin/node');
      });

      it('should return null when node binary does not exist', async () => {
        mockExistsSync.mockReturnValue(false);

        const { getNodeBinPath } = await import('../system/dependencies');
        const result = getNodeBinPath();

        expect(result).toBeNull();
      });

      it('should log warning when node binary does not exist', async () => {
        mockExistsSync.mockReturnValue(false);

        const { getNodeBinPath } = await import('../system/dependencies');
        // Mock electron-log after importing
        const log = await import('electron-log');
        Object.assign(log.default, mockLog);

        getNodeBinPath();

        expect(mockLog.warn).toHaveBeenCalledWith(
          expect.stringContaining('内置 Node.js 未找到')
        );
        expect(mockLog.warn).toHaveBeenCalledWith(
          expect.stringContaining('prepare:node')
        );
      });
    });
  });
});
