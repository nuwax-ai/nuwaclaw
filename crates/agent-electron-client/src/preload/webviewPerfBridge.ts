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

/**
 * auth 命名空间：nuwax webview ↔ nuwaclaw 壳的 ACCESS_TOKEN 双向同步。
 * nuwax 用 localStorage.ACCESS_TOKEN 鉴权（Authorization header），非 cookie；
 * token 由主进程按 webview 来源 origin 持久化到 settings 表，跨重启复用。
 * 后端见 main/ipc/nuwaxBridgeHandlers.ts。
 */
const auth = {
  /** 读取本 origin 持久化的 nuwax ACCESS_TOKEN（重启免登）。 */
  getToken(): Promise<string | null> {
    return ipcRenderer.invoke("auth:getToken");
  },
  /** nuwax 登录成功后持久化 token（写入 settings 表）。 */
  persistToken(token: string): Promise<boolean> {
    return ipcRenderer.invoke("auth:persistToken", token);
  },
  /** nuwax 登出联动：清除本 origin 的持久化 token。 */
  clear(): Promise<boolean> {
    return ipcRenderer.invoke("auth:clear");
  },
};

/**
 * native 命名空间：宿主原生能力。浏览器端不存在此桥，nuwax 自行降级。
 */
const native = {
  /** 右键另存图片：调用系统保存对话框并下载。 */
  saveImage(
    url: string,
    filename?: string,
  ): Promise<{ success: boolean; path?: string; error?: string }> {
    return ipcRenderer.invoke("native:saveImage", { url, filename });
  },
  /**
   * 新开独立窗口打开 nuwax 页面（智能体详情/工作流/我的电脑等全屏页）。
   * 新窗口带系统标题栏（无沉浸式工具栏浮层，页面零遮挡），注入同一 webview
   * 桥 preload（isNuwaClaw/主题/避让等桥能力一致）。path 为 nuwax 站内相对路径。
   */
  openWindow(path: string): Promise<{ success: boolean; error?: string }> {
    return ipcRenderer.invoke("native:openWindow", { path });
  },
};

/**
 * events 命名空间：宿主→nuwax 入站命令通道。
 * nuwaclaw 工具栏等通过 <webview>.send('nuwax:host-command', payload) 下发，
 * 此处 ipcRenderer.on 接收并转发给 nuwax 注册的回调（contextBridge 保证回调在 guest
 * 上下文执行，从而能操作 nuwax 的 React/model 状态）。payload 协议见 nuwax 侧
 * global.d.ts 的 HostCommand。
 */
let hostCommandHandler: ((payload: unknown) => void) | null = null;
ipcRenderer.on("nuwax:host-command", (_e, payload: unknown) => {
  hostCommandHandler?.(payload);
});
const events = {
  /** 注册/注销宿主命令回调（传 null 注销）。 */
  onHostCommand(cb: ((payload: unknown) => void) | null): void {
    hostCommandHandler = cb;
  },
};

/**
 * theme 命名空间：nuwax → 壳的主题同步（guest→host）。
 * 女娲主题生效/让位时 nuwax 推送 { active, 调色板 }，主进程转发给壳 renderer
 * （nuwax:theme-changed），壳给自己的 antd tokens / CSS 变量叠加同套米白调色板，
 * 实现原生 UI（设置弹窗等）与 nuwax 统一。fire-and-forget，不等待结果。
 */
const theme = {
  /** 推送主题状态给壳。 */
  syncTheme(payload: Record<string, unknown>): void {
    ipcRenderer.send("nuwax:theme-sync", payload);
  },
};

/**
 * layout 命名空间：nuwax → 壳的布局状态同步（guest→host）。
 * 如「当前页是否存在可收起的二级菜单」→ 主进程转发（nuwax:layout-changed）给壳
 * renderer，工具栏据此显隐收起按钮。fire-and-forget。
 */
const layout = {
  /** 告知壳当前页是否有二级菜单可收起。 */
  setSecondMenuAvailable(available: boolean): void {
    ipcRenderer.send("nuwax:layout-sync", { secondMenuAvailable: !!available });
  },
  /** 同步二级菜单真实收起态（壳工具栏 icon 以此为准，修 reload 后失同步）。 */
  setSecondMenuCollapsed(collapsed: boolean): void {
    ipcRenderer.send("nuwax:layout-sync", { secondMenuCollapsed: !!collapsed });
  },
};

contextBridge.exposeInMainWorld("NuwaClawBridge", {
  perf,
  auth,
  native,
  events,
  theme,
  layout,
});
