import { ipcMain, shell, session as electronSession, app } from "electron";
import { spawn } from "child_process";
import { stat } from "fs/promises";
import * as path from "path";
import log from "electron-log";
import { STORAGE_KEYS } from "@shared/constants";
import { getDomainTokenKey } from "@shared/utils/domain";
import { readSetting } from "../db";

/**
 * agent-workbench 内嵌 <webview> 的 partition。
 * 显式持久化命名（persist: 前缀），与主窗口的 defaultSession 隔离，
 * 同时保留站点 cookie/localStorage 跨重启生效。
 */
const WORKBENCH_PREVIEW_PARTITION = "persist:workbench-preview";

export type WorkbenchOpenedBy = "cursor" | "vscode" | "system";

export type OpenEditorResult =
  | { success: true; openedBy: WorkbenchOpenedBy }
  | { success: false; error: string };

type EditorCandidate = {
  command: string;
  args: string[];
  openedBy: Exclude<WorkbenchOpenedBy, "system">;
};

const EDITOR_COMMAND_TIMEOUT_MS = 8_000;

function getEditorCandidates(workspaceDir: string): EditorCandidate[] {
  if (process.platform === "darwin") {
    return [
      {
        command: "/usr/bin/open",
        args: ["-a", "Cursor", workspaceDir],
        openedBy: "cursor",
      },
      {
        command: "/usr/bin/open",
        args: ["-a", "Visual Studio Code", workspaceDir],
        openedBy: "vscode",
      },
      { command: "cursor", args: [workspaceDir], openedBy: "cursor" },
      { command: "code", args: [workspaceDir], openedBy: "vscode" },
    ];
  }

  return [
    { command: "cursor", args: [workspaceDir], openedBy: "cursor" },
    { command: "code", args: [workspaceDir], openedBy: "vscode" },
  ];
}

