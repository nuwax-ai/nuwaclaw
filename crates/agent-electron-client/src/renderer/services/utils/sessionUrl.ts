/**
 * Shared utility for constructing session redirect URLs and syncing cookies.
 * Used by both ClientPage and SessionsPage.
 *
 * Redirect URL patterns:
 *   /api/sandbox/config/redirect/{sandboxConfigId}       - enter sandbox (开始会话)
 *   /api/sandbox/config/redirect/new/{sandboxConfigId}   - create new session (新建会话)
 *   /api/sandbox/config/redirect/chat/{sessionId}        - enter history session (进入历史会话)
 */

import { getCurrentAuth } from "../core/auth";
import { AUTH_KEYS } from "@shared/constants";
import { logger } from "./logService";
import { getDomainTokenKey } from "@shared/utils/domain";

/**
 * 解析 JWT exp 字段，返回 ISO 时间字符串或 null。
 * 仅读取 exp，不验证签名。
 */
function parseJwtExpDate(token: string): string | null {
  try {
    const parts = token.split(".");
    if (parts.length < 2) return null;
    const payload = JSON.parse(
      atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")),
    );
    if (typeof payload.exp === "number") {
      return new Date(payload.exp * 1000).toISOString();
    }
  } catch {
    /* ignore */
  }
  return null;
}

/**
 * Build redirect URL for entering the sandbox dashboard (开始会话).
 */
export function buildRedirectUrl(
  domain: string,
  configId: string | number,
): string {
  const normalizedDomain = domain.replace(/\/+$/, "");
  return `${normalizedDomain}/api/sandbox/config/redirect/${configId}?hideMenu=true`;
}

/**
 * Build redirect URL for creating a new session (新建会话).
 */
export function buildNewSessionUrl(
  domain: string,
  configId: string | number,
): string {
  const normalizedDomain = domain.replace(/\/+$/, "");
  return `${normalizedDomain}/api/sandbox/config/redirect/new/${configId}?hideMenu=true`;
}

/**
 * Build redirect URL for entering a history session (进入历史会话).
 */
export function buildChatSessionUrl(domain: string, sessionId: string): string {
  const normalizedDomain = domain.replace(/\/+$/, "");
  return `${normalizedDomain}/api/sandbox/config/redirect/chat/${sessionId}?hideMenu=true`;
}

