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

export type SessionRestoredVia = "memory" | "resume" | "load" | "new";

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
      const loaded = await deps.loadSession(request.session_id, sessionOpts);
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
