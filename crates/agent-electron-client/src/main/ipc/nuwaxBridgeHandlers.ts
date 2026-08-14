/**
 * nuwax webview ↔ nuwaclaw 壳的桥后端。
 *
 * - auth:getToken / auth:persistToken / auth:clear
 *     nuwax 用 localStorage.ACCESS_TOKEN（Authorization header）鉴权，非 cookie。
 *     这里把 token 按 webview 来源 origin 持久化到 settings 表（键 nuwax.accessToken.<origin>），
 *     与 sandbox ticket 隔离，实现「重启免登 / 登录持久化 / 登出联动」。
 *     服务生命周期联动（Phase 2）：persistToken(≈登录成功) → best-effort 起服务；
 *     clear(≈登出 + 401 失效) → 停止全部本地服务。
 * - native:saveImage
 *     右键另存图片：系统保存对话框 + net.fetch（走 defaultSession，携带登录态 cookie）写盘。
 * - native:openWindow
 *     新开独立窗口打开 nuwax 站内页面（智能体详情/工作流/网页应用开发/我的电脑等
 *     全屏页）。带系统标题栏（零遮挡）+ 同一 webview 桥 preload；URL 追加 _shell=1
 *     让 nuwax 解除沉浸式门控。仅接受站内相对路径并校验同源。
 * - nuwax:theme-sync
 *     nuwax 女娲主题状态推送（{ active, 调色板 }）→ 转发 nuwax:theme-changed 给壳
 *     renderer，壳给自己的 antd tokens / CSS 变量叠加同套米白调色板（原生 UI 统一）。
 * - nuwax:layout-sync
 *     nuwax 布局状态推送（{ secondMenuAvailable }）→ 转发 nuwax:layout-changed 给壳
 *     renderer，工具栏据此显隐「收起二级菜单」按钮（无二级菜单的页面按钮无意义）。
 *
 * 桥前端：preload/webviewPerfBridge.ts（注入到所有 http/https webview guest）。
 * 注册入口：ipc/index.ts 的 registerAllHandlers。
 */
import { ipcMain, dialog, net, BrowserWindow } from "electron";
import type { IpcMainInvokeEvent } from "electron";
import * as fs from "fs";
import * as path from "path";
import log from "electron-log";
import type { HandlerContext } from "@shared/types/ipc";
import { readSetting, writeSetting } from "../db";
import {
  stopAllServicesNow,
  restartAllServicesNow,
  isAnyCoreServiceRunning,
} from "./processHandlers";

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

/** 桌面独立窗口注册表：持引用防 GC，closed 时清理。 */
const shellWindows = new Set<BrowserWindow>();

