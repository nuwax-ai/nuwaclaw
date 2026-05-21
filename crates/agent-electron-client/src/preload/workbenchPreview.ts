/**
 * Workbench Preview Webview Preload
 *
 * 该脚本注入到 agent-workbench `PagePreviewIframe` 内嵌的 <webview> guest
 * 进程中，作为 main ↔ workbench host 三层桥的中间层。
 *
 * 职责：
 *  1. 暴露 `window.workbenchPreview` 以便 guest 内同源脚本调用（可选 / 调试用）。
 *  2. 加载时立即请求 main 将 session cookie 写入当前 partition，保证 fetch
 *     带 cookie，不丢用户态。
 *  3. 监听 `<a download>` / 大文件链接点击，通过 IPC 通知 main，由 main
 *     用 shell.openExternal 兜底，避免 webview 内部下载失败。
 *
 * 安全：通过 contextBridge 暴露能力，不暴露 ipcRenderer 本身；guest 主世界
 * 拿不到 Node 原语。
 */

import { contextBridge, ipcRenderer } from "electron";

/** 通知主进程注入 cookie 到当前 webview partition */
async function injectCookies(): Promise<void> {
  try {
    await ipcRenderer.invoke("workbench:injectPreviewCookies", {
      url: window.location.href,
    });
  } catch {
    // ignore — main 端会写日志
  }
}

/** 向 main 请求当前缓存的 session token（可能为 null） */
async function getSessionToken(): Promise<string | null> {
  try {
    const result = (await ipcRenderer.invoke(
      "workbench:getPreviewSessionToken",
    )) as { token?: string | null } | null;
    return result?.token ?? null;
  } catch {
    return null;
  }
}

/** 通知 main 拦截下载（main 端用 shell.openExternal） */
function notifyDownload(url: string, filename?: string): void {
  try {
    ipcRenderer.send("workbench:notifyPreviewDownload", { url, filename });
  } catch {
    // ignore
  }
}

const previewApi = {
  getSessionToken,
  notifyDownload,
  injectCookies,
} as const;

contextBridge.exposeInMainWorld("workbenchPreview", previewApi);

// 加载完成后立即注入 cookie。如果脚本在 dom-ready 前执行，等 DOMContentLoaded 再触发。
function runOnReady(fn: () => void): void {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", fn, { once: true });
  } else {
    fn();
  }
}

runOnReady(() => {
  void injectCookies();

  // 监听 anchor 点击，识别下载语义：
  //  - <a download> 显式标注
  //  - 已知下载扩展名兜底（pdf/zip/dmg/exe/msi/pkg/tar.gz）
  const DOWNLOAD_EXT_RE =
    /\.(zip|tar\.gz|tgz|dmg|pkg|exe|msi|appimage|deb|rpm|pdf|rar|7z|iso)(\?|$)/i;

  document.addEventListener(
    "click",
    (event) => {
      const anchor = (event.target as Element | null)?.closest?.(
        "a",
      ) as HTMLAnchorElement | null;
      if (!anchor) return;
      const href = anchor.href;
      if (!href) return;

      const hasDownloadAttr = anchor.hasAttribute("download");
      const looksLikeDownload = DOWNLOAD_EXT_RE.test(href);
      if (!hasDownloadAttr && !looksLikeDownload) return;

      const filename = anchor.getAttribute("download") || undefined;
      notifyDownload(href, filename || undefined);
      // 让 main 接管，阻止默认下载在 webview 内静默失败
      event.preventDefault();
    },
    true,
  );
});
