/**
 * Session / Cookie / WebView Window IPC 处理器
 *
 * 职责：
 * - session:setCookie / getCookie / removeCookie / flushStore
 * - webview:openWindow / closeWindow / isWindowOpen
 * 包含 Cookie 域解析、JWT 过期解析等内部工具函数。
 */

import {
  ipcMain,
  app,
  session as electronSession,
  BrowserWindow,
} from "electron";
import * as path from "path";
import log from "electron-log";
import type { HandlerContext } from "@shared/types/ipc";
import { APP_DISPLAY_NAME } from "@shared/constants";
import { readSetting, writeSetting } from "../db";
import { getDomainTokenKey } from "@shared/utils/domain";
import { t } from "../services/i18n";

// ==================== WebView 窗口缓存 ====================

let webviewWindow: BrowserWindow | null = null;

// ==================== Cookie 工具函数 ====================

const isIpv4Host = (host: string): boolean =>
  /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/.test(host);
const isIpv6Host = (host: string): boolean => /^[0-9a-f:]+$/i.test(host);
const useHostOnlyCookie = (host: string): boolean =>
  host === "localhost" || isIpv4Host(host) || isIpv6Host(host);

function resolveCookieDomain(url: string): string | undefined {
  try {
    const host = new URL(url).hostname;
    return useHostOnlyCookie(host) ? undefined : host;
  } catch {
    return undefined;
  }
}

/**
 * 解析 JWT token 的过期时间
 * 注意：仅解析过期时间，不验证签名。过期时间来自不可信来源（外部 token）。
 * 这里的用途是设置 cookie 的过期时间，即使被伪造也只是影响本地 cookie 生命周期。
 */
function parseJwtExp(token: string): number | null {
  try {
    const parts = token.split(".");
    if (parts.length < 2) return null;
    const payload = Buffer.from(parts[1], "base64url").toString("utf8");
    const parsed = JSON.parse(payload) as { exp?: unknown };
    if (typeof parsed.exp !== "number" || !Number.isFinite(parsed.exp)) {
      return null;
    }
    return parsed.exp;
  } catch {
    return null;
  }
}

// JWT 无 exp 或 exp 即将到期时的兜底 cookie TTL（7 天）
const TICKET_COOKIE_FALLBACK_TTL_SECONDS = 7 * 24 * 60 * 60;

function resolveTicketExpirationDate(token: string): number | undefined {
  const exp = parseJwtExp(token);
  const fallback =
    Math.floor(Date.now() / 1000) + TICKET_COOKIE_FALLBACK_TTL_SECONDS;
  if (!exp) return fallback;
  // 过期时间太近（<60s）时使用兜底 TTL，避免创建 session cookie
  if (exp <= Math.floor(Date.now() / 1000) + 60) return fallback;
  return exp;
}

