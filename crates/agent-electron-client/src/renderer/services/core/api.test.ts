/**
 * 单元测试: api (请求封装)
 *
 * 覆盖场景:
 * - fetch 超时：AbortSignal.timeout 触发后抛出可读错误（P0-3 修复验证）
 * - 正常请求：成功返回 data
 * - HTTP 错误：非 2xx 响应正确抛出
 * - API 业务错误码：非 0000 code 正确抛出
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ==================== Mocks ====================

// Mock antd message（避免 DOM 依赖）
vi.mock('antd', () => ({
  message: {
    error: vi.fn(),
    success: vi.fn(),
    loading: vi.fn(),
    info: vi.fn(),
  },
}));

// Mock @shared/constants
vi.mock('@shared/constants', () => ({
  DEFAULT_SERVER_HOST: 'https://default.example.com',
  DEFAULT_API_TIMEOUT: 30000,
}));

// ==================== Helpers ====================

/** 构造一个标准成功响应 */
function makeSuccessResponse<T>(data: T): Response {
  return new Response(
    JSON.stringify({ code: '0000', message: 'ok', success: true, data }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}

/** 构造一个业务错误响应（HTTP 200 但 code != 0000） */
function makeApiErrorResponse(code: string, msg: string): Response {
  return new Response(
    JSON.stringify({ code, message: msg, success: false, data: null }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}

// 每次需要 fresh module（避免 vi.mock 缓存影响）
async function loadApi() {
  vi.resetModules();
  return import('./api');
}

// ==================== Tests ====================

describe('apiRequest', () => {
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
    vi.clearAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  // ---------- 正常请求 ----------

  it('请求成功时应返回 data 字段', async () => {
    global.fetch = vi.fn().mockResolvedValue(makeSuccessResponse({ id: 1, name: 'test' }));

    const { apiRequest } = await loadApi();
    const result = await apiRequest<{ id: number; name: string }>('/test', {
      method: 'POST',
      showError: false,
    });

    expect(result).toEqual({ id: 1, name: 'test' });
  });

  it('应将 AbortSignal.timeout 传入 fetch（P0-3 修复验证）', async () => {
    global.fetch = vi.fn().mockResolvedValue(makeSuccessResponse({}));

    const { apiRequest } = await loadApi();
    await apiRequest('/test', { showError: false });

    const [, fetchOptions] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    // 验证 signal 字段存在（AbortSignal.timeout 已挂载）
    expect(fetchOptions.signal).toBeDefined();
    expect(fetchOptions.signal).toBeInstanceOf(AbortSignal);
  });

  // ---------- 超时处理（P0-3）----------

  it('fetch 超时（TimeoutError）→ 应抛出包含"请求超时"的错误，不暴露原始 AbortError（P0-3 修复验证）', async () => {
    // 模拟 AbortSignal.timeout 触发后 fetch 抛出 TimeoutError
    const timeoutError = Object.assign(new Error('The operation timed out.'), {
      name: 'TimeoutError',
    });
    global.fetch = vi.fn().mockRejectedValue(timeoutError);

    const { apiRequest } = await loadApi();

    await expect(
      apiRequest('/test', { showError: false }),
    ).rejects.toThrow(/请求超时/);
  });

  it('fetch AbortError → 同样转为可读超时错误（P0-3 修复验证）', async () => {
    const abortError = Object.assign(new Error('The user aborted a request.'), {
      name: 'AbortError',
    });
    global.fetch = vi.fn().mockRejectedValue(abortError);

    const { apiRequest } = await loadApi();

    await expect(
      apiRequest('/test', { showError: false }),
    ).rejects.toThrow(/请求超时/);
  });

  it('超时时 showError=false 不弹 toast', async () => {
    const { message } = await import('antd');
    const timeoutError = Object.assign(new Error('timeout'), { name: 'TimeoutError' });
    global.fetch = vi.fn().mockRejectedValue(timeoutError);

    const { apiRequest } = await loadApi();
    await expect(apiRequest('/test', { showError: false })).rejects.toThrow();

    expect(message.error).not.toHaveBeenCalled();
  });

  // ---------- HTTP 错误 ----------

  it('HTTP 非 2xx → 应抛出 HTTP 错误', async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response('Internal Server Error', { status: 500, statusText: 'Internal Server Error' }),
    );

    const { apiRequest } = await loadApi();

    await expect(
      apiRequest('/test', { showError: false }),
    ).rejects.toThrow('HTTP 500');
  });

  // ---------- 业务错误码 ----------

  it('业务错误码非 0000 → 应抛出业务错误', async () => {
    global.fetch = vi.fn().mockResolvedValue(
      makeApiErrorResponse('4010', '用户未登录，请重新登录'),
    );

    const { apiRequest } = await loadApi();

    await expect(
      apiRequest('/test', { showError: false }),
    ).rejects.toThrow('用户未登录，请重新登录');
  });

  // ---------- registerClient ----------

  it('registerClient 应正确透传参数并返回响应', async () => {
    const mockData = {
      id: 1, scope: 'default', userId: 1, name: 'Bot',
      configKey: 'ck-abc', configValue: {}, description: '',
      isActive: true, online: true, created: '', modified: '',
    };
    global.fetch = vi.fn().mockResolvedValue(makeSuccessResponse(mockData));

    const { registerClient } = await loadApi();
    const result = await registerClient(
      {
        username: 'user1',
        password: 'pass1',
        sandboxConfigValue: { agentPort: 4000, vncPort: 0, fileServerPort: 60000 },
      },
      { suppressToast: true },
    );

    expect(result.configKey).toBe('ck-abc');

    // 验证请求 body 包含正确参数
    const [, fetchOptions] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    const body = JSON.parse(fetchOptions.body);
    expect(body.username).toBe('user1');
    expect(body.password).toBe('pass1');
  });
});
