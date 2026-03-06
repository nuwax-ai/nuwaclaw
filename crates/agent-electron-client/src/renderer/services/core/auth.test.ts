/**
 * 单元测试: auth (快捷登录 / savedKey 认证)
 *
 * 覆盖场景:
 * - savedKey 认证下 username/password 为空的登录判断
 * - syncConfigToServer / reRegisterClient 的 guard 条件
 * - logout 后用账号密码重新登录
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ==================== Mocks ====================

// In-memory settings store (模拟 SQLite)
let store: Record<string, unknown> = {};

const mockSettingsGet = vi.fn(async (key: string) => store[key] ?? null);
const mockSettingsSet = vi.fn(async (key: string, value: unknown) => {
  if (value === null || value === undefined) {
    delete store[key];
  } else {
    store[key] = value;
  }
});

// Mock window.electronAPI
vi.stubGlobal('window', {
  electronAPI: {
    settings: {
      get: mockSettingsGet,
      set: mockSettingsSet,
    },
  },
});

// Mock antd message
vi.mock('antd', () => ({
  message: {
    loading: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}));

// Mock registerClient API
const mockRegisterClient = vi.fn();
vi.mock('./api', () => ({
  registerClient: (...args: unknown[]) => mockRegisterClient(...args),
}));

// ==================== Helpers ====================

const DOMAIN = 'https://testagent.xspaceagi.com';
const SAVED_KEY = 'test-saved-key-abc123';
const CONFIG_KEY_FROM_SERVER = 'server-returned-config-key';

function makeRegisterResponse(overrides?: Partial<Record<string, unknown>>) {
  return {
    id: 1,
    scope: 'default',
    userId: 1,
    name: 'TestUser',
    configKey: CONFIG_KEY_FROM_SERVER,
    configValue: {},
    description: '',
    isActive: true,
    online: true,
    created: '',
    modified: '',
    serverHost: 'proxy.example.com',
    serverPort: 4900,
    ...overrides,
  };
}

// ==================== Tests ====================

describe('auth - savedKey 认证 (快捷登录)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    store = {};
    mockRegisterClient.mockResolvedValue(makeRegisterResponse());
  });

  // 每次需要 fresh module（避免内部状态缓存）
  async function loadAuth() {
    vi.resetModules();
    return import('./auth');
  }

  // ---------- isLoggedIn ----------

  describe('isLoggedIn', () => {
    it('应以 configKey 为准，不依赖 username', async () => {
      store['auth.config_key'] = 'some-config-key';
      // username 不存在
      const { isLoggedIn } = await loadAuth();
      expect(await isLoggedIn()).toBe(true);
    });

    it('configKey 为空时应返回 false', async () => {
      store['auth.username'] = 'user1';
      // configKey 不存在
      const { isLoggedIn } = await loadAuth();
      expect(await isLoggedIn()).toBe(false);
    });

    it('username 为空字符串 + configKey 存在 → 已登录', async () => {
      store['auth.username'] = '';
      store['auth.config_key'] = 'key';
      const { isLoggedIn } = await loadAuth();
      expect(await isLoggedIn()).toBe(true);
    });
  });

  // ---------- getCurrentAuth ----------

  describe('getCurrentAuth', () => {
    it('应以 configKey 判断 isLoggedIn，与 username 无关', async () => {
      store['auth.config_key'] = 'key';
      store['auth.user_info'] = { username: '', displayName: 'Bot' };
      const { getCurrentAuth } = await loadAuth();
      const auth = await getCurrentAuth();
      expect(auth.isLoggedIn).toBe(true);
      expect(auth.username).toBeNull(); // username key 未设置
    });
  });

  // ---------- syncConfigToServer ----------

  describe('syncConfigToServer', () => {
    it('username 和 password 均为空字符串 + 无 savedKey → 应拒绝（P1-5 修复验证）', async () => {
      // 修复前：空字符串不等于 null，会绕过 guard 向后端发空凭证请求
      // 修复后：!'' === true，正确拦截
      store['auth.username'] = '';
      store['auth.password'] = '';
      // 不设置 savedKey
      store['step1_config'] = { serverHost: DOMAIN };

      const { syncConfigToServer } = await loadAuth();
      const result = await syncConfigToServer({ suppressToast: true });

      expect(result).toBeNull();
      expect(mockRegisterClient).not.toHaveBeenCalled();
    });

    it('username/password 为空字符串 + 有 savedKey → 应正常同步', async () => {
      store['auth.username'] = '';
      store['auth.password'] = '';
      store['auth.saved_key'] = SAVED_KEY;
      store['step1_config'] = { serverHost: DOMAIN };

      const { syncConfigToServer } = await loadAuth();
      const result = await syncConfigToServer({ suppressToast: true });

      expect(result).not.toBeNull();
      expect(result!.configKey).toBe(CONFIG_KEY_FROM_SERVER);
      expect(mockRegisterClient).toHaveBeenCalledTimes(1);

      // 验证请求参数
      const [params] = mockRegisterClient.mock.calls[0];
      expect(params.username).toBe('');
      expect(params.password).toBe('');
      expect(params.savedKey).toBe(SAVED_KEY);
    });

    it('username/password 为 null + 有 savedKey → 应正常同步', async () => {
      // username/password 未设置（null）
      store['auth.saved_key'] = SAVED_KEY;
      store['step1_config'] = { serverHost: DOMAIN };

      const { syncConfigToServer } = await loadAuth();
      const result = await syncConfigToServer({ suppressToast: true });

      expect(result).not.toBeNull();
      const [params] = mockRegisterClient.mock.calls[0];
      expect(params.username).toBe('');
      expect(params.password).toBe('');
      expect(params.savedKey).toBe(SAVED_KEY);
    });

    it('无 username/password/savedKey → 应拒绝', async () => {
      store['step1_config'] = { serverHost: DOMAIN };

      const { syncConfigToServer } = await loadAuth();
      const result = await syncConfigToServer({ suppressToast: true });

      expect(result).toBeNull();
      expect(mockRegisterClient).not.toHaveBeenCalled();
    });

    it('有正常 username/password + 无 savedKey → 应正常同步', async () => {
      store['auth.username'] = 'user1';
      store['auth.password'] = 'pass1';
      store['step1_config'] = { serverHost: DOMAIN };

      const { syncConfigToServer } = await loadAuth();
      const result = await syncConfigToServer({ suppressToast: true });

      expect(result).not.toBeNull();
      const [params] = mockRegisterClient.mock.calls[0];
      expect(params.username).toBe('user1');
      expect(params.password).toBe('pass1');
      expect(params.savedKey).toBeUndefined();
    });
  });

  // ---------- reRegisterClient ----------

  describe('reRegisterClient', () => {
    it('username/password 为 null + 有 savedKey → 应正常重注册', async () => {
      store['auth.saved_key'] = SAVED_KEY;

      const { reRegisterClient } = await loadAuth();
      const result = await reRegisterClient();

      expect(result).not.toBeNull();
      expect(mockRegisterClient).toHaveBeenCalledTimes(1);
    });

    it('无任何凭证 → 应拒绝', async () => {
      const { reRegisterClient } = await loadAuth();
      const result = await reRegisterClient();

      expect(result).toBeNull();
      expect(mockRegisterClient).not.toHaveBeenCalled();
    });

    it('有 domain+username → 应使用域名级 savedKey，而非全局 key（P0-1 修复验证）', async () => {
      // 域名级 key 与全局 key 故意不同，验证使用的是域名级
      store['auth.username'] = 'user1';
      store['lanproxy.server_host'] = DOMAIN; // AUTH_KEYS.LANPROXY_SERVER_HOST
      store['auth.saved_keys.testagent.xspaceagi.com_user1'] = 'domain-specific-key';
      store['auth.saved_key'] = 'global-key-different';

      const { reRegisterClient } = await loadAuth();
      await reRegisterClient();

      const [params] = mockRegisterClient.mock.calls[0];
      // 应使用域名级 savedKey，不应使用全局 key
      expect(params.savedKey).toBe('domain-specific-key');
    });

    it('多账号切换：当前用户无专属 savedKey 时，不应使用全局 key 中其他账号的凭证（P0-1 修复验证）', async () => {
      // 模拟用户A之前登录，全局 key 被覆盖为 A 的凭证
      store['auth.saved_keys.testagent.xspaceagi.com_userA'] = 'key-for-userA';
      store['auth.saved_key'] = 'key-for-userA'; // 全局 key 指向 A

      // 当前切换为用户B（没有域名级专属 key）
      store['auth.username'] = 'userB';
      store['lanproxy.server_host'] = DOMAIN; // AUTH_KEYS.LANPROXY_SERVER_HOST
      // 不设置 auth.saved_keys.*.userB

      const { reRegisterClient } = await loadAuth();
      await reRegisterClient();

      const [params] = mockRegisterClient.mock.calls[0];
      // 用户B无专属 key，savedKey 应为 undefined，不应传入用户A的 key
      expect(params.savedKey).toBeUndefined();
    });

    it('无 domain 信息时 → 应回退到全局 savedKey', async () => {
      // 没有 domain 配置，只有全局 key
      store['auth.username'] = 'user1';
      // 不设置 lanproxy_server_host 和 step1_config
      store['auth.saved_key'] = SAVED_KEY;

      const { reRegisterClient } = await loadAuth();
      const result = await reRegisterClient();

      expect(result).not.toBeNull();
      const [params] = mockRegisterClient.mock.calls[0];
      // 无 domain 时 fallback 到全局 key
      expect(params.savedKey).toBe(SAVED_KEY);
    });
  });

  // ---------- loginAndRegister ----------

  describe('loginAndRegister', () => {
    it('空 username + 空 password + savedKey → 应正常登录', async () => {
      store['auth.saved_key'] = SAVED_KEY;
      store['step1_config'] = { serverHost: DOMAIN };

      const { loginAndRegister } = await loadAuth();
      const result = await loginAndRegister('', '', {
        suppressToast: true,
        domain: DOMAIN,
      });

      expect(result.configKey).toBe(CONFIG_KEY_FROM_SERVER);

      // 验证登录后存储了 configKey
      expect(store['auth.config_key']).toBe(CONFIG_KEY_FROM_SERVER);
      // savedKey 更新为服务端返回的 configKey
      expect(store['auth.saved_key']).toBe(CONFIG_KEY_FROM_SERVER);
    });

    it('正常 username + password → 应正常登录', async () => {
      store['step1_config'] = { serverHost: DOMAIN };

      const { loginAndRegister } = await loadAuth();
      const result = await loginAndRegister('zhangsan', 'abc123', {
        suppressToast: true,
        domain: DOMAIN,
      });

      expect(result.configKey).toBe(CONFIG_KEY_FROM_SERVER);
      expect(store['auth.username']).toBe('zhangsan');
      expect(store['auth.password']).toBe('abc123');
    });
  });

  // ---------- 完整场景: 快捷登录 → 退出 → 重新登录 ----------

  describe('完整流程: 快捷登录 → logout → 账号密码登录', () => {
    it('退出后用账号密码重新登录应成功', async () => {
      const auth = await loadAuth();

      // 1. 快捷登录（模拟 QuickInit: 空 username + savedKey）
      store['auth.saved_key'] = SAVED_KEY;
      store['step1_config'] = { serverHost: DOMAIN };

      await auth.loginAndRegister('', '', {
        suppressToast: true,
        domain: DOMAIN,
      });
      expect(await auth.isLoggedIn()).toBe(true);

      // 2. 退出登录
      await auth.logout();
      expect(await auth.isLoggedIn()).toBe(false);
      // savedKey 应保留
      expect(store['auth.saved_key']).toBe(CONFIG_KEY_FROM_SERVER);
      // configKey 应清除
      expect(store['auth.config_key']).toBeUndefined();

      // 3. 用新账号密码登录
      const newConfigKey = 'new-config-key-for-zhangsan';
      mockRegisterClient.mockResolvedValueOnce(
        makeRegisterResponse({ configKey: newConfigKey }),
      );

      await auth.loginAndRegister('zhangsan', 'dynamic-code', {
        suppressToast: true,
        domain: DOMAIN,
      });

      expect(await auth.isLoggedIn()).toBe(true);
      expect(store['auth.username']).toBe('zhangsan');
      expect(store['auth.config_key']).toBe(newConfigKey);
      // 域名级 savedKey 应保存
      expect(store['auth.saved_keys.testagent.xspaceagi.com_zhangsan']).toBe(newConfigKey);

      // 4. syncConfigToServer 应能正常工作
      mockRegisterClient.mockResolvedValueOnce(
        makeRegisterResponse({ configKey: newConfigKey }),
      );
      const syncResult = await auth.syncConfigToServer({ suppressToast: true });
      expect(syncResult).not.toBeNull();
    });
  });
});
