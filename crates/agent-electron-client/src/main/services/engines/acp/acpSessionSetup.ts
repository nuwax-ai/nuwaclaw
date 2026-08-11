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
 * 背景（2026-08-10 / 2026-08-11 日志）：同会话切换模型协议导致 agent engine 切换
 * （claude-code ↔ nuwaxcode）时，平台仍携带上一引擎的 sessionId 调用 session/load。
 * nuwaxcode(OpenCode) 对异引擎 UUID 会卡约 64–68s 才返回 `OpenCode service failure`。
 * 仅靠超时不够：超时不取消底层 RPC，随后 session/new 仍被卡住的 load 串行拖住
 * （实测 newSession completed ~49s）。故先按 id 形态拒绝跨引擎 load，再保留超时兜底。
 *
 * Session id 形态（启发式）：
 * - OpenCode / nuwaxcode：`ses_*`
 * - Claude Code：标准 UUID
 *
 * TODO(engine-switch-session) 剩余：
 * 1) 避免 tool_approval_rules 变更触发的二次整进程 reinit
 * 2) 修正 OpenCode 不支持的 setSessionMode(ask) 映射
 *    → 已澄清：agent_mode 不走 session/set_mode，只走本地权限审批
 * 3) 超时后若仍发出过 load：考虑重建 ACP 进程以真正掐断挂起 RPC
 */
export const LOAD_SESSION_TIMEOUT_MS = 15_000;

/** OpenCode / nuwaxcode 会话 id 前缀 */
const OPENCODE_SESSION_ID_RE = /^ses_/i;

export type SessionRestoredVia = "memory" | "resume" | "load" | "new";

/**
 * 判断 sessionId 是否适合在当前引擎上 session/load。
 * 不兼容时必须跳过 load（直接 newSession），避免向 OpenCode 发送异引擎 UUID 导致 ~1min 挂起。
 */
export function isSessionIdCompatibleWithEngine(
  sessionId: string,
  engineName: string,
): boolean {
  const id = sessionId.trim();
  if (!id) return false;

  const isOpenCodeSes = OPENCODE_SESSION_ID_RE.test(id);

  // nuwaxcode / OpenCode：只接受 ses_*；Claude UUID 会挂起数十秒
  if (engineName === "nuwaxcode") {
    return isOpenCodeSes;
  }

  // claude-code：拒绝明确的 OpenCode ses_*；其它形态（含 UUID）允许尝试
  if (engineName === "claude-code") {
    return !isOpenCodeSes;
  }

  // codex / 自定义等：形态未知，交给 load + 超时兜底
  return true;
}

/**
 * 给 promise 加超时；超时 reject，不取消底层 RPC（ACP 无 abort 时仍可最终返回，仅不再阻塞 chat 路径）。
 * 注意：若已发出 load RPC，同连接上的 newSession 仍可能被引擎侧串行拖住——故跨引擎应先跳过 load。
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
  /** 当前 ACP 引擎名（claude-code / nuwaxcode / codex…），用于跨引擎 sessionId 形态校验 */
  engineName: string;
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
  /**
   * 启动路径诊断（[startup.diag] path=* 为 debug；汇总在 engine 侧 info）：
   * memory | skip_load→new | load | load_fail→new | new | no_load_cap→new
   */
  setupPath: string;
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
    log.debug(
      `${deps.logTag} [startup.diag] path=memory engine=${deps.engineName}`,
      {
        sessionId: memorySession.id,
      },
    );
    return {
      session: memorySession,
      isNewSession: false,
      restoredVia: "memory",
      setupPath: "memory",
    };
  }

  const { workDirId, projectDir } = buildWorkDirAndProjectDir(deps, request);
  const sessionOpts: NewSessionOpts = {
    title: workDirId,
    cwd: projectDir,
    systemPrompt: sessionOptsExtras?.systemPrompt,
    requestId: sessionOptsExtras?.requestId,
  };

  let setupPath: string = "new";

  if (request.session_id && supportsLoadSession(deps.agentCapabilities)) {
    // 跨引擎：异形态 sessionId 直接跳过 load，避免发出无法取消的挂起 RPC
    const compatible = isSessionIdCompatibleWithEngine(
      request.session_id,
      deps.engineName,
    );
    if (!compatible) {
      setupPath = "skip_load→new";
      log.warn(
        `${deps.logTag} Skip session/load: sessionId shape incompatible with engine=${deps.engineName} (session_id=${request.session_id}); using newSession`,
      );
      log.debug(
        `${deps.logTag} [startup.diag] path=skip_load→new engine=${deps.engineName}`,
        {
          prevSessionId: request.session_id,
          compatible: false,
        },
      );
    } else {
      try {
        log.info(
          `${deps.logTag} Loading ACP session (suppress SSE history replay): ${request.session_id}`,
        );
        log.debug(
          `${deps.logTag} [startup.diag] path=load engine=${deps.engineName}`,
          {
            prevSessionId: request.session_id,
            compatible: true,
          },
        );
        // 同引擎但仍可能挂起时的兜底；跨引擎应已被上方形态校验挡住
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
          setupPath: "load",
        };
      } catch (err) {
        setupPath = "load_fail→new";
        log.warn(
          `${deps.logTag} loadSession failed for ${request.session_id}, falling back to newSession:`,
          err,
        );
        log.debug(
          `${deps.logTag} [startup.diag] path=load_fail→new engine=${deps.engineName}`,
          {
            prevSessionId: request.session_id,
            error: err instanceof Error ? err.message : String(err),
          },
        );
      }
    }
  } else if (request.session_id) {
    setupPath = "no_load_cap→new";
    log.warn(
      `${deps.logTag} Agent does not support session/load; using newSession for session_id=${request.session_id}`,
    );
    log.debug(
      `${deps.logTag} [startup.diag] path=no_load_cap→new engine=${deps.engineName}`,
      { prevSessionId: request.session_id },
    );
  } else {
    log.debug(
      `${deps.logTag} [startup.diag] path=new engine=${deps.engineName}`,
      { reason: "no_session_id" },
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
    setupPath,
  };
}
