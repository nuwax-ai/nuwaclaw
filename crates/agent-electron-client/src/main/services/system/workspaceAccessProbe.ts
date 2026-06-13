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
 * 用法：
 * - 启动期(提前检查)：ensureWorkspaceChildAccess(workspaceDir) 异步触发，被拦则弹窗。
 * - 引擎创建前(兜底)：await ensureWorkspaceChildAccess(...)，被拦则中止并报清晰错误。
 */

import { spawn } from "child_process";
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

/** 成功结果缓存(按 workspaceDir)。失败不缓存，授权后下次探测自动恢复。 */
const okCache = new Set<string>();
/** 本会话已弹过窗的目录(避免反复打扰)。app 重启后随进程消失而重置。 */
const prompted = new Set<string>();

export type WorkspaceAccessReason =
  | "child_cwd_blocked"
  | "no_probe_binary"
  | "not_macos"
  | "spawn_failed";

export interface WorkspaceAccessResult {
  ok: boolean;
  reason?: WorkspaceAccessReason;
  /** 本次是否弹出了授权对话框 */
  prompted?: boolean;
}

/**
 * 探测：子进程能否以 workspaceDir 为 cwd 调用 process.cwd()。
 * 仅 macOS 有意义；其他平台直接放行。成功结果会被缓存。
 */
export async function probeWorkspaceChildCwdAccess(
  workspaceDir: string,
): Promise<WorkspaceAccessResult> {
  if (!workspaceDir) return { ok: true };
  if (!isMacOS()) return { ok: true, reason: "not_macos" };
  if (okCache.has(workspaceDir)) return { ok: true };

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
    const timer = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        /* ignore */
      }
      resolve({ ok: false, reason: "spawn_failed" });
    }, PROBE_TIMEOUT_MS);
    child.on("error", (err) => {
      clearTimeout(timer);
      log.warn(`[WorkspaceAccess] probe spawn error: ${err.message}`);
      resolve({ ok: false, reason: "spawn_failed" });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      // exit 0 = 子进程能访问 cwd；非 0(EPERM 走 exit 2，或 Node bootstrap 崩) = 被拦
      if (code === 0) {
        okCache.add(workspaceDir);
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
 * 探测 + 必要时弹窗引导授权。返回是否放行。
 * 每个目录每会话最多弹一次窗；探测失败不缓存，授权后自动恢复。
 */
export async function ensureWorkspaceChildAccess(
  workspaceDir: string,
): Promise<WorkspaceAccessResult> {
  const result = await probeWorkspaceChildCwdAccess(workspaceDir);
  if (result.ok) return result;

  if (!prompted.has(workspaceDir)) {
    prompted.add(workspaceDir);
    result.prompted = true;
    await showWorkspaceAccessDialog(workspaceDir).catch((e) =>
      log.error("[WorkspaceAccess] dialog failed:", e),
    );
  }
  return result;
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

/** 失效缓存(工作区目录变更/重置时调用)。不传则清空全部。 */
export function invalidateWorkspaceAccessCache(workspaceDir?: string): void {
  if (workspaceDir) {
    okCache.delete(workspaceDir);
    prompted.delete(workspaceDir);
  } else {
    okCache.clear();
    prompted.clear();
  }
}
