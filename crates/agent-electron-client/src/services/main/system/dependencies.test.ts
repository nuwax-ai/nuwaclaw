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

// Mock fs
vi.mock('fs', () => ({
  existsSync: vi.fn(() => true),
}));

describe('dependencies', () => {
  const { app } = require('electron');

  beforeEach(() => {
    vi.clearAllMocks();
    // Reset module cache to get fresh module state
    vi.resetModules();

    // Set up test environment
    Object.defineProperty(process, 'platform', {
      value: 'darwin',
      writable: true,
    });
    process.env.HOME = '/mock/home';
    process.env.USER = 'testuser';
    process.env.USERNAME = 'testuser';
    process.env.LANG = 'en_US.UTF-8';
    process.env.PATH = '/usr/bin:/bin:/usr/local/bin:/home/user/.nvm/versions/node/v20.0.0/bin';
  });

  afterEach(() => {
    delete process.env.HOME;
    delete process.env.USER;
    delete process.env.USERNAME;
    delete process.env.LANG;
    delete process.env.PATH;
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

      // 使用 path.delimiter 以支持 Windows（;）与 Unix（:）
      const pathEntries = env.PATH?.split(path.delimiter) || [];
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

    it('should have mcp-stdio-proxy as npm-local dependency', async () => {
      const { SETUP_REQUIRED_DEPENDENCIES } = await import('../system/dependencies');
      const mcpDep = SETUP_REQUIRED_DEPENDENCIES.find(
        d => d.name === 'mcp-stdio-proxy',
      );

      expect(mcpDep).toBeDefined();
      expect(mcpDep?.type).toBe('npm-local');
      expect(mcpDep?.required).toBe(true);
      expect(mcpDep?.binName).toBe('mcp-proxy');
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
});
