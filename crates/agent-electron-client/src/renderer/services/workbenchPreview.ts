/**
 * Agent Workbench 自定义页面预览：在 Electron <webview> 加载前同步 ticket cookie。
 * 复用与 EmbeddedWebview / ClientPage 相同的 session:setCookie 语义。
 */

import { syncSessionCookie } from "./utils/sessionUrl";

/** 解析写入 cookie 时使用的 URL（host-only，与 sessionUrl 一致）。 */
export function resolvePreviewCookieUrl(
  baseUrl: string,
  previewUrl: string,
): string {
  const trimmedBase = baseUrl.replace(/\/+$/, "");
  try {
    const parsed = new URL(previewUrl);
    if (/^https?:$/i.test(parsed.protocol)) {
      return parsed.origin;
    }
  } catch {
    /* fall through */
  }
  return trimmedBase;
}

/**
 * 在 workbench 页面预览 webview 导航前，将 access token 写入 defaultSession 的 ticket cookie。
 * 失败时仅记录日志，不阻断预览打开（与 syncCookieAndBuildUrl 失败保留 token 策略一致）。
 */
export async function prepareWorkbenchPreviewSession(
  baseUrl: string,
  previewUrl: string,
  accessToken: string,
): Promise<void> {
  const token = accessToken.trim();
  if (!token || !baseUrl.trim() || !previewUrl.trim()) {
    return;
  }

  const cookieUrl = resolvePreviewCookieUrl(baseUrl, previewUrl);
  if (!cookieUrl) {
    return;
  }

  try {
    await syncSessionCookie(cookieUrl, token);
  } catch (error) {
    console.warn(
      "[WorkbenchPreview] Failed to sync ticket cookie before preview:",
      error instanceof Error ? error.message : String(error),
    );
  }
}
