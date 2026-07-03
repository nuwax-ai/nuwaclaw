/**
 * Webview / iframe 浏览器策略统一管理
 *
 * 集中处理：
 * 1. 权限请求（剪贴板、媒体、全屏等）
 * 2. window.open 弹窗（应用内打开，尺寸在页面请求基础上 ×2）
 * 3. 文件下载（导出等场景，支持进度条）
 */

import { app, session as electronSession, BrowserWindow } from "electron";
import type { HandlerDetails, BrowserWindowConstructorOptions } from "electron";
import log from "electron-log";
import {
  WEBVIEW_POPUP_BASE_WIDTH,
  WEBVIEW_POPUP_BASE_HEIGHT,
  WEBVIEW_POPUP_MIN_WIDTH,
  WEBVIEW_POPUP_MIN_HEIGHT,
} from "@shared/constants";

// ---------- 权限白名单 ----------

const ALLOWED_PERMISSIONS = new Set([
  "clipboard-read",
  "clipboard-sanitized-write",
  "media",
  "mediaKeySystem",
  "notifications",
  "fullscreen",
  "pointerLock",
  "openExternal",
]);

// ---------- 权限 ----------

function setupPermissions(): void {
  electronSession.defaultSession.setPermissionRequestHandler(
    (_webContents, permission, callback) => {
      if (ALLOWED_PERMISSIONS.has(permission)) {
        callback(true);
      } else {
        log.warn(`[WebviewPolicy] Denied permission request: ${permission}`);
        callback(false);
      }
    },
  );

  electronSession.defaultSession.setPermissionCheckHandler(
    (_webContents, permission) => {
      return ALLOWED_PERMISSIONS.has(permission);
    },
  );
}

// ---------- window.open ----------

function isHttpUrl(url: string): boolean {
  return url.startsWith("http:") || url.startsWith("https:");
}

/**
 * 解析 window.open 的 features 字符串（如 "width=500,height=300"）。
 */
function parseWindowFeatures(features: string): {
  width?: number;
  height?: number;
} {
  const result: { width?: number; height?: number } = {};
  if (!features) return result;

  for (const part of features.split(",")) {
    const trimmed = part.trim();
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;

    const key = trimmed.slice(0, eq).trim().toLowerCase();
    const value = parseInt(trimmed.slice(eq + 1).trim(), 10);
    if (Number.isNaN(value) || value <= 0) continue;

    if (key === "width") result.width = value;
    if (key === "height") result.height = value;
  }

  return result;
}

/**
 * 将页面请求的弹窗尺寸放大一倍；未指定时使用 Electron 常见默认 600×400 再 ×2。
 */
function resolveWebviewPopupSize(features: string): {
  width: number;
  height: number;
} {
  const parsed = parseWindowFeatures(features);
  const baseWidth = parsed.width ?? WEBVIEW_POPUP_BASE_WIDTH;
  const baseHeight = parsed.height ?? WEBVIEW_POPUP_BASE_HEIGHT;
  return { width: baseWidth * 2, height: baseHeight * 2 };
}

/** 应用内 http(s) 弹窗的 BrowserWindow 配置 */
function buildPopupWindowOptions(
  features: string,
): BrowserWindowConstructorOptions {
  const { width, height } = resolveWebviewPopupSize(features);
  return {
    width,
    height,
    minWidth: WEBVIEW_POPUP_MIN_WIDTH,
    minHeight: WEBVIEW_POPUP_MIN_HEIGHT,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
    show: true,
    backgroundColor: "#ffffff",
  };
}

function handleHttpPopupOpen(
  details: HandlerDetails,
):
  | {
      action: "allow";
      overrideBrowserWindowOptions: BrowserWindowConstructorOptions;
    }
  | { action: "deny" } {
  const { url, features } = details;
  if (!url || !isHttpUrl(url)) {
    return { action: "deny" };
  }

  const options = buildPopupWindowOptions(features ?? "");
  log.debug(
    `[WebviewPolicy] Opening in-app popup: ${url} (${options.width}x${options.height})`,
  );
  return { action: "allow", overrideBrowserWindowOptions: options };
}

function setupWindowOpen(): void {
  app.on("web-contents-created", (_event, contents) => {
    // <webview> tag 内部的 window.open
    contents.on("did-attach-webview", (_event, webContents) => {
      webContents.setWindowOpenHandler((details) =>
        handleHttpPopupOpen(details),
      );

      // Webview captures keyboard events — they don't bubble to the host page.
      // Intercept Ctrl/Cmd+Shift+I here to open webview DevTools.
      webContents.on("before-input-event", (event, input) => {
        if (
          input.type === "keyDown" &&
          input.shift &&
          (input.control || input.meta) &&
          input.key.toLowerCase() === "i"
        ) {
          event.preventDefault();
          webContents.openDevTools();
        }
      });
    });

    // BrowserWindow 内部的 window.open（独立 webview 窗口等）
    if (contents.getType() === "window") {
      contents.setWindowOpenHandler((details) => handleHttpPopupOpen(details));
    }
  });
}

// ---------- 文件下载 ----------

function setupDownloads(getMainWindow: () => BrowserWindow | null): void {
  electronSession.defaultSession.on("will-download", (_event, item) => {
    const filename = item.getFilename();
    log.info(
      `[WebviewPolicy] Download started: ${filename} (${item.getTotalBytes()} bytes)`,
    );

    item.on("updated", (_event, state) => {
      if (state === "progressing" && !item.isPaused()) {
        const received = item.getReceivedBytes();
        const total = item.getTotalBytes();
        if (total > 0) {
          getMainWindow()?.setProgressBar(received / total);
        }
      }
    });

    item.once("done", (_event, state) => {
      getMainWindow()?.setProgressBar(-1);
      if (state === "completed") {
        log.info(
          `[WebviewPolicy] Download completed: ${filename} → ${item.getSavePath()}`,
        );
      } else {
        log.warn(`[WebviewPolicy] Download failed: ${filename} (${state})`);
      }
    });
  });
}

// ---------- 统一入口 ----------

/**
 * 初始化 webview / iframe 浏览器策略。
 * 须在 createWindow() 之前调用，确保主窗口 webContents 能注册 did-attach-webview 监听。
 */
export function initWebviewPolicy(
  getMainWindow: () => BrowserWindow | null,
): void {
  setupPermissions();
  setupWindowOpen();
  setupDownloads(getMainWindow);
  log.info("[WebviewPolicy] Initialized (permissions, window.open, downloads)");
}