export function registerNuwaxBridgeHandlers(ctx: HandlerContext): void {
  // ---- theme：nuwax 女娲主题 → 壳原生 UI 统一 ----
  // nuwax 主题生效/让位时推送 { active, 调色板 }，转发给壳 renderer 叠加/回落
  // （antd tokens + CSS 变量）。fire-and-forget（send），无返回值语义。
  ipcMain.on("nuwax:theme-sync", (_event, payload: unknown) => {
    const safe =
      payload && typeof payload === "object"
        ? (payload as Record<string, unknown>)
        : null;
    if (!safe || typeof safe.active !== "boolean") return;
    ctx.getMainWindow()?.webContents.send("nuwax:theme-changed", safe);
  });

  // ---- layout：nuwax 布局状态 → 壳（如二级菜单存在性，工具栏据此显隐收起按钮） ----
  ipcMain.on("nuwax:layout-sync", (_event, payload: unknown) => {
    const safe =
      payload && typeof payload === "object"
        ? (payload as Record<string, unknown>)
        : null;
    if (!safe || typeof safe.secondMenuAvailable !== "boolean") return;
    ctx.getMainWindow()?.webContents.send("nuwax:layout-changed", {
      secondMenuAvailable: safe.secondMenuAvailable,
    });
  });

  // ---- auth：ACCESS_TOKEN 双向同步 ----
  ipcMain.handle("auth:getToken", (event) => {
    const scope = resolveSenderOrigin(event);
    const value = readSetting(tokenKey(scope));
    const loggedIn = typeof value === "string" && !!value;
    log.debug("[NuwaxBridge] auth:getToken", { scope, hasToken: loggedIn });

    // 顶栏登录态同步（以 webview 为最优先）：nuwax 启动 getInitialState 无条件调 getToken，
    // 是感知 webview 真实登录态最可靠的时机。
    // - token 在（重启免登态）→ 推 loggedIn:true。
    // - token 不在（webview 未登录）→ 推 loggedIn:false，纠正 nuwaclaw configKey 残留导致的
    //   「伪已登录」，使原生顶栏始终跟随 webview 实际状态。
    // （persistToken 只在 /Login 登录成功时触发，覆盖不了「启动即未登录」场景，故在此补全。）
    ctx.getMainWindow()?.webContents.send("nuwax:authChanged", { loggedIn });
    if (loggedIn) {
      log.info(
        "[NuwaxBridge] getToken → sync header loggedIn:true (relogin-free)",
      );
    } else {
      log.info(
        "[NuwaxBridge] getToken → sync header loggedIn:false (webview not logged in)",
      );
    }
    return typeof value === "string" ? value : null;
  });

  ipcMain.handle("auth:persistToken", (event, token: unknown) => {
    const scope = resolveSenderOrigin(event);
    if (typeof token !== "string" || !token) return false;
    writeSetting(tokenKey(scope), token);
    log.info("[NuwaxBridge] auth:persistToken saved", { scope });

    // 登录成功联动：best-effort 启动本地服务。仅在「当前无核心服务运行」时触发，
    // 避免已登录态下（如 token 刷新）重复 restart 打断在跑的会话。
    // 异步触发、不阻塞 persistToken 返回，保持 nuwax 登录即时跳转。
    // lanproxy 完整自起待 Phase 3 后端 reg 支持 token 鉴权后实现。
    if (!isAnyCoreServiceRunning()) {
      log.info("[NuwaxBridge] login → starting services (best-effort)");
      void restartAllServicesNow().catch((e) => {
        log.warn("[NuwaxBridge] login service start failed (ignored):", e);
      });
    } else {
      log.info("[NuwaxBridge] login → services already running, skip restart");
    }

    // 顶栏账号状态联动：登录成功 → 通知 renderer 顶栏切「已登录」态（跟随 nuwax token，
    // 而非 nuwaclaw 原生 configKey）。Phase 3 configKey 退役前，顶栏以此事件为准。
    ctx.getMainWindow()?.webContents.send("nuwax:authChanged", {
      loggedIn: true,
    });
    return true;
  });

  ipcMain.handle("auth:clear", async (event) => {
    const scope = resolveSenderOrigin(event);
    writeSetting(tokenKey(scope), null);
    log.info("[NuwaxBridge] auth:clear", { scope });

    // 登出 / token 失效（401）联动：停止全部本地服务。
    // 用户定：登出与失效都停服务。await 以确保重定向回 /Login 前服务确停；
    // stopAllServicesNow 内部对各进程有超时，整体有界，失败仅 warn 不影响 clear 结果。
    try {
      await stopAllServicesNow();
    } catch (e) {
      log.warn("[NuwaxBridge] logout/expiry service stop failed (ignored):", e);
    }

    // 顶栏账号状态联动：登出 / token 失效 → 通知 renderer 顶栏切「去登录」态。
    ctx.getMainWindow()?.webContents.send("nuwax:authChanged", {
      loggedIn: false,
    });
    return true;
  });

  // ---- native：新开独立窗口打开 nuwax 页面 ----
  // 智能体详情/工作流/网页应用开发/我的电脑等全屏页在主窗口会被沉浸式工具栏遮挡
  //（fixed 头部/画布类布局也无法内嵌避让），改为独立窗口承载：带系统标题栏零遮挡，
  // 注入同一 webview 桥 preload（isNuwaClaw/主题等桥能力一致），URL 追加 _shell=1
  // 标记让 nuwax 解除沉浸式专属门控（菜单避让/隐藏 logo）。
  ipcMain.handle("native:openWindow", (event, opts: { path?: unknown }) => {
    try {
      const raw = opts?.path;
      if (typeof raw !== "string" || !raw) {
        return { success: false, error: "invalid path" };
      }
      const base = event.senderFrame?.url || event.sender?.getURL?.() || "";
      if (!base) return { success: false, error: "sender url missing" };
      let target: URL;
      if (/^https?:\/\//i.test(raw)) {
        // 绝对 http(s) URL：外链（如导航"文档"），仅校验协议
        target = new URL(raw);
      } else if (raw.startsWith("/") && !raw.startsWith("//")) {
        // 站内相对路径：与发起 webview 同源拼接，杜绝任意源打开
        target = new URL(raw, base);
        if (target.origin !== new URL(base).origin) {
          return { success: false, error: "cross-origin blocked" };
        }
        // 独立窗口标记（nuwax 据此恢复浏览器式布局：显示 logo/收起按钮、不避让）
        target.searchParams.set("_shell", "1");
      } else {
        return { success: false, error: "invalid path" };
      }

      const win = new BrowserWindow({
        width: 1280,
        height: 832,
        autoHideMenuBar: true,
        webPreferences: {
          // 与 webview guest 同一桥 preload：NuwaClawBridge 全能力（auth/theme/layout）
          preload: path.join(
            __dirname,
            "..",
            "preload",
            "webviewPerfBridge.js",
          ),
        },
      });
      shellWindows.add(win);
      win.on("closed", () => shellWindows.delete(win));
      void win.loadURL(target.href);
      win.focus();
      log.info("[NuwaxBridge] native:openWindow", { path: raw });
      return { success: true };
    } catch (error) {
      log.error("[NuwaxBridge] native:openWindow failed", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
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
