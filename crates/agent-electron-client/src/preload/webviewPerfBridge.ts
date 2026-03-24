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

const onceKeySet = new Set<string>();
const ONCE_KEY_MAX_SIZE = 5000;

function maybeCompactOnceKeys(): void {
  if (onceKeySet.size <= ONCE_KEY_MAX_SIZE) return;
  // 简单上限保护：超过阈值时清空，避免长期运行导致集合无限增长。
  onceKeySet.clear();
}

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
