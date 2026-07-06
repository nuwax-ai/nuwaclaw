/**
 * deepagents-flow-ts 将会话状态存在 ACP 进程的 isolated HOME：
 *   {isolatedHome}/.flowagents/sessions/...
 * auto_reload 销毁引擎时会删除 isolatedHome，需在销毁前归档到项目 cwd，并在 load/resume 前恢复。
 */

import * as fs from "fs";
import * as path from "path";
import log from "electron-log";

const FLOWAGENTS_SESSIONS_SEGMENTS = [".flowagents", "sessions"] as const;

function flowagentsSessionsDir(root: string): string {
  return path.join(root, ...FLOWAGENTS_SESSIONS_SEGMENTS);
}

function copyDirMerge(src: string, dest: string): void {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dest, { recursive: true });
  fs.cpSync(src, dest, { recursive: true, force: true });
}

/** reload 前：isolated HOME → 项目工作目录（跨进程持久化） */
export function archiveFlowagentsSessions(
  isolatedHome: string | null | undefined,
  projectDir: string,
): void {
  if (!isolatedHome || !projectDir) return;
  const src = flowagentsSessionsDir(isolatedHome);
  if (!fs.existsSync(src)) return;
  const dest = flowagentsSessionsDir(projectDir);
  try {
    copyDirMerge(src, dest);
    log.info(`[FlowagentsSession] Archived sessions: ${src} → ${dest}`);
  } catch (err) {
    log.warn("[FlowagentsSession] Archive failed (non-blocking):", err);
  }
}

/** load/resume 前：项目工作目录 → 新进程的 isolated HOME */
export function restoreFlowagentsSessions(
  isolatedHome: string | null | undefined,
  projectDir: string,
): void {
  if (!isolatedHome || !projectDir) return;
  const src = flowagentsSessionsDir(projectDir);
  if (!fs.existsSync(src)) return;
  const dest = flowagentsSessionsDir(isolatedHome);
  try {
    copyDirMerge(src, dest);
    log.info(`[FlowagentsSession] Restored sessions: ${src} → ${dest}`);
  } catch (err) {
    log.warn("[FlowagentsSession] Restore failed:", err);
    throw err;
  }
}
