import { contextBridge, ipcRenderer } from "electron";

type PerfPayload = Record<string, unknown>;

const CHAT_ROUTE_RE = /^\/home\/chat\/\d+\/\d+$/;
const CHAT_ROOT_SELECTOR = '[data-nuwaclaw-perf-scope="chat-root"]';

function resolveRoutePath(): string {
  const pathname = window.location.pathname || "";
  if (CHAT_ROUTE_RE.test(pathname)) {
    return pathname;
  }

  // 兼容 hash 路由写法：/#/home/chat/:id/:agentId
  const hash = window.location.hash || "";
  const hashPath = hash.startsWith("#") ? hash.slice(1) : hash;
  return hashPath || pathname;
}

function isChatScopeEnabled(): boolean {
  const routePath = resolveRoutePath();
  if (!CHAT_ROUTE_RE.test(routePath)) {
    return false;
  }
  return Boolean(document.querySelector(CHAT_ROOT_SELECTOR));
}

function safeStringify(data: unknown): string {
  try {
    return JSON.stringify(data ?? {});
  } catch {
    return "{}";
  }
}

/**
 * onceKeySet 用于 markOnce 去重，确保同一 key 只触发一次日志。
 * 清理策略：
 * - 当集合大小超过 ONCE_KEY_MAX_SIZE 时，直接清空（简单粗暴但有效）。
 * - 对于单个消息的生命周期，在 stream_end 时调用 cleanupMessageOnceKeys
 *   清理该消息相关的 key，允许同一条消息在重新加载后再次触发 markOnce。
 *
 * 设计说明：
 * markOnce 的 key 格式为 `${mid}:first_chunk` 和 `${mid}:stream_end`。
 * 当消息流结束时，我们清理这些 key，这样如果用户刷新页面或重新进入同一会话，
 * 该消息的性能日志可以重新记录一次（而不是被 markOnce 永久跳过）。
 */
const onceKeySet = new Set<string>();
const ONCE_KEY_MAX_SIZE = 5000;

function maybeCompactOnceKeys(): void {
  if (onceKeySet.size <= ONCE_KEY_MAX_SIZE) return;
  // 简单上限保护：超过阈值时清空，避免长期运行导致集合无限增长。
  onceKeySet.clear();
}

/**
 * 清理指定消息的 once keys，允许该消息在下次加载时重新记录性能日志。
 * 仅在 stream_end 阶段调用（见 markOnce 内部）。
 */
function cleanupMessageOnceKeys(payload: PerfPayload): void {
  const mid = payload.mid;
  if (typeof mid !== "string" || !mid) return;
  onceKeySet.delete(`${mid}:first_chunk`);
  onceKeySet.delete(`${mid}:stream_end`);
}

const perf = {
  enabled(): boolean {
    return isChatScopeEnabled();
  },

  mark(stage: string, payload: PerfPayload = {}): void {
    if (!this.enabled()) return;
    const nowTs = Date.now();
    const routePath = resolveRoutePath();
    const msg = `[PERF][FE] stage=${stage} route=${routePath} ts=${nowTs} extra=${safeStringify(payload)}`;
    ipcRenderer.send("perf:log", msg);
  },

  markOnce(key: string, stage: string, payload: PerfPayload = {}): void {
    if (onceKeySet.has(key)) return;
    onceKeySet.add(key);
    maybeCompactOnceKeys();
    this.mark(stage, payload);
    if (stage === "stream_end") {
      cleanupMessageOnceKeys(payload);
    }
  },
};

contextBridge.exposeInMainWorld("NuwaClawBridge", {
  perf,
});
