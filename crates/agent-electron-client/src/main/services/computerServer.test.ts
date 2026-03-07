/**
 * 单元测试: ComputerServer — SSE 事件缓冲（ACP 引擎性能优化）
 *
 * 覆盖内容：
 * - pushSseEvent 在无客户端时写入缓冲
 * - 缓冲条数上限 SSE_EVENT_BUFFER_MAX
 * - getSseEventBufferSize 查询
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  pushSseEvent,
  getSseEventBufferSize,
  clearSseEventBuffer,
  clearAllSseEventBuffers,
} from './computerServer';

// 避免拉起 unifiedAgent 与 Electron 等重模块
vi.mock('./engines/unifiedAgent', () => ({
  agentService: {
    isReady: true,
    getEngineType: () => 'nuwaxcode',
    getAgentConfig: () => ({ workspaceDir: '/tmp' }),
    getAcpEngine: () => null,
    hasRunningEngines: false,
    getEngineForProject: () => null,
  },
}));
vi.mock('electron-log', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));
vi.mock('./constants', () => ({ LOCALHOST_HOSTNAME: '127.0.0.1' }));
vi.mock('./startupPorts', () => ({ getConfiguredPorts: () => ({ fileServer: 0 }) }));
vi.mock('./utils/logRedact', () => ({
  redactForLog: (x: unknown) => x,
  redactStringForLog: (s: string) => s,
}));

describe('ComputerServer — SSE 事件缓冲', () => {
  const sessionId = 'ses-test-buffer-001';

  beforeEach(() => {
    vi.clearAllMocks();
    // 清空该 session 的缓冲（通过多次 push 触发内部逻辑会累积，这里依赖模块状态）
    // 注意：pushSseEvent 依赖 computerServer 模块内的 sseClients/sseEventBuffers
    // 无客户端时会写入 buffer；测试间若复用 sessionId 会累积，故用唯一 sessionId 或单测内只测一次
  });

  it('getSseEventBufferSize 在无缓冲时返回 0', () => {
    expect(getSseEventBufferSize('nonexistent-session')).toBe(0);
  });

  it('无客户端时 pushSseEvent 将事件写入缓冲', () => {
    pushSseEvent(sessionId, 'prompt_start', { sessionId, messageType: 'promptStart' });
    expect(getSseEventBufferSize(sessionId)).toBe(1);
    pushSseEvent(sessionId, 'message_part', { type: 'text', text: 'hi' });
    expect(getSseEventBufferSize(sessionId)).toBe(2);
  });

  it('缓冲最多保留 SSE_EVENT_BUFFER_MAX 条', () => {
    const SSE_EVENT_BUFFER_MAX = 50;
    for (let i = 0; i < SSE_EVENT_BUFFER_MAX + 10; i++) {
      pushSseEvent(sessionId, 'ev', { i });
    }
    expect(getSseEventBufferSize(sessionId)).toBe(SSE_EVENT_BUFFER_MAX);
  });

  it('TTL 过期后同 session 再次 push 会 prune 掉旧 buffer 并新建', () => {
    const ttlSessionId = 'ses-ttl-only';
    vi.useFakeTimers({ now: 0 });
    pushSseEvent(ttlSessionId, 'ev1', {});
    expect(getSseEventBufferSize(ttlSessionId)).toBe(1);
    vi.advanceTimersByTime(31000); // 超过 30s TTL
    pushSseEvent(ttlSessionId, 'ev2', {});
    // 旧 buffer 被 prune，当前 push 写入新 buffer，应只有 1 条
    expect(getSseEventBufferSize(ttlSessionId)).toBe(1);
    vi.useRealTimers();
  });

  it('clearSseEventBuffer 清除指定 session 的缓冲', () => {
    const ses1 = 'ses-clear-001';
    const ses2 = 'ses-clear-002';
    pushSseEvent(ses1, 'ev', { data: 1 });
    pushSseEvent(ses1, 'ev', { data: 2 });
    pushSseEvent(ses2, 'ev', { data: 3 });
    expect(getSseEventBufferSize(ses1)).toBe(2);
    expect(getSseEventBufferSize(ses2)).toBe(1);

    clearSseEventBuffer(ses1);
    expect(getSseEventBufferSize(ses1)).toBe(0);
    expect(getSseEventBufferSize(ses2)).toBe(1); // ses2 不受影响
  });

  it('clearSseEventBuffer 对不存在的 session 是幂等的', () => {
    expect(() => clearSseEventBuffer('nonexistent')).not.toThrow();
    expect(getSseEventBufferSize('nonexistent')).toBe(0);
  });

  it('clearSseEventBuffer 传入空字符串/null/undefined 不报错', () => {
    expect(() => clearSseEventBuffer('')).not.toThrow();
    expect(() => clearSseEventBuffer(null as any)).not.toThrow();
    expect(() => clearSseEventBuffer(undefined as any)).not.toThrow();
  });

  it('clearAllSseEventBuffers 清除所有 session 的缓冲', () => {
    const ses1 = 'ses-clearall-001';
    const ses2 = 'ses-clearall-002';
    const ses3 = 'ses-clearall-003';
    pushSseEvent(ses1, 'ev', {});
    pushSseEvent(ses2, 'ev', {});
    pushSseEvent(ses3, 'ev', {});
    expect(getSseEventBufferSize(ses1)).toBe(1);
    expect(getSseEventBufferSize(ses2)).toBe(1);
    expect(getSseEventBufferSize(ses3)).toBe(1);

    clearAllSseEventBuffers();
    expect(getSseEventBufferSize(ses1)).toBe(0);
    expect(getSseEventBufferSize(ses2)).toBe(0);
    expect(getSseEventBufferSize(ses3)).toBe(0);
  });

  it('clearAllSseEventBuffers 对空缓冲也是幂等的', () => {
    clearAllSseEventBuffers(); // 清空
    expect(() => clearAllSseEventBuffers()).not.toThrow(); // 再次清空
  });
});
