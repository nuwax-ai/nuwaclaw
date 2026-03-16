/**
 * EmbeddedWebview - 内嵌 webview 浏览器组件
 *
 * 提供工具栏（返回/刷新）+ Electron <webview> + 加载失败提示。
 * 使用 defaultSession，与 session:setCookie 设置的 cookie 共享。
 */

import React, { useState, useEffect, useRef, useCallback } from "react";
import { Button, Alert } from "antd";
import { ArrowLeftOutlined, ReloadOutlined } from "@ant-design/icons";
import { APP_DISPLAY_NAME } from "@shared/constants";
import styles from "../styles/components/EmbeddedWebview.module.css";

interface EmbeddedWebviewProps {
  /** 要加载的 URL */
  url: string;
  /** 点击「返回」按钮回调 */
  onClose: () => void;
}

function EmbeddedWebview({ url, onClose }: EmbeddedWebviewProps) {
  const [error, setError] = useState<string | null>(null);
  const [userAgent, setUserAgent] = useState<string | undefined>();
  const webviewRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    window.electronAPI?.app
      .getVersion()
      .then((version) => {
        setUserAgent(navigator.userAgent + ` ${APP_DISPLAY_NAME}/${version}`);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const el = webviewRef.current as any;
    if (!el) return;

    const onFailLoad = (e: any) => {
      // errorCode -3 is "aborted" (navigation cancelled), not a real error
      if (e.errorCode && e.errorCode !== -3) {
        setError(
          `加载失败: ${e.errorDescription || "未知错误"} (${e.errorCode})`,
        );
      }
    };
    const onStartLoading = () => setError(null);

    el.addEventListener("did-fail-load", onFailLoad);
    el.addEventListener("did-start-loading", onStartLoading);
    return () => {
      el.removeEventListener("did-fail-load", onFailLoad);
      el.removeEventListener("did-start-loading", onStartLoading);
    };
  }, []);

  const handleReload = useCallback(() => {
    (webviewRef.current as any)?.reload?.();
  }, []);

  return (
    <div className={styles.container}>
      <div className={styles.toolbar}>
        <Button size="small" icon={<ArrowLeftOutlined />} onClick={onClose}>
          返回
        </Button>
        <span className={styles.url}>{url}</span>
        <Button size="small" icon={<ReloadOutlined />} onClick={handleReload}>
          刷新
        </Button>
      </div>
      {error && (
        <Alert
          message={error}
          type="error"
          showIcon
          closable
          onClose={() => setError(null)}
          style={{ margin: "8px 12px 0", flexShrink: 0 }}
        />
      )}
      <webview
        ref={webviewRef as any}
        src={url}
        useragent={userAgent}
        style={{ flex: 1, width: "100%", border: "none" }}
        allowpopups={"true" as any}
      />
    </div>
  );
}

export default EmbeddedWebview;
