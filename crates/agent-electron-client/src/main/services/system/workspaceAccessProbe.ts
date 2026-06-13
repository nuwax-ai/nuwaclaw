/**
 * 工作区目录权限探测 + 授权引导 (macOS TCC)
 *
 * 背景：
 * 引擎子进程(nuwaxcode 原生二进制 / bundled node 跑 claude-code-acp-ts)由 Electron 派生，
 * 若其 cwd 落在 macOS TCC 保护目录(~/Downloads、~/Documents、~/Desktop)且未授权，
 * 子进程 process.cwd()/getcwd() 会抛 EPERM，引擎启动即崩
 * (nuwaxcode: "An unknown error occurred"; claude-code: "uv_cwd EPERM")。
 *
 * 主进程自身能访问该目录(通常是它创建的)，所以 fs.access 测不出子进程的拦截 ——
 * 必须"以该目录为 cwd 派生一个子进程"才能真实复现。这里用 bundled node 复现：
 * 它与 claude-code-acp-ts 走同一个二进制签名上下文，是 claude-code 失败路径的忠实代理；
 * nuwaxcode 同为 Electron 派生的 adhoc 子进程，TCC 上下文一致，可一并覆盖。
 *
 * 关键设计：
 * - 成功结果不缓存：TCC 授权可能在会话中途被撤销(如使用 chrome-devtools 后)，
 *   缓存会让守卫漏掉这种中途失效。每次 gate 重新探测(~50ms，每项目一次，可接受)。
 * - gate 路径不 await 弹窗：弹窗异步触发，请求立即抛清晰错误，避免在 HTTP 请求路径里挂起。
 * - 区分"目录不存在"与"TCC 拦截"：主进程 existsSync 对两者能区分(被 TCC 拦时主进程仍可见)。
 */

import { spawn } from "child_process";
import * as fs from "fs";
import { BrowserWindow, dialog, shell } from "electron";
import log from "electron-log";
import { getNodeBinPath } from "./binaryLocator";
import { isMacOS } from "./shellEnv";
import { t } from "../i18n";

/** 子进程探测脚本：process.cwd() 成功 → exit 0；EPERM/异常 → exit 2。 */
const PROBE_SCRIPT =
  "try{process.cwd();process.exit(0)}catch(e){process.exit(2)}";

/** 探测超时(ms)。正常 <100ms，给 5s 余量应对系统繁忙。 */
const PROBE_TIMEOUT_MS = 5000;

/** 完全磁盘访问权限 系统设置 URL (与 appHandlers permissions:openSettings 一致) */
const FULL_DISK_ACCESS_URL =
  "x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles";

/** 本会话已弹过窗的目录(避免反复打扰)。has+add 连续同步，单线程下原子，无 TOCTOU。app 重启后重置。 */
const prompted = new Set<string>();

export type WorkspaceAccessReason =
  | "missing_dir"
  | "child_cwd_blocked"
  | "no_probe_binary"
  | "not_macos"
  | "spawn_failed";

export interface WorkspaceAccessResult {
  ok: boolean;
  reason?: WorkspaceAccessReason;
}

/**
 * 探测：子进程能否以 workspaceDir 为 cwd 调用 process.cwd()。
 * 仅 macOS 有意义；其他平台直接放行。成功结果不缓存(见文件头设计说明)。
 */