export async function syncSessionCookie(
  domain: string,
  token: string,
): Promise<void> {
  // 不设置 domain → host-only cookie，与 webview 内 Set-Cookie 行为一致，
  // 确保 webview 登录后能覆盖 Electron 侧写入的 ticket，避免 count=2 冲突
  // 不设置 secure → 由主进程根据 URL scheme 自动判断（支持 HTTP 场景）
  const payload: {
    url: string;
    name: string;
    value: string;
    httpOnly: boolean;
  } = {
    url: domain,
    name: "ticket",
    value: token,
    httpOnly: true,
  };
  const result = await window.electronAPI?.session.setCookie(payload);
  if (!result?.success) {
    // 只记录域名和错误，不记录 token 等敏感信息
    throw new Error(result?.error || `session:setCookie failed for ${domain}`);
  }

  // 写入后立即回读，便于定位"已写入但页面仍未登录"的问题
  try {
    const verify = await window.electronAPI?.session.getCookie({
      url: domain,
      name: "ticket",
    });
    logger.debug("[SessionUrl] ticket cookie 回读结果", "SessionUrl", {
      domain,
      found: !!verify?.found,
      count: verify?.count ?? 0,
    });
  } catch (error) {
    logger.debug("[SessionUrl] ticket cookie 回读异常", "SessionUrl", {
      domain,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Shared helper: check auth, sync cookie, then call buildUrl to produce the final URL.
 */
async function syncCookieAndBuildUrl<T>(
  buildUrl: (domain: string, configId?: number) => T,
  options?: { requireConfigId?: boolean },
): Promise<T | null> {
  const requireConfigId = options?.requireConfigId ?? true;
  const auth = await getCurrentAuth();
  if (!auth.isLoggedIn) return null;

  const domain = auth.userInfo?.currentDomain;
  const configId = auth.userInfo?.id;
  if (!domain) return null;
  if (requireConfigId && !configId) return null;

  const oneShotToken = (await window.electronAPI?.settings.get(
    AUTH_KEYS.AUTH_TOKEN,
  )) as string | null;
  const domainTokenKey = getDomainTokenKey(domain);
  let tokenSource: "one_shot" | "domain_cache" | "none" = "none";
  let token = oneShotToken;
  if (token) {
    tokenSource = "one_shot";
  } else {
    token = (await window.electronAPI?.settings.get(domainTokenKey)) as
      | string
      | null;
    if (token) tokenSource = "domain_cache";
  }
  logger.debug("[SessionUrl] 会话前状态", "SessionUrl", {
    domain,
    hasToken: !!token,
    tokenSource,
  });
  if (!token) {
    // reg 未返回 token → 不做任何操作（不清空现有 cookie）
    logger.debug(
      "[SessionUrl] 缺少可用 token，跳过 ticket 同步",
      "SessionUrl",
      { domain },
    );
    return buildUrl(domain, configId);
  }

  // 有 token → 无条件覆盖 cookie，不管现有 cookie 是否有效
  try {
    await syncSessionCookie(domain, token);
    // one-shot token 成功后清除，避免反复覆盖 webview 内 ticket
    await window.electronAPI?.settings.set(AUTH_KEYS.AUTH_TOKEN, null);
    logger.debug("[SessionUrl] ticket cookie 同步成功", "SessionUrl", {
      domain,
      tokenSource,
    });
  } catch (error) {
    logger.debug("[SessionUrl] ticket cookie 同步失败", "SessionUrl", {
      domain,
      error: error instanceof Error ? error.message : String(error),
    });
    // 失败时不要清空 token，保留重试机会
    logger.error(
      "[SessionUrl] Cookie 同步失败，保留本地 token 以便重试",
      "SessionUrl",
      {
        domain,
        error: error instanceof Error ? error.message : String(error),
      },
    );
    throw error;
  }

  return buildUrl(domain, configId);
}

/**
 * Sync cookie and return the sandbox redirect URL (开始会话).
 */
export async function syncCookieAndGetRedirectUrl(): Promise<string | null> {
  return syncCookieAndBuildUrl(buildRedirectUrl, { requireConfigId: true });
}

/**
 * Sync cookie and return the new-session redirect URL (新建会话).
 */
export async function syncCookieAndGetNewSessionUrl(): Promise<string | null> {
  return syncCookieAndBuildUrl(buildNewSessionUrl, { requireConfigId: true });
}

/**
 * Sync cookie and return the chat-session redirect URL (进入历史会话).
 */
export async function syncCookieAndGetChatUrl(
  sessionId: string,
): Promise<string | null> {
  return syncCookieAndBuildUrl(
    (domain) => buildChatSessionUrl(domain, sessionId),
    { requireConfigId: false },
  );
}

/**
 * 将 webview 内登录产生的 ticket cookie 刷到磁盘。
 *
 * webview 内 Set-Cookie 产生的 ticket 带有 Max-Age（持久 cookie），
 * 但 Chromium 不保证立即写入磁盘。如果 Electron 在 flush 前退出（开发调试常见），
 * cookie 会丢失。此函数主动调用 flushStore 确保持久化。
 *
 * 应在检测到 webview 登录成功（从 /login 跳转到非 login 页面）时调用。
 */
export async function persistTicketCookie(domain: string): Promise<void> {
  try {
    const result = await window.electronAPI?.session.getCookie({
      url: domain,
      name: "ticket",
    });
    if (!result?.found) {
      logger.debug(
        "[SessionUrl] persistTicketCookie: 无 ticket cookie，跳过",
        "SessionUrl",
        { domain },
      );
      return;
    }

    // 主动刷盘，确保 Chromium 将 cookie 写入磁盘
    await window.electronAPI?.session.flushStore();
    logger.info(
      "[SessionUrl] persistTicketCookie: cookie store 已刷盘",
      "SessionUrl",
      { domain },
    );
  } catch (error) {
    logger.warn("[SessionUrl] persistTicketCookie 失败", "SessionUrl", {
      domain,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
