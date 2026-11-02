// @nuwax-ai/agent-kit — sensitive-access classifier framework + allow_always cache.
//
// Hosts register product-specific classifiers (nuwa-cli: session-history access;
// nuwaclaw: its own). A classifier hit forces human approval even under yolo.
// The framework + cache are shared; concrete classifiers stay in each host.

import type { RequestPermissionRequest } from "@agentclientprotocol/sdk";

/**
 * 可插拔敏感分类器：命中后由宿主协调器强制 ask（yolo 也不能跳过）。
 * 新增护栏只需实现本接口并注册，不必改 SSE / notify-resolved 协议。
 */
export interface SensitiveClassifier {
  /** 稳定 id，用于日志与 allow_always 缓存键。 */
  readonly id: string;
  /** 是否把该 ACP permission 请求视为敏感访问。 */
  match(request: RequestPermissionRequest): boolean;
}

/** 从 toolCall.rawInput 里尽量抽出命令行字符串（bash / execute 常见字段）。 */
export function extractCommandFromRawInput(rawInput: unknown): string | null {
  if (typeof rawInput === "string") {
    const trimmed = rawInput.trim();
    return trimmed || null;
  }
  if (!rawInput || typeof rawInput !== "object" || Array.isArray(rawInput)) {
    return null;
  }
  const record = rawInput as Record<string, unknown>;
  for (const key of ["command", "cmd", "script"]) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

/** 把 rawInput / locations / title 里可能出现的路径拼成可扫描文本。 */
export function extractPathHaystack(
  request: RequestPermissionRequest,
): string {
  const parts: string[] = [];
  const raw = request.toolCall.rawInput;
  if (typeof raw === "string") {
    parts.push(raw);
  } else if (raw && typeof raw === "object") {
    parts.push(JSON.stringify(raw));
  }
  const locations = request.toolCall.locations;
  if (Array.isArray(locations)) {
    for (const loc of locations) {
      if (loc && typeof loc === "object" && "path" in loc) {
        const p = (loc as { path?: unknown }).path;
        if (typeof p === "string") parts.push(p);
      }
    }
  }
  const title = request.toolCall.title;
  if (typeof title === "string") parts.push(title);
  return parts.join("\n");
}

/** 返回首个命中的分类器（无则 undefined）。 */
export function findMatchingClassifier(
  request: RequestPermissionRequest,
  classifiers: SensitiveClassifier[],
): SensitiveClassifier | undefined {
  return classifiers.find((c) => c.match(request));
}

/**
 * 进程内 allow_always 缓存：用户对某 app session + 分类器选过 allow_always 后，
 * 对该组合放行直至进程结束（或会话清除）。key = `${appSessionId}::${classifierId}`。
 */
export interface AllowAlwaysCache {
  has(appSessionId: string, classifierId: string): boolean;
  add(appSessionId: string, classifierId: string): void;
  clearSession(appSessionId: string): void;
  clearAll(): void;
  readonly size: number;
}

export function createAllowAlwaysCache(): AllowAlwaysCache {
  const allowed = new Set<string>();
  return {
    has: (appSessionId, classifierId) =>
      allowed.has(`${appSessionId}::${classifierId}`),
    add: (appSessionId, classifierId) =>
      allowed.add(`${appSessionId}::${classifierId}`),
    clearSession(appSessionId) {
      for (const key of [...allowed]) {
        if (key.startsWith(`${appSessionId}::`)) allowed.delete(key);
      }
    },
    clearAll: () => allowed.clear(),
    get size() {
      return allowed.size;
    },
  };
}
