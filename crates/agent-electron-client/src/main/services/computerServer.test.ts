/**
 * 单元测试: ComputerServer — SSE 事件缓冲（ACP 引擎性能优化）
 *
 * 覆盖内容：
 * - pushSseEvent 在无客户端时写入缓冲
 * - 缓冲条数上限 SSE_EVENT_BUFFER_MAX
 * - getSseEventBufferSize 查询
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { pushSseEvent, getSseEventBufferSize } from './computerServer';

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
});
