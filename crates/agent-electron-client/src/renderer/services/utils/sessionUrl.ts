/**
 * Shared utility for constructing session redirect URLs and syncing cookies.
 * Used by both ClientPage and SessionsPage.
 *
 * Redirect URL patterns:
 *   /api/sandbox/config/redirect/{sandboxConfigId}       — enter sandbox (开始会话)
 *   /api/sandbox/config/redirect/new/{sandboxConfigId}   — create new session (新建会话)
 *   /api/sandbox/config/redirect/chat/{sessionId}        — enter history session (进入历史会话)
 */

import { getCurrentAuth } from "../core/auth";
import { AUTH_KEYS } from "@shared/constants";
import { logger } from "./logService";

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
  let cookieDomain: string;
  try {
    cookieDomain = new URL(domain).hostname;
  } catch {
    cookieDomain = domain.replace(/^https?:\/\//, "");
  }
  const result = await window.electronAPI?.session.setCookie({
    url: domain,
    name: "ticket",
    value: token,
    domain: cookieDomain,
    httpOnly: true,
    secure: domain.startsWith("https"),
  });
  if (!result?.success) {
    // 只记录域名和错误，不记录 token 等敏感信息
    throw new Error(result?.error || `session:setCookie failed for ${domain}`);
  }
}

/**
 * Shared helper: check auth, sync cookie, then call buildUrl to produce the final URL.
 */
async function syncCookieAndBuildUrl(
  buildUrl: (domain: string, configId: number) => string,
): Promise<string | null> {
  const auth = await getCurrentAuth();
  if (!auth.isLoggedIn) return null;

  const domain = auth.userInfo?.currentDomain;
  const configId = auth.userInfo?.id;
  if (!domain || !configId) return null;

  const token = (await window.electronAPI?.settings.get(
    AUTH_KEYS.AUTH_TOKEN,
  )) as string | null;
  logger.info("[SessionUrl][Diag] 会话前状态", "SessionUrl", {
    domain,
    configId,
    hasToken: !!token,
  });
  if (token) {
    try {
      logger.info("[SessionUrl][Diag] 准备同步 ticket cookie", "SessionUrl", {
        domain,
      });
      await syncSessionCookie(domain, token);
      logger.info("[SessionUrl][Diag] ticket cookie 同步成功", "SessionUrl", {
        domain,
      });
      // token 已同步给 webview cookie，立即清除本地缓存，
      // 避免 token 失效后被持久缓存再次写入 webview 导致登录异常
      await window.electronAPI?.settings.set(AUTH_KEYS.AUTH_TOKEN, null);
    } catch (error) {
      logger.warn("[SessionUrl][Diag] ticket cookie 同步失败", "SessionUrl", {
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
  }

  return buildUrl(domain, configId);
}

/**
 * Sync cookie and return the sandbox redirect URL (开始会话).
 */
export async function syncCookieAndGetRedirectUrl(): Promise<string | null> {
  return syncCookieAndBuildUrl(buildRedirectUrl);
}

/**
 * Sync cookie and return the new-session redirect URL (新建会话).
 */
export async function syncCookieAndGetNewSessionUrl(): Promise<string | null> {
  return syncCookieAndBuildUrl(buildNewSessionUrl);
}

/**
 * Sync cookie and return the chat-session redirect URL (进入历史会话).
 */
export async function syncCookieAndGetChatUrl(
  sessionId: string,
): Promise<string | null> {
  return syncCookieAndBuildUrl((domain) =>
    buildChatSessionUrl(domain, sessionId),
  );
}
