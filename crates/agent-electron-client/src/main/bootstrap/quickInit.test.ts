import path from 'node:path';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// --- Mocks ---

vi.mock('electron-log', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

const mockExistsSync = vi.fn(() => false);
const mockReadFileSync = vi.fn(() => '');

vi.mock('node:fs', () => ({
  default: {
    existsSync: (...args: unknown[]) => mockExistsSync(...args),
    readFileSync: (...args: unknown[]) => mockReadFileSync(...args),
  },
  existsSync: (...args: unknown[]) => mockExistsSync(...args),
  readFileSync: (...args: unknown[]) => mockReadFileSync(...args),
}));

vi.mock('node:os', () => ({
  default: { homedir: () => '/mock/home' },
  homedir: () => '/mock/home',
}));

// Env vars to clean up after each test
const QUICK_INIT_ENV_KEYS = [
  'NUWAX_SERVER_HOST',
  'NUWAX_SAVED_KEY',
  'NUWAX_USER_NAME',
  'NUWAX_AGENT_PORT',
  'NUWAX_FILE_SERVER_PORT',
  'NUWAX_WORKSPACE_DIR',
];

describe('readQuickInitConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockExistsSync.mockReturnValue(false);
    mockReadFileSync.mockReturnValue('');
    // Clean env vars
    for (const key of QUICK_INIT_ENV_KEYS) {
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of QUICK_INIT_ENV_KEYS) {
      delete process.env[key];
    }
  });

  /** Helper: dynamic import (cache resets via vi.resetModules) */
  async function loadReader() {
    const mod = await import('./quickInit');
    return mod.readQuickInitConfig;
  }

  // ==================== 无配置 ====================

  it('should return null when no JSON file and no env vars', async () => {
    const readQuickInitConfig = await loadReader();
    expect(readQuickInitConfig()).toBeNull();
  });

  // ==================== JSON 配置 ====================

  it('should read config from JSON with all fields', async () => {
    const json = {
      quickInit: {
        serverHost: 'https://agent.nuwax.com',
        savedKey: 'key-123',
        username: 'user@test.com',
        agentPort: 9001,
        fileServerPort: 9002,
        workspaceDir: '/custom/workspace',
      },
    };
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(JSON.stringify(json));

    const readQuickInitConfig = await loadReader();
    const config = readQuickInitConfig();

    expect(config).toEqual({
      serverHost: 'https://agent.nuwax.com',
      savedKey: 'key-123',
      username: 'user@test.com',
      agentPort: 9001,
      fileServerPort: 9002,
      workspaceDir: '/custom/workspace',
    });
  });

  it('should fill defaults for optional JSON fields', async () => {
    const json = {
      quickInit: {
        serverHost: 'https://agent.nuwax.com',
        savedKey: 'key-123',
      },
    };
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(JSON.stringify(json));

    const readQuickInitConfig = await loadReader();
    const config = readQuickInitConfig();

    expect(config).not.toBeNull();
    expect(config!.serverHost).toBe('https://agent.nuwax.com');
    expect(config!.savedKey).toBe('key-123');
    expect(config!.username).toBe('');
    expect(config!.agentPort).toBe(60006);
    expect(config!.fileServerPort).toBe(60005);
    expect(config!.workspaceDir).toBe(path.join('/mock/home', '.nuwaclaw', 'workspace'));
  });

  it('should return null when JSON has enabled: false', async () => {
    const json = {
      quickInit: {
        enabled: false,
        serverHost: 'https://agent.nuwax.com',
        savedKey: 'key-123',
      },
    };
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(JSON.stringify(json));

    const readQuickInitConfig = await loadReader();
    expect(readQuickInitConfig()).toBeNull();
  });

  it('should NOT disable when enabled is true', async () => {
    const json = {
      quickInit: {
        enabled: true,
        serverHost: 'https://agent.nuwax.com',
        savedKey: 'key-123',
      },
    };
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(JSON.stringify(json));

    const readQuickInitConfig = await loadReader();
    expect(readQuickInitConfig()).not.toBeNull();
  });

  it('should return null when JSON has no quickInit scope', async () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(JSON.stringify({ otherConfig: {} }));

    const readQuickInitConfig = await loadReader();
    expect(readQuickInitConfig()).toBeNull();
  });

  it('should return null when JSON quickInit missing required fields', async () => {
    const json = { quickInit: { username: 'user' } };
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(JSON.stringify(json));

    const readQuickInitConfig = await loadReader();
    expect(readQuickInitConfig()).toBeNull();
  });

  it('should return null when JSON is malformed', async () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue('{ broken json');

    const readQuickInitConfig = await loadReader();
    expect(readQuickInitConfig()).toBeNull();
  });

  // ==================== 环境变量 ====================

  it('should read config from env vars when no JSON', async () => {
    process.env.NUWAX_SERVER_HOST = 'https://env.nuwax.com';
    process.env.NUWAX_SAVED_KEY = 'env-key-456';

    const readQuickInitConfig = await loadReader();
    const config = readQuickInitConfig();

    expect(config).not.toBeNull();
    expect(config!.serverHost).toBe('https://env.nuwax.com');
    expect(config!.savedKey).toBe('env-key-456');
    expect(config!.agentPort).toBe(60006);
    expect(config!.fileServerPort).toBe(60005);
    expect(config!.workspaceDir).toBe(path.join('/mock/home', '.nuwaclaw', 'workspace'));
  });

  it('should read optional env vars', async () => {
    process.env.NUWAX_SERVER_HOST = 'https://env.nuwax.com';
    process.env.NUWAX_SAVED_KEY = 'env-key';
    process.env.NUWAX_USER_NAME = 'envuser';
    process.env.NUWAX_AGENT_PORT = '7001';
    process.env.NUWAX_FILE_SERVER_PORT = '7002';
    process.env.NUWAX_WORKSPACE_DIR = '/env/workspace';

    const readQuickInitConfig = await loadReader();
    const config = readQuickInitConfig();

    expect(config).toEqual({
      serverHost: 'https://env.nuwax.com',
      savedKey: 'env-key',
      username: 'envuser',
      agentPort: 7001,
      fileServerPort: 7002,
      workspaceDir: '/env/workspace',
    });
  });

  it('should return null when only NUWAX_SERVER_HOST set (no savedKey)', async () => {
    process.env.NUWAX_SERVER_HOST = 'https://env.nuwax.com';

    const readQuickInitConfig = await loadReader();
    expect(readQuickInitConfig()).toBeNull();
  });

  it('should return null when only NUWAX_SAVED_KEY set (no serverHost)', async () => {
    process.env.NUWAX_SAVED_KEY = 'env-key';

    const readQuickInitConfig = await loadReader();
    expect(readQuickInitConfig()).toBeNull();
  });

  it('should ignore invalid NUWAX_AGENT_PORT', async () => {
    process.env.NUWAX_SERVER_HOST = 'https://env.nuwax.com';
    process.env.NUWAX_SAVED_KEY = 'env-key';
    process.env.NUWAX_AGENT_PORT = 'notanumber';

    const readQuickInitConfig = await loadReader();
    const config = readQuickInitConfig();

    expect(config!.agentPort).toBe(60006); // fallback to default
  });

  // ==================== 优先级: JSON > env > default ====================

  it('should prefer JSON fields over env vars', async () => {
    const json = {
      quickInit: {
        serverHost: 'https://json.nuwax.com',
        savedKey: 'json-key',
        agentPort: 8001,
      },
    };
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(JSON.stringify(json));
    process.env.NUWAX_SERVER_HOST = 'https://env.nuwax.com';
    process.env.NUWAX_SAVED_KEY = 'env-key';
    process.env.NUWAX_AGENT_PORT = '9999';

    const readQuickInitConfig = await loadReader();
    const config = readQuickInitConfig();

    expect(config!.serverHost).toBe('https://json.nuwax.com');
    expect(config!.savedKey).toBe('json-key');
    expect(config!.agentPort).toBe(8001);
  });

  it('should fill missing JSON fields from env vars', async () => {
    const json = {
      quickInit: {
        serverHost: 'https://json.nuwax.com',
        savedKey: 'json-key',
        // agentPort missing — should come from env
        // workspaceDir missing — should come from env
      },
    };
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(JSON.stringify(json));
    process.env.NUWAX_AGENT_PORT = '7777';
    process.env.NUWAX_WORKSPACE_DIR = '/env/ws';
    process.env.NUWAX_USER_NAME = 'envuser';

    const readQuickInitConfig = await loadReader();
    const config = readQuickInitConfig();

    expect(config!.serverHost).toBe('https://json.nuwax.com');
    expect(config!.agentPort).toBe(7777);
    expect(config!.workspaceDir).toBe('/env/ws');
    expect(config!.username).toBe('envuser');
  });

  it('should use defaults when neither JSON nor env provides optional fields', async () => {
    const json = {
      quickInit: {
        serverHost: 'https://json.nuwax.com',
        savedKey: 'json-key',
      },
    };
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(JSON.stringify(json));

    const readQuickInitConfig = await loadReader();
    const config = readQuickInitConfig();

    expect(config!.agentPort).toBe(60006);
    expect(config!.fileServerPort).toBe(60005);
    expect(config!.workspaceDir).toBe(path.join('/mock/home', '.nuwaclaw', 'workspace'));
    expect(config!.username).toBe('');
  });

  // ==================== enabled: false 阻断环境变量 ====================

  it('should NOT fall through to env vars when JSON has enabled: false', async () => {
    const json = {
      quickInit: {
        enabled: false,
        serverHost: 'https://json.nuwax.com',
        savedKey: 'json-key',
      },
    };
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(JSON.stringify(json));
    process.env.NUWAX_SERVER_HOST = 'https://env.nuwax.com';
    process.env.NUWAX_SAVED_KEY = 'env-key';

    const readQuickInitConfig = await loadReader();
    expect(readQuickInitConfig()).toBeNull();
  });

  // ==================== 缓存 ====================

  it('should cache result and return same value on second call', async () => {
    process.env.NUWAX_SERVER_HOST = 'https://env.nuwax.com';
    process.env.NUWAX_SAVED_KEY = 'env-key';

    const readQuickInitConfig = await loadReader();
    const first = readQuickInitConfig();
    const second = readQuickInitConfig();

    expect(first).toBe(second); // same reference
    // fs should not be called (no JSON file)
    expect(mockExistsSync).toHaveBeenCalledTimes(1);
  });

  it('should cache null result', async () => {
    const readQuickInitConfig = await loadReader();
    const first = readQuickInitConfig();
    const second = readQuickInitConfig();

    expect(first).toBeNull();
    expect(second).toBeNull();
    expect(mockExistsSync).toHaveBeenCalledTimes(1);
  });
});
