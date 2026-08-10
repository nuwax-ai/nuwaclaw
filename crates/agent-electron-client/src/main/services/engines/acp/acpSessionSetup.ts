/**
 * ACP session resolution for chat: memory → load → newSession.
 * Cross-process restore uses session/load only (aligned with rcoder); SSE replay
 * is suppressed in acpEngine.loadAcpSession during load.
 */

import log from "electron-log";
import type { ComputerChatRequest } from "@shared/types/computerTypes";
import { resolveComputerProjectWorkspaceDir } from "../../workspacePaths";
import type { NewSessionOpts } from "./acpNewSessionParams";
import { supportsLoadSession } from "./acpAgentCapabilities";

/**
 * loadSession 超时后走 newSession fallback，避免跨引擎/无效 sessionId 时长时间卡住。
 *
 * 背景（2026-08-10 测试日志）：同会话切换模型协议导致 agent engine 切换
 * （claude-code ↔ nuwaxcode）时，平台仍携带上一引擎的 sessionId 调用 session/load。
 * nuwaxcode(OpenCode) 对异引擎 UUID 会卡约 64–68s 才返回
 * `OpenCode service failure`，体感「约 1 分钟才启动」；claude-code 对异引擎
 * `ses_*` 约 1s 即失败，故不对称。完整方案（按引擎绑定 session、切换时跳过 load）
 * 尚未落地，先用超时兜底把最坏路径从 ~65s 压到本阈值。
 *
 * TODO(engine-switch-session): 正式方案落地后可缩短/移除该超时：
 * 1) 会话与 engine 绑定（或识别 id 形态 ses_* vs UUID），跨引擎禁止 loadSession，直接 newSession
 * 2) 避免 tool_approval_rules 变更触发的二次整进程 reinit
 * 3) 修正 OpenCode 不支持的 setSessionMode(ask) 映射
 */
export const LOAD_SESSION_TIMEOUT_MS = 15_000;

export type SessionRestoredVia = "memory" | "resume" | "load" | "new";

/**
 * 给 promise 加超时；超时 reject，不取消底层 RPC（ACP 无 abort 时仍可最终返回，仅不再阻塞 chat 路径）。
 */
function withLoadSessionTimeout<T>(
  promise: Promise<T>,
  ms: number,
  sessionId: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(
        new Error(
          `loadSession timed out after ${ms}ms (sessionId=${sessionId})`,
        ),
      );
    }, ms);
    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}

export interface AcpSessionLike {
  id: string;
  acpSessionId?: string;
  cwd?: string;
  title?: string;
  projectId?: string;
  createdAt: number;
  status: string;
}

export interface SessionSetupDeps {
  logTag: string;
  workspaceDir: string;
  agentCapabilities: Record<string, unknown> | null;
  getSession(sessionId: string): AcpSessionLike | undefined;
  findSessionByProjectId(projectId: string): AcpSessionLike | null;
  loadSession(sessionId: string, opts: NewSessionOpts): Promise<AcpSessionLike>;
  createSession(opts: NewSessionOpts): Promise<{ id: string }>;
  getSessionRecord(id: string): AcpSessionLike;
}

export interface SessionSetupResult {
  session: AcpSessionLike;
  isNewSession: boolean;
  restoredVia: SessionRestoredVia;
}

function buildWorkDirAndProjectDir(
  deps: SessionSetupDeps,
  request: ComputerChatRequest,
): { workDirId: string; projectDir: string } {
  const workDirId =
    request.agent_work_dir || request.project_id || `proj-${Date.now()}`;
  const projectDir = resolveComputerProjectWorkspaceDir(
    deps.workspaceDir,
    request.user_id,
    workDirId,
  );
  return { workDirId, projectDir };
}

function findSessionInMemory(
  deps: SessionSetupDeps,
  request: ComputerChatRequest,
): AcpSessionLike | undefined {
  if (request.session_id) {
    const byId = deps.getSession(request.session_id);
    if (byId) return byId;
  }
  if (request.agent_work_dir) {
    const byWorkDir = deps.findSessionByProjectId(request.agent_work_dir);
    if (byWorkDir) return byWorkDir;
  }
  if (request.project_id) {
    const byProject = deps.findSessionByProjectId(request.project_id);
    if (byProject) return byProject;
  }
  return undefined;
}

export async function resolveSessionForChat(
  deps: SessionSetupDeps,
  request: ComputerChatRequest,
  sessionOptsExtras?: Pick<NewSessionOpts, "systemPrompt" | "requestId">,
): Promise<SessionSetupResult> {
  const memorySession = findSessionInMemory(deps, request);
  if (memorySession) {
    return {
      session: memorySession,
      isNewSession: false,
      restoredVia: "memory",
    };
  }

  const { workDirId, projectDir } = buildWorkDirAndProjectDir(deps, request);
  const sessionOpts: NewSessionOpts = {
    title: workDirId,
    cwd: projectDir,
    systemPrompt: sessionOptsExtras?.systemPrompt,
    requestId: sessionOptsExtras?.requestId,
  };

  if (request.session_id && supportsLoadSession(deps.agentCapabilities)) {
    try {
      log.info(
        `${deps.logTag} Loading ACP session (suppress SSE history replay): ${request.session_id}`,
      );
      // 见文件头 TODO(engine-switch-session)：跨引擎 load 可能挂起 ~65s，先 15s 超时再 fallback
      const loaded = await withLoadSessionTimeout(
        deps.loadSession(request.session_id, sessionOpts),
        LOAD_SESSION_TIMEOUT_MS,
        request.session_id,
      );
      loaded.projectId = request.agent_work_dir || request.project_id;
      return {
        session: loaded,
        isNewSession: false,
        restoredVia: "load",
      };
    } catch (err) {
      log.warn(
        `${deps.logTag} loadSession failed for ${request.session_id}, falling back to newSession:`,
        err,
      );
    }
  } else if (request.session_id) {
    log.warn(
      `${deps.logTag} Agent does not support session/load; using newSession for session_id=${request.session_id}`,
    );
  }

  log.info(`${deps.logTag} 📁 Project workspace: ${projectDir}`);
  const created = await deps.createSession(sessionOpts);
  const session = deps.getSessionRecord(created.id);
  session.projectId = request.agent_work_dir || request.project_id;
  return {
    session,
    isNewSession: true,
    restoredVia: "new",
  };
}
