/**
 * nuwax webview ↔ nuwaclaw 壳的桥后端。
 *
 * - auth:getToken / auth:persistToken / auth:clear
 *     nuwax 用 localStorage.ACCESS_TOKEN（Authorization header）鉴权，非 cookie。
 *     这里把 token 按 webview 来源 origin 持久化到 settings 表（键 nuwax.accessToken.<origin>），
 *     与 sandbox ticket 隔离，实现「重启免登 / 登录持久化 / 登出联动」。
 * - native:saveImage
 *     右键另存图片：系统保存对话框 + net.fetch（走 defaultSession，携带登录态 cookie）写盘。
 *
 * 桥前端：preload/webviewPerfBridge.ts（注入到所有 http/https webview guest）。
 * 注册入口：ipc/index.ts 的 registerAllHandlers。
 */
import { ipcMain, dialog, net } from "electron";
import type { IpcMainInvokeEvent } from "electron";
import * as fs from "fs";
import * as path from "path";
import log from "electron-log";
import type { HandlerContext } from "@shared/types/ipc";
import { readSetting, writeSetting } from "../db";

/** nuwax ACCESS_TOKEN 存储键前缀，按来源 origin 分域，避免污染 sandbox ticket。 */
const NUWAX_TOKEN_KEY_PREFIX = "nuwax.accessToken.";

/** 从 IPC 调用方（webview guest）解析来源 origin 作为 token 存储作用域。 */
function resolveSenderOrigin(event: IpcMainInvokeEvent): string {
  const url = event.senderFrame?.url || event.sender?.getURL?.() || "";
  try {
    return url ? new URL(url).origin : "global";
  } catch {
    return "global";
  }
}

function tokenKey(scope: string): string {
  return `${NUWAX_TOKEN_KEY_PREFIX}${scope}`;
}

export function registerNuwaxBridgeHandlers(ctx: HandlerContext): void {
  // ---- auth：ACCESS_TOKEN 双向同步 ----
  ipcMain.handle("auth:getToken", (event) => {
    const scope = resolveSenderOrigin(event);
    const value = readSetting(tokenKey(scope));
    log.debug("[NuwaxBridge] auth:getToken", { scope, hasToken: !!value });
    return typeof value === "string" ? value : null;
  });

  ipcMain.handle("auth:persistToken", (event, token: unknown) => {
    const scope = resolveSenderOrigin(event);
    if (typeof token !== "string" || !token) return false;
    writeSetting(tokenKey(scope), token);
    log.info("[NuwaxBridge] auth:persistToken saved", { scope });
    return true;
  });

  ipcMain.handle("auth:clear", (event) => {
    const scope = resolveSenderOrigin(event);
    writeSetting(tokenKey(scope), null);
    log.info("[NuwaxBridge] auth:clear", { scope });
    return true;
  });

  // ---- native：右键另存图片 ----
  ipcMain.handle(
    "native:saveImage",
    async (_event, opts: { url: string; filename?: string }) => {
      try {
        const { url, filename } = opts || {};
        if (typeof url !== "string" || !/^https?:\/\//i.test(url)) {
          return { success: false, error: "invalid url" };
        }

        // 默认文件名：URL 末段；非法文件名字符替换为下划线；无扩展名补 .png
        const derived =
          filename ||
          decodeURIComponent(url.split("?")[0].split("/").pop() || "") ||
          "image";
        const safeName = derived.replace(/[\\/:*?"<>|]/g, "_").slice(0, 120);
        const ext = path.extname(safeName) ? "" : ".png";
        const defaultPath = `${safeName}${ext}`;

        const win = ctx.getMainWindow();
        const res = win
          ? await dialog.showSaveDialog(win, { defaultPath })
          : await dialog.showSaveDialog({ defaultPath });
        if (res.canceled || !res.filePath) {
          return { success: false, canceled: true };
        }

        // net.fetch 走 defaultSession（与 webview 同会话，携带登录态 cookie）
        const resp = await net.fetch(url, { method: "GET" });
        if (!resp.ok) {
          return { success: false, error: `http ${resp.status}` };
        }
        const buf = Buffer.from(await resp.arrayBuffer());
        fs.writeFileSync(res.filePath, buf);
        log.info("[NuwaxBridge] native:saveImage saved", {
          url,
          path: res.filePath,
          bytes: buf.length,
        });
        return { success: true, path: res.filePath };
      } catch (error) {
        log.error("[NuwaxBridge] native:saveImage failed", error);
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
  );
}
