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

function normalizeDomainForTokenKey(domain: string): string {
  try {
    return new URL(domain).hostname.toLowerCase();
  } catch {
    return domain
      .replace(/^https?:\/\//i, "")
      .split("/")[0]
      .split(":")[0]
      .toLowerCase();
  }
}

function getDomainTokenKey(domain: string): string {
  return `auth.tokens.${normalizeDomainForTokenKey(domain)}`;
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
  const isIpv4 = (host: string): boolean =>
    /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/.test(host);
  const isIpv6 = (host: string): boolean => /^[0-9a-f:]+$/i.test(host);
  const useHostOnlyCookie = (host: string): boolean =>
    host === "localhost" || isIpv4(host) || isIpv6(host);

  let cookieDomain: string | undefined;
  try {
    const host = new URL(domain).hostname;
    cookieDomain = useHostOnlyCookie(host) ? undefined : host;
  } catch {
    const rawHost = domain
      .replace(/^https?:\/\//, "")
      .split("/")[0]
      .split(":")[0];
    cookieDomain = useHostOnlyCookie(rawHost) ? undefined : rawHost;
  }
  const payload: {
    url: string;
    name: string;
    value: string;
    domain?: string;
    httpOnly: boolean;
    secure: boolean;
  } = {
    url: domain,
    name: "ticket",
    value: token,
    httpOnly: true,
    secure: domain.startsWith("https"),
  };
  if (cookieDomain) {
    payload.domain = cookieDomain;
  }
  const result = await window.electronAPI?.session.setCookie(payload);
  if (!result?.success) {
    // 只记录域名和错误，不记录 token 等敏感信息
    throw new Error(result?.error || `session:setCookie failed for ${domain}`);
  }

  // 写入后立即回读，便于定位“已写入但页面仍未登录”的问题
  try {
    const verify = await window.electronAPI?.session.getCookie({
      url: domain,
      name: "ticket",
    });
    logger.info("[SessionUrl][Diag] ticket cookie 回读结果", "SessionUrl", {
      domain,
      found: !!verify?.found,
      count: verify?.count ?? 0,
      cookies: verify?.cookies || [],
      cookie: verify?.cookie
        ? {
            domain: verify.cookie.domain,
            path: verify.cookie.path,
            httpOnly: verify.cookie.httpOnly,
            secure: verify.cookie.secure,
            sameSite: verify.cookie.sameSite,
          }
        : null,
      error: verify?.success ? null : verify?.error || "unknown",
    });
  } catch (error) {
    logger.warn("[SessionUrl][Diag] ticket cookie 回读异常", "SessionUrl", {
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
  logger.info("[SessionUrl][Diag] 会话前状态", "SessionUrl", {
    domain,
    configId,
    hasToken: !!token,
    tokenSource,
    oneShotTokenPresent: !!oneShotToken,
    domainTokenKey,
    domainTokenPresent: !!token && tokenSource === "domain_cache",
  });
  if (!token) {
    logger.warn(
      "[SessionUrl][Diag] 缺少可用 token，跳过 ticket 同步",
      "SessionUrl",
      {
        domain,
        domainTokenKey,
      },
    );
  }
  if (token) {
    try {
      if (tokenSource === "domain_cache") {
        const existing = await window.electronAPI?.session.getCookie({
          url: domain,
          name: "ticket",
        });
        if (existing?.success && existing?.found) {
          // 域名缓存 token 仅做兜底；已有 ticket 时不覆盖，避免和 webview 内登录/退出行为冲突
          logger.info(
            "[SessionUrl][Diag] 检测到已有 ticket，跳过域名缓存 token 同步",
            "SessionUrl",
            {
              domain,
              found: !!existing?.found,
              count: existing?.count ?? 0,
            },
          );
          return buildUrl(domain, configId);
        }
      }

      logger.info("[SessionUrl][Diag] 准备同步 ticket cookie", "SessionUrl", {
        domain,
        tokenSource,
      });
      await syncSessionCookie(domain, token);
      logger.info("[SessionUrl][Diag] ticket cookie 同步成功", "SessionUrl", {
        domain,
        tokenSource,
      });
      // token 作为一次性补写凭据，成功后清除，避免反复覆盖 webview 内 ticket
      await window.electronAPI?.settings.set(AUTH_KEYS.AUTH_TOKEN, null);
      logger.info(
        "[SessionUrl][Diag] 已清理 one-shot auth.token",
        "SessionUrl",
        {
          domain,
        },
      );
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