export async function probeWorkspaceChildCwdAccess(
  workspaceDir: string,
): Promise<WorkspaceAccessResult> {
  if (!workspaceDir) return { ok: true };
  if (!isMacOS()) return { ok: true, reason: "not_macos" };

  // 先区分"目录不存在"与"TCC 拦截"：被 TCC 拦时主进程仍能看到目录；目录真没了则看不到。
  if (!fs.existsSync(workspaceDir)) {
    return { ok: false, reason: "missing_dir" };
  }

  const node = getNodeBinPath();
  if (!node) {
    // 没有探测工具就不阻塞业务，仅记录。
    log.warn("[WorkspaceAccess] bundled node not found, skip probe");
    return { ok: true, reason: "no_probe_binary" };
  }

  return new Promise((resolve) => {
    const child = spawn(node, ["-e", PROBE_SCRIPT], {
      cwd: workspaceDir,
      stdio: ["ignore", "ignore", "pipe"],
      windowsHide: true,
    });
    let stderr = "";
    child.stderr?.on("data", (d: Buffer) => {
      stderr += d.toString();
    });
    // settled 守卫：超时/error/close 可能交错触发，保证只 resolve 一次，避免重复日志。
    let settled = false;
    const timer = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        /* ignore */
      }
      if (settled) return;
      settled = true;
      resolve({ ok: false, reason: "spawn_failed" });
    }, PROBE_TIMEOUT_MS);
    child.on("error", () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ok: false, reason: "spawn_failed" });
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      // exit 0 = 子进程能访问 cwd；非 0(EPERM 走 exit 2，或 Node bootstrap 崩) = 被拦
      if (code === 0) {
        resolve({ ok: true });
      } else {
        log.warn(
          `[WorkspaceAccess] child cwd probe BLOCKED: dir=${workspaceDir} code=${code} stderr=${stderr.trim().slice(0, 200)}`,
        );
        resolve({ ok: false, reason: "child_cwd_blocked" });
      }
    });
  });
}

/**
 * 弹窗引导授权，每个目录每会话最多一次。
 * has()+add() 连续同步语句，JS 单线程下原子，并发调用不会重复弹窗。
 */
async function promptWorkspaceAccessOnce(workspaceDir: string): Promise<void> {
  if (prompted.has(workspaceDir)) return;
  prompted.add(workspaceDir);
  try {
    await showWorkspaceAccessDialog(workspaceDir);
  } catch (e) {
    log.error("[WorkspaceAccess] dialog failed:", e);
  }
}

/**
 * 引擎创建前 gate 用：探测 + (被 TCC 拦时) 异步弹窗。
 * 弹窗不 await —— 调用方立即拿到结果，避免在 HTTP 请求路径里挂起等待用户点弹窗。
 * (missing_dir 不弹窗：那是目录缺失，不是权限问题。)
 */
export async function probeWorkspaceAccessWithPrompt(
  workspaceDir: string,
): Promise<WorkspaceAccessResult> {
  const result = await probeWorkspaceChildCwdAccess(workspaceDir);
  if (!result.ok && result.reason === "child_cwd_blocked") {
    void promptWorkspaceAccessOnce(workspaceDir);
  }
  return result;
}

/**
 * 启动期提前检查用：探测 + (被 TCC 拦时) 弹窗。可 await（不在 HTTP 请求路径）。
 */
export async function checkWorkspaceAccessAndPrompt(
  workspaceDir: string,
): Promise<void> {
  const result = await probeWorkspaceChildCwdAccess(workspaceDir);
  if (!result.ok && result.reason === "child_cwd_blocked") {
    await promptWorkspaceAccessOnce(workspaceDir);
  }
}

/** 弹出原生对话框，引导用户去「完全磁盘访问权限」授权。 */
async function showWorkspaceAccessDialog(workspaceDir: string): Promise<void> {
  const win = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed());
  const options: Electron.MessageBoxOptions = {
    type: "warning",
    title: t("Claw.WorkspaceAccess.title"),
    message: t("Claw.WorkspaceAccess.title"),
    detail: t("Claw.WorkspaceAccess.detail", workspaceDir),
    buttons: [
      t("Claw.WorkspaceAccess.openSettings"),
      t("Claw.WorkspaceAccess.later"),
    ],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
  };
  const res = win
    ? await dialog.showMessageBox(win, options)
    : await dialog.showMessageBox(options);
  if (res.response === 0) {
    await shell.openExternal(FULL_DISK_ACCESS_URL).catch(() => {});
  }
}