function getEditorEnv(): NodeJS.ProcessEnv {
  const pathDelimiter = process.platform === "win32" ? ";" : ":";
  const fallbackPaths =
    process.platform === "win32"
      ? [
          process.env.SystemRoot
            ? path.join(process.env.SystemRoot, "System32")
            : "",
          process.env.SystemRoot ?? "",
        ]
      : [
          "/usr/local/bin",
          "/opt/homebrew/bin",
          "/usr/bin",
          "/bin",
          "/usr/sbin",
          "/sbin",
        ];
  const existingPath = process.env.PATH ?? "";
  const mergedPath = [existingPath, ...fallbackPaths.filter(Boolean)]
    .filter(Boolean)
    .join(pathDelimiter);

  return {
    ...process.env,
    PATH: mergedPath,
  };
}

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function runEditorCommand(candidate: EditorCandidate): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(candidate.command, candidate.args, {
      env: getEditorEnv(),
      shell: false,
      stdio: "ignore",
      windowsHide: true,
    });

    const timer = setTimeout(() => {
      child.kill();
      reject(
        new Error(
          `${candidate.command} timed out after ${EDITOR_COMMAND_TIMEOUT_MS}ms`,
        ),
      );
    }, EDITOR_COMMAND_TIMEOUT_MS);

    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });

    child.once("close", (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${candidate.command} exited with code ${code}`));
    });
  });
}

function getConfiguredWorkspaceDir(): string | null {
  const step1Config = readSetting(STORAGE_KEYS.STEP1_CONFIG) as {
    workspaceDir?: unknown;
  } | null;
  return typeof step1Config?.workspaceDir === "string"
    ? step1Config.workspaceDir
    : null;
}

async function resolveConfiguredWorkspaceDir(): Promise<string> {
  const workspaceDir = getConfiguredWorkspaceDir();
  if (!workspaceDir) {
    throw new Error("Configured workspace directory is required");
  }

  const resolvedWorkspaceDir = path.resolve(workspaceDir);
  const stats = await stat(resolvedWorkspaceDir);
  if (!stats.isDirectory()) {
    throw new Error("Configured workspace path is not a directory");
  }
  return resolvedWorkspaceDir;
}

export async function openWorkbenchEditor(): Promise<OpenEditorResult> {
  let resolvedWorkspaceDir: string;
  try {
    resolvedWorkspaceDir = await resolveConfiguredWorkspaceDir();
  } catch (error) {
    return { success: false, error: formatError(error) };
  }

  const editorErrors: string[] = [];

  for (const candidate of getEditorCandidates(resolvedWorkspaceDir)) {
    try {
      await runEditorCommand(candidate);
      return { success: true, openedBy: candidate.openedBy };
    } catch (error) {
      const message = formatError(error);
      editorErrors.push(`${candidate.command}: ${message}`);
      log.debug(
        `[IPC] workbench:openEditor candidate failed (${candidate.openedBy}): ${message}`,
      );
    }
  }

  try {
    const openResult = await shell.openPath(resolvedWorkspaceDir);
    if (openResult) {
      return {
        success: false,
        error: [openResult, ...editorErrors].join("; "),
      };
    }
    return { success: true, openedBy: "system" };
  } catch (error) {
    log.error("[IPC] workbench:openEditor shell fallback failed:", error);
    return {
      success: false,
      error: [formatError(error), ...editorErrors].join("; "),
    };
  }
}

/**
 * 解析 workbench preview webview 使用的 preload 脚本绝对路径。
 *
 * 路径约定：preload 由 `tsc -p tsconfig.main.json` 编译到 dist/preload/。
 * main 脚本运行时 `__dirname` 指向 dist/main/，所以向上一级再进入 preload/。
 * 该约定在 dev / 打包后 (app.asar) 均成立。
 */
export function getWorkbenchPreviewPreloadPath(): string {
  return path.join(__dirname, "..", "preload", "workbenchPreview.js");
}

export function getWorkbenchPreviewPartition(): string {
  return WORKBENCH_PREVIEW_PARTITION;
}

/** 从 settings 中读取当前可用 token（与 webview:openWindow 同源逻辑的简化版） */
function readCachedSessionToken(url?: string): string | null {
  try {
    const oneShot = readSetting("auth.token");
    if (typeof oneShot === "string" && oneShot.length > 0) {
      return oneShot;
    }
    if (url) {
      const domainKey = getDomainTokenKey(url);
      const domainToken = readSetting(domainKey);
      if (typeof domainToken === "string" && domainToken.length > 0) {
        return domainToken;
      }
    }
  } catch (error) {
    log.warn("[IPC] workbench:getPreviewSessionToken read failed:", error);
  }
  return null;
}

function isHttpUrl(url: string): boolean {
  try {
    return /^https?:$/.test(new URL(url).protocol);
  } catch {
    return false;
  }
}

async function injectCookiesToPartition(params: {
  url: string;
  partition?: string;
}): Promise<{ injected: boolean; reason?: string }> {
  if (!isHttpUrl(params.url)) {
    return { injected: false, reason: "non-http-url" };
  }
  const token = readCachedSessionToken(params.url);
  if (!token) {
    return { injected: false, reason: "no-token" };
  }
  const targetSession = electronSession.fromPartition(
    params.partition ?? WORKBENCH_PREVIEW_PARTITION,
  );
  try {
    await targetSession.cookies.set({
      url: params.url,
      name: "ticket",
      value: token,
      path: "/",
      httpOnly: true,
      secure: params.url.startsWith("https://"),
      sameSite: params.url.startsWith("https://")
        ? "no_restriction"
        : undefined,
    });
    await targetSession.cookies.flushStore();
    return { injected: true };
  } catch (error) {
    log.error("[IPC] workbench:injectPreviewCookies failed:", error);
    return { injected: false, reason: formatError(error) };
  }
}

export function registerWorkbenchHandlers(): void {
  ipcMain.handle("workbench:openEditor", async () => {
    try {
      return await openWorkbenchEditor();
    } catch (error) {
      log.error("[IPC] workbench:openEditor failed:", error);
      return { success: false, error: formatError(error) };
    }
  });

  // 暴露 preview webview 使用的 preload 脚本路径，供 renderer 拼装 <webview preload="..." />
  ipcMain.handle("workbench:getPreviewPreloadPath", async () => {
    try {
      const preloadPath = getWorkbenchPreviewPreloadPath();
      // 用 file:// URL 形式返回，Electron <webview preload> 接受 file URL
      // app.isPackaged 时路径位于 app.asar 内部，pathToFileURL 处理 windows 反斜杠
      return {
        success: true,
        path: preloadPath,
        url: pathToFileUrl(preloadPath),
        partition: WORKBENCH_PREVIEW_PARTITION,
        // 给调试用，渲染端不应依赖
        isPackaged: app.isPackaged,
      };
    } catch (error) {
      log.error("[IPC] workbench:getPreviewPreloadPath failed:", error);
      return { success: false, error: formatError(error) };
    }
  });

  // preview webview guest 启动时请求拿 session token
  ipcMain.handle(
    "workbench:getPreviewSessionToken",
    async (_event, params?: { url?: string }) => {
      try {
        const token = readCachedSessionToken(params?.url);
        return { success: true, token };
      } catch (error) {
        log.error("[IPC] workbench:getPreviewSessionToken failed:", error);
        return { success: false, token: null, error: formatError(error) };
      }
    },
  );

  // preview webview guest 启动时调用，将 ticket cookie 注入 partition
  ipcMain.handle(
    "workbench:injectPreviewCookies",
    async (_event, params: { url: string; partition?: string }) => {
      try {
        const result = await injectCookiesToPartition(params);
        if (result.injected) {
          log.debug("[IPC] workbench:injectPreviewCookies success", {
            url: params.url,
            partition: params.partition ?? WORKBENCH_PREVIEW_PARTITION,
          });
        }
        return { success: true, ...result };
      } catch (error) {
        log.error("[IPC] workbench:injectPreviewCookies failed:", error);
        return { success: false, error: formatError(error) };
      }
    },
  );

  // preview webview 拦截下载（or renderer host bridge 转发），用 shell.openExternal 兜底
  ipcMain.on(
    "workbench:notifyPreviewDownload",
    (_event, params: { url: string; filename?: string }) => {
      try {
        if (!params || !isHttpUrl(params.url)) {
          return;
        }
        log.info("[IPC] workbench:notifyPreviewDownload", {
          url: params.url,
          filename: params.filename,
        });
        void shell.openExternal(params.url);
      } catch (error) {
        log.warn(
          "[IPC] workbench:notifyPreviewDownload openExternal failed:",
          error,
        );
      }
    },
  );
}

/** 将本地绝对路径转 file:// URL，跨平台安全 */
function pathToFileUrl(absPath: string): string {
  // 不使用 url.pathToFileURL 来避免引入额外依赖；手动转义
  const normalized = absPath.replace(/\\/g, "/");
  const prefix = normalized.startsWith("/") ? "file://" : "file:///";
  return prefix + normalized.replace(/ /g, "%20");
}
