/**
 * Webview / iframe 浏览器策略统一管理
 *
 * 集中处理：
 * 1. 权限请求（剪贴板、媒体、全屏等）
 * 2. window.open 拦截（统一由系统浏览器打开）
 * 3. 文件下载（导出等场景，支持进度条）
 */

import {
  app,
  session as electronSession,
  shell,
  BrowserWindow,
} from "electron";
import log from "electron-log";

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

function setupWindowOpen(): void {
  app.on("web-contents-created", (_event, contents) => {
    // <webview> tag 内部的 window.open
    contents.on("did-attach-webview", (_event, webContents) => {
      webContents.setWindowOpenHandler(({ url }) => {
        if (url && isHttpUrl(url)) {
          shell.openExternal(url);
        }
        return { action: "deny" };
      });

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
      contents.setWindowOpenHandler(({ url }) => {
        if (url && isHttpUrl(url)) {
          shell.openExternal(url);
        }
        return { action: "deny" };
      });
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
 * 应在 app.whenReady() 且 createWindow() 之后调用。
 */
export function initWebviewPolicy(
  getMainWindow: () => BrowserWindow | null,
): void {
  setupPermissions();
  setupWindowOpen();
  setupDownloads(getMainWindow);
  log.info("[WebviewPolicy] Initialized (permissions, window.open, downloads)");
}
