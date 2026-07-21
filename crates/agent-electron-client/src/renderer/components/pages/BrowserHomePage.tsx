/**
 * BrowserHomePage - 浏览器模式主页面
 *
 * 内嵌 webview 加载配置域名的 home / 会话 URL。
 * 通过 onReloadReady 向 App 注册刷新函数，供顶部栏浏览器专属刷新按钮调用。
 */

import React, { useState, useEffect, useRef } from "react";
import { Spin } from "antd";
import {
  syncCookieAndGetHomeUrl,
  syncCookieAndGetRedirectUrl,
  syncCookieAndGetNewSessionUrl,
  syncCookieAndGetChatUrl,
  persistTicketCookie,
} from "../../services/utils/sessionUrl";
import { logger } from "../../services/utils/logService";
import { APP_DISPLAY_NAME } from "@shared/constants";
import { t } from "../../services/core/i18n";
import styles from "../../styles/components/BrowserHomePage.module.css";

/** 浏览器模式加载目标 */
export type BrowserTarget =
  | { type: "home" }
  | { type: "startSession" }
  | { type: "session"; sessionId: string }
  | { type: "newSession" }
  | { type: "url"; url: string };

interface BrowserHomePageProps {
  target: BrowserTarget;
  /** 递增时强制 remount webview 并重新 sync cookie */
  openKey: number;
  /** 向父组件注册 webview reload 函数（仅浏览器模式顶部栏使用） */
  onReloadReady?: (reload: (() => void) | null) => void;
}

async function resolveTargetUrl(target: BrowserTarget): Promise<string | null> {
  switch (target.type) {
    case "home":
      return syncCookieAndGetHomeUrl();
    case "startSession":
      return syncCookieAndGetRedirectUrl();
    case "newSession":
      return syncCookieAndGetNewSessionUrl();
    case "session":
      return syncCookieAndGetChatUrl(target.sessionId);
    case "url":
      return target.url;
    default:
      return null;
  }
}

function BrowserHomePage({
  target,
  openKey,
  onReloadReady,
}: BrowserHomePageProps) {
  const [webviewUrl, setWebviewUrl] = useState("");
  const [loading, setLoading] = useState(true);
  const [loginRequired, setLoginRequired] = useState(false);
  const [webviewUA, setWebviewUA] = useState<string | undefined>();
  const webviewRef = useRef<HTMLElement | null>(null);

  // 构建带应用版本号的自定义 User-Agent
  useEffect(() => {
    window.electronAPI?.app
      .getVersion()
      .then((version) => {
        const ua = navigator.userAgent + ` ${APP_DISPLAY_NAME}/${version}`;
        setWebviewUA(ua);
      })
      .catch(() => {});
  }, []);

  // 根据 target / openKey 加载 URL
  useEffect(() => {
    let cancelled = false;

    const loadUrl = async () => {
      setLoading(true);
      setLoginRequired(false);
      setWebviewUrl("");

      try {
        const url = await resolveTargetUrl(target);
        if (cancelled) return;

        if (!url) {
          setLoginRequired(true);
          setLoading(false);
          return;
        }

        setWebviewUrl(url);
      } catch (error) {
        console.error("[BrowserHomePage] loadUrl failed:", error);
        if (!cancelled) {
          setLoginRequired(true);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    loadUrl();
    return () => {
      cancelled = true;
    };
  }, [target, openKey]);

  // 向 App 注册 reload 函数；卸载时清除
  useEffect(() => {
    if (!webviewUrl) {
      onReloadReady?.(null);
      return;
    }

    onReloadReady?.(() => {
      (webviewRef.current as any)?.reload?.();
    });

    return () => {
      onReloadReady?.(null);
    };
  }, [webviewUrl, onReloadReady]);

  // 监听 webview 导航，登录成功后持久化 ticket cookie
  useEffect(() => {
    const el = webviewRef.current as any;
    if (!el || !webviewUrl) return;

    const onDidNavigate = (e: any) => {
      const url: string = e.url || "(unknown)";
      const isLogin = url.includes("/login");
      const level = isLogin ? "warn" : "info";
      logger[level](
        `[BrowserHomePage][WebviewNav] did-navigate${isLogin ? " ⚠️ LOGIN DETECTED" : ""}`,
        "BrowserHomePage",
        { url, httpCode: e.httpResponseCode, isLogin },
      );

      if (!isLogin && url.startsWith("http")) {
        try {
          const origin = new URL(url).origin;
          persistTicketCookie(origin).catch(() => {});
        } catch {
          // URL 解析失败，忽略
        }
      }
    };
    const onWillRedirect = (e: any) => {
      logger.info(
        "[BrowserHomePage][WebviewNav] will-redirect",
        "BrowserHomePage",
        { from: e.oldURL, to: e.newURL },
      );
    };

    el.addEventListener("did-navigate", onDidNavigate);
    el.addEventListener("did-navigate-in-page", onDidNavigate);
    el.addEventListener("will-redirect", onWillRedirect);
    return () => {
      el.removeEventListener("did-navigate", onDidNavigate);
      el.removeEventListener("did-navigate-in-page", onDidNavigate);
      el.removeEventListener("will-redirect", onWillRedirect);
    };
  }, [webviewUrl]);

  if (loading) {
    return (
      <div className={styles.emptyState}>
        <Spin size="default" />
      </div>
    );
  }

  if (loginRequired || !webviewUrl) {
    return (
      <div className={styles.emptyState}>
        <span>{t("Claw.App.browserLoginRequired")}</span>
      </div>
    );
  }

  return (
    <div className={styles.webviewContainer}>
      <webview
        ref={webviewRef as any}
        src={webviewUrl}
        useragent={webviewUA}
        style={{ flex: 1, width: "100%", border: "none" }}
        allowpopups={"true" as any}
      />
    </div>
  );
}

export default BrowserHomePage;