function getHostname(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

async function removeSameNameCookies(params: {
  url: string;
  name: string;
  domain?: string;
}): Promise<void> {
  const host = getHostname(params.url);
  if (!host) return;
  const targetDomain = params.domain?.toLowerCase();
  const all = await electronSession.defaultSession.cookies.get({
    name: params.name,
  });

  for (const c of all) {
    const cookieDomain = (c.domain || "").toLowerCase().replace(/^\./, "");
    const domainMatched = targetDomain
      ? cookieDomain === targetDomain
      : cookieDomain === host || host.endsWith(`.${cookieDomain}`);
    if (!domainMatched) continue;

    const removeHost = cookieDomain || host;
    const removePath = c.path?.startsWith("/") ? c.path : `/${c.path || ""}`;
    const removeUrl = `${c.secure ? "https" : "http"}://${removeHost}${removePath}`;
    try {
      await electronSession.defaultSession.cookies.remove(removeUrl, c.name);
    } catch (error) {
      log.warn("[IPC] session:setCookie remove old cookie failed:", error);
    }
  }
}

// ==================== 处理器注册 ====================

export function registerSessionHandlers(ctx: HandlerContext): void {
  // -------- Session / Cookie --------

  ipcMain.handle(
    "session:setCookie",
    async (
      _,
      params: {
        url: string;
        name: string;
        value: string;
        domain?: string;
        expirationDate?: number;
        httpOnly?: boolean;
        secure?: boolean;
      },
    ) => {
      try {
        await removeSameNameCookies({
          url: params.url,
          name: params.name,
          domain: params.domain,
        });

        const cookieDetails: Electron.CookiesSetDetails = {
          url: params.url,
          name: params.name,
          value: params.value,
          path: "/",
          httpOnly: params.httpOnly ?? true,
          secure: params.secure ?? params.url.startsWith("https://"),
        };
        const expirationDate =
          typeof params.expirationDate === "number"
            ? params.expirationDate
            : params.name === "ticket"
              ? resolveTicketExpirationDate(params.value)
              : undefined;
        if (typeof expirationDate === "number") {
          cookieDetails.expirationDate = expirationDate;
        }
        if (params.domain) {
          cookieDetails.domain = params.domain;
        }

        // Chromium rejects SameSite=None without Secure.
        if (cookieDetails.secure) {
          cookieDetails.sameSite = "no_restriction";
        }

        await electronSession.defaultSession.cookies.set(cookieDetails);
        await electronSession.defaultSession.cookies.flushStore();
        log.info("[IPC] session:setCookie success for domain:", params.domain);
        return { success: true };
      } catch (error) {
        log.error("[IPC] session:setCookie failed:", error);
        return { success: false, error: String(error) };
      }
    },
  );

  ipcMain.handle(
    "session:getCookie",
    async (
      _,
      params: {
        url: string;
        name: string;
      },
    ) => {
      try {
        const cookies = await electronSession.defaultSession.cookies.get({
          url: params.url,
          name: params.name,
        });
        const hit = cookies[0];
        if (!hit) return { success: true, found: false };
        return {
          success: true,
          found: true,
          count: cookies.length,
          cookies: cookies.map((c) => ({
            name: c.name,
            domain: c.domain,
            path: c.path,
            httpOnly: c.httpOnly,
            secure: c.secure,
            sameSite: c.sameSite,
            session: c.session,
            expirationDate: c.expirationDate,
          })),
          cookie: {
            name: hit.name,
            domain: hit.domain,
            path: hit.path,
            httpOnly: hit.httpOnly,
            secure: hit.secure,
            sameSite: hit.sameSite,
            session: hit.session,
            expirationDate: hit.expirationDate,
          },
        };
      } catch (error) {
        log.error("[IPC] session:getCookie failed:", error);
        return { success: false, error: String(error) };
      }
    },
  );

  ipcMain.handle(
    "session:removeCookie",
    async (_, params: { url: string; name: string }) => {
      try {
        await removeSameNameCookies({
          url: params.url,
          name: params.name,
        });
        await electronSession.defaultSession.cookies.flushStore();
        log.info("[IPC] session:removeCookie success", {
          url: params.url,
          name: params.name,
        });
        return { success: true };
      } catch (error) {
        log.error("[IPC] session:removeCookie failed:", error);
        return { success: false, error: String(error) };
      }
    },
  );

  ipcMain.handle("session:flushStore", async () => {
    try {
      await electronSession.defaultSession.cookies.flushStore();
      return { success: true };
    } catch (error) {
      log.error("[IPC] session:flushStore failed:", error);
      return { success: false, error: String(error) };
    }
  });

  // -------- WebView Window --------

  const WEBVIEW_BOUNDS_KEY = "webview_window_bounds";

  ipcMain.handle(
    "webview:openWindow",
    async (
      _,
      params: {
        url: string;
        title?: string;
      },
    ) => {
      try {
        const { url, title } = params;
        const syncTicketCookie = async (): Promise<void> => {
          if (!/^https?:\/\//i.test(url)) return;

          const oneShotToken = readSetting("auth.token");
          const domainTokenKey = getDomainTokenKey(url);
          const domainToken = readSetting(domainTokenKey);
          const hasOneShotToken =
            typeof oneShotToken === "string" && oneShotToken.length > 0;
          const token = hasOneShotToken ? oneShotToken : domainToken;
          const tokenSource = hasOneShotToken ? "one_shot" : "domain_cache";
          if (typeof token !== "string" || !token) {
            log.debug("[IPC] webview:openWindow no token available for sync", {
              url,
              domainTokenKey,
              oneShotTokenPresent: hasOneShotToken,
              domainTokenPresent:
                typeof domainToken === "string" && domainToken.length > 0,
            });
            return;
          }
          log.debug("[IPC] webview:openWindow token selected", {
            url,
            tokenSource,
            domainTokenKey,
          });

          if (!hasOneShotToken) {
            const current = await electronSession.defaultSession.cookies.get({
              url,
              name: "ticket",
            });
            const hasValidCookie =
              current.length > 0 &&
              current.some((c) => {
                if (!c.expirationDate) return true;
                return c.expirationDate * 1000 > Date.now();
              });
            if (hasValidCookie) {
              writeSetting("auth.token", null);
              log.info(
                "[IPC] webview:openWindow detected valid ticket, skip domain-token sync",
                { url, count: current.length },
              );
              return;
            }
            if (current.length > 0) {
              log.info(
                "[IPC] webview:openWindow detected expired ticket, re-syncing",
                { url, count: current.length },
              );
            }
          }

          await removeSameNameCookies({
            url,
            name: "ticket",
            domain: resolveCookieDomain(url),
          });

          const secure = url.startsWith("https://");
          const cookieDetails: Electron.CookiesSetDetails = {
            url,
            name: "ticket",
            value: token,
            path: "/",
            httpOnly: true,
            secure,
          };
          const cookieDomain = resolveCookieDomain(url);
          if (cookieDomain) {
            cookieDetails.domain = cookieDomain;
          }
          const expirationDate = resolveTicketExpirationDate(token);
          if (typeof expirationDate === "number") {
            cookieDetails.expirationDate = expirationDate;
          }
          if (secure) {
            cookieDetails.sameSite = "no_restriction";
          }

          await electronSession.defaultSession.cookies.set(cookieDetails);
          await electronSession.defaultSession.cookies.flushStore();
          writeSetting("auth.token", null);
          log.debug("[IPC] webview:openWindow synced ticket cookie", {
            url,
            tokenSource,
            secure,
            domain: cookieDetails.domain || "(host-only)",
          });
        };

        const syncWithRetry = async (maxRetries = 3): Promise<void> => {
          for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
              await syncTicketCookie();
              return;
            } catch (error) {
              if (attempt === maxRetries) throw error;
              log.warn(
                `[IPC] webview:openWindow ticket cookie sync attempt ${attempt}/${maxRetries} failed, retrying...`,
                error,
              );
              await new Promise((resolve) =>
                setTimeout(resolve, 100 * attempt),
              );
            }
          }
        };

        try {
          await syncWithRetry(3);
        } catch (error) {
          log.debug(
            "[IPC] webview:openWindow ticket cookie sync failed after retries:",
            error,
          );
        }

        if (webviewWindow && !webviewWindow.isDestroyed()) {
          try {
            await webviewWindow.loadURL(url);
          } catch (loadErr) {
            log.warn(
              "[IPC] webview:openWindow - reuse loadURL failed:",
              loadErr,
            );
          }
          webviewWindow.focus();
          if (title) webviewWindow.setTitle(title);
          log.debug(
            "[IPC] webview:openWindow - reused existing window for:",
            url,
          );
          return { success: true, reused: true };
        }

        const getIconPath = () => {
          if (app.isPackaged) {
            if (process.platform === "darwin") {
              return path.join(process.resourcesPath, "icon.icns");
            }
            return path.join(process.resourcesPath, "icon.png");
          }
          if (process.platform === "darwin") {
            return path.join(process.cwd(), "public", "icon.icns");
          }
          return path.join(process.cwd(), "public", "icon.png");
        };

        let savedBounds: {
          width: number;
          height: number;
          x?: number;
          y?: number;
          maximized?: boolean;
        } | null = null;
        try {
          const saved = await ctx
            .getMainWindow()
            ?.webContents?.executeJavaScript(
              `localStorage.getItem('${WEBVIEW_BOUNDS_KEY}')`,
            );
          if (saved && typeof saved === "string") {
            savedBounds = JSON.parse(saved);
          }
        } catch {
          /* 忽略读取错误 */
        }

        webviewWindow = new BrowserWindow({
          width: savedBounds?.width || 1200,
          height: savedBounds?.height || 800,
          x: savedBounds?.x,
          y: savedBounds?.y,
          minWidth: 600,
          minHeight: 400,
          title: title || `${APP_DISPLAY_NAME} - ${t("Claw.Sessions.title")}`,
          icon: getIconPath(),
          webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
            webviewTag: false,
            spellcheck: false,
          },
          show: false,
          backgroundColor: "#ffffff",
        });

        if (!savedBounds) {
          webviewWindow.maximize();
        } else if (savedBounds.maximized) {
          webviewWindow.maximize();
        }

        await webviewWindow.loadURL(url);

        webviewWindow.once("ready-to-show", () => {
          webviewWindow?.show();
          log.debug("[IPC] webview:openWindow - window shown for:", url);
        });

        let saveBoundsTimeout: NodeJS.Timeout | null = null;
        const saveBounds = () => {
          if (saveBoundsTimeout) clearTimeout(saveBoundsTimeout);
          saveBoundsTimeout = setTimeout(() => {
            if (webviewWindow && !webviewWindow.isDestroyed()) {
              const bounds = webviewWindow.getBounds();
              const isMaximized = webviewWindow.isMaximized();
              const data = JSON.stringify({
                ...bounds,
                maximized: isMaximized,
              });
              ctx
                .getMainWindow()
                ?.webContents?.executeJavaScript(
                  `localStorage.setItem('${WEBVIEW_BOUNDS_KEY}', '${data}')`,
                )
                .catch(() => {});
            }
          }, 500);
        };

        webviewWindow.on("resize", saveBounds);
        webviewWindow.on("move", saveBounds);
        webviewWindow.on("maximize", saveBounds);
        webviewWindow.on("unmaximize", saveBounds);

        webviewWindow.on("closed", () => {
          webviewWindow = null;
          if (saveBoundsTimeout) clearTimeout(saveBoundsTimeout);
          log.debug("[IPC] webview:openWindow - window closed");
        });

        return { success: true, reused: false };
      } catch (error) {
        log.error("[IPC] webview:openWindow failed:", error);
        return { success: false, error: String(error) };
      }
    },
  );

  ipcMain.handle("webview:closeWindow", async () => {
    try {
      if (webviewWindow && !webviewWindow.isDestroyed()) {
        // Do NOT set webviewWindow = null here — the "closed" event handler does it.
        // Setting it synchronously before "closed" fires would wipe the reference to
        // a newly opened window if openWindow is called between close() and "closed".
        webviewWindow.close();
      }
      return { success: true };
    } catch (error) {
      log.error("[IPC] webview:closeWindow failed:", error);
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle("webview:isWindowOpen", () => {
    return webviewWindow !== null && !webviewWindow.isDestroyed();
  });
}
