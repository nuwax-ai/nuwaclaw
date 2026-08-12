/**
 * NuwaxHostWebview - 客户端主窗口宿主组件。
 *
 * 全屏嵌入 nuwax PC 站点（含登录页），作为客户端主界面。
 *
 * 与 BrowserHomePage 的关键区别：
 * - 不依赖 nuwaclaw sandbox 登录：直接从 step1_config.serverHost 解析 nuwax 根 URL，
 *   鉴权完全交给 nuwax 自身 /Login 页 + NuwaClawBridge.auth（ACCESS_TOKEN 双向同步，重启免登）。
 * - 沉浸式无边框：webview 占满整窗（含顶部），顶部叠一条透明拖拽条；Win/Linux 自绘窗口控制按钮，
 *   mac 沿用原生红绿灯（main.ts titleBarStyle:"hidden"）。
 */
import React, { useEffect, useRef, useState } from "react";
import { APP_DISPLAY_NAME, DEFAULT_SERVER_HOST } from "@shared/constants";
import { normalizeServerHost } from "../../services/core/auth";
import { buildHomeUrl } from "../../services/utils/sessionUrl";
import { logger } from "../../services/utils/logService";

/** macOS 用 navigator.platform 判定（渲染器无 process.platform）。 */
const isMac = /mac/i.test(navigator.platform);

/** -webkit-app-region 需在 renderer DOM 设置；为 Electron 专属键，React CSSProperties 未内置，用 any 规避告警。 */
const DRAG = { WebkitAppRegion: "drag" } as any;
const NO_DRAG = { WebkitAppRegion: "no-drag" } as any;

export interface NuwaxHostWebviewProps {
  /** 递增时强制 reload webview（供外部刷新按钮调用）。 */
  reloadKey?: number;
}

function NuwaxHostWebview({ reloadKey = 0 }: NuwaxHostWebviewProps) {
  const [url, setUrl] = useState("");
  const [ua, setUa] = useState<string | undefined>();
  const [maximized, setMaximized] = useState(false);
  const webviewRef = useRef<HTMLElement | null>(null);

  // 自定义 UA：保留 女娲 Nuwax/<version> 标识，便于 nuwax 侧识别客户端环境
  useEffect(() => {
    window.electronAPI?.app
      .getVersion()
      .then((v) => setUa(`${navigator.userAgent} ${APP_DISPLAY_NAME}/${v}`))
      .catch(() => {});
  }, []);

  // 解析 nuwax 根 URL（不依赖 nuwaclaw 登录态）
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const step1 = (await window.electronAPI?.settings.get(
          "step1_config",
        )) as { serverHost?: string } | null;
        const domain = normalizeServerHost(
          step1?.serverHost || DEFAULT_SERVER_HOST,
        );
        if (!cancelled && domain) setUrl(buildHomeUrl(domain));
      } catch (e) {
        logger.error("[NuwaxHostWebview] resolve url failed", e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // 最大化状态（Win/Linux 自绘按钮图标）；窗口尺寸变化时重查
  useEffect(() => {
    const sync = () =>
      window.electronAPI?.window
        .isMaximized?.()
        .then(setMaximized)
        .catch(() => {});
    sync();
    window.addEventListener("resize", sync);
    return () => window.removeEventListener("resize", sync);
  }, []);

  // 外部 reloadKey 变化时重载 webview
  useEffect(() => {
    if (reloadKey > 0) (webviewRef.current as any)?.reload?.();
  }, [reloadKey]);

  const onMin = () => window.electronAPI?.window.minimize();
  const onMax = () => window.electronAPI?.window.maximize();
  const onClose = () => window.electronAPI?.window.close();

  return (
    <div
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        background: "#fff",
        overflow: "hidden",
      }}
    >
      <webview
        ref={webviewRef as any}
        src={url}
        useragent={ua}
        allowpopups={"true" as any}
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          border: "none",
        }}
      />

      {/* 顶部透明拖拽条（沉浸式）：webview 内容顶到窗口上沿，此处仅作拖拽手柄。
          mac 左侧留出 80px 避让原生红绿灯（原生灯位于 web 内容之上，但仍预留以免干扰）。 */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: isMac ? 80 : 0,
          right: 0,
          height: 28,
          zIndex: 10,
          ...DRAG,
        }}
      />

      {/* Win/Linux 自绘窗口控制按钮（mac 用原生红绿灯，不渲染） */}
      {!isMac && (
        <div
          style={{
            position: "absolute",
            top: 0,
            right: 0,
            height: 28,
            display: "flex",
            alignItems: "center",
            zIndex: 11,
            ...NO_DRAG,
          }}
        >
          <CtrlButton title="最小化" onClick={onMin}>
            &#8211;
          </CtrlButton>
          <CtrlButton title={maximized ? "还原" : "最大化"} onClick={onMax}>
            {maximized ? "⧉" : "□"}
          </CtrlButton>
          <CtrlButton title="关闭" onClick={onClose} danger>
            &#10005;
          </CtrlButton>
        </div>
      )}
    </div>
  );
}

const CtrlButton: React.FC<{
  title: string;
  onClick: () => void;
  danger?: boolean;
  children: React.ReactNode;
}> = ({ title, onClick, danger, children }) => (
  <button
    aria-label={title}
    title={title}
    onClick={onClick}
    style={{
      width: 40,
      height: 28,
      border: "none",
      background: "transparent",
      color: danger ? "#ff5f57" : "#555",
      fontSize: 13,
      lineHeight: "28px",
      cursor: "pointer",
      ...NO_DRAG,
    }}
  >
    {children}
  </button>
);

export default NuwaxHostWebview;
