/**
 * DevComputer auto_reload: stop existing ACP engine before chat so TS source changes apply.
 * No stability/mtime checks — only restarts when a running engine already exists.
 */

import log from "electron-log";
import type {
  ComputerChatRequest,
  ComputerChatResponse,
  HttpResult,
} from "@shared/types/computerTypes";
import { agentService } from "../engines/unifiedAgent";
import type { AcpEngine } from "../engines/acp/acpEngine";
import { clearSseEventBuffer } from "./sseManager";
import { captureSessionsForProject } from "./projectSessionRegistry";
import { archiveFlowagentsSessions } from "./flowagentsSessionPersistence";
import { resolveComputerProjectWorkspaceDir } from "../workspacePaths";
import { getAppDataDir } from "../system/appPaths";
import {
  resolveChatEngineKey,
  resolveChatEngineKeyCandidates,
  resolveChatProjectRegistryKey,
} from "./chatEngineKey";
import * as path from "path";

export {
  resolveChatEngineKey,
  resolveChatEngineKeyCandidates,
} from "./chatEngineKey";

/** 将 engineReloaded 合并进 chat 响应（成功或失败均可携带，便于 dev 调试）。 */
export function attachReloadedToChatResult(
  result: HttpResult<ComputerChatResponse | null>,
  body: ComputerChatRequest,
  engineReloaded: boolean,
): void {
  if (result.data) {
    result.data.reloaded = engineReloaded;
    return;
  }
  if (!engineReloaded) return;
  result.data = {
    project_id: body.project_id ?? "",
    session_id: body.session_id ?? "",
    request_id: body.request_id,
    error: result.message,
    reloaded: true,
  };
}

/** ensureEngine 失败等场景：在 data 中带回 reloaded 标记。 */
export function buildChatErrorWithReload(
  body: ComputerChatRequest,
  code: string,
  message: string,
  engineReloaded: boolean,
): HttpResult<ComputerChatResponse | null> {
  return {
    code,
    message,
    data: engineReloaded
      ? {
          project_id: body.project_id ?? "",
          session_id: body.session_id ?? "",
          request_id: body.request_id,
          error: message,
          reloaded: true,
        }
      : null,
    tid: null,
    success: false,
  };
}

export function shouldAutoReload(
  request: ComputerChatRequest,
  source?: "computer" | "devcomputer",
): boolean {
  return (
    source === "devcomputer" &&
    request.agent_config?.auto_reload?.enabled !== false
  );
}

function findRunningEngineForReload(
  request: ComputerChatRequest,
): { engine: AcpEngine; registryKey: string; queryKey: string } | null {
  for (const queryKey of resolveChatEngineKeyCandidates(request)) {
    const found = agentService.findEngineForStop(queryKey);
    if (found) {
      return { ...found, queryKey };
    }
  }
  return null;
}

/**
 * Stop the running ACP engine for this project/session when auto_reload is active.
 * Returns true only when an engine was found and successfully stopped.
 */
export async function reloadEngineForRequest(
  request: ComputerChatRequest,
): Promise<boolean> {
  const found = findRunningEngineForReload(request);
  if (!found) {
    const engineKey = resolveChatEngineKey(request);
    log.info(
      `[DevComputer] auto_reload: no running engine for key=${engineKey ?? "(none)"}, skip stop`,
    );
    return false;
  }

  const { engine, registryKey, queryKey } = found;

  try {
    const sessions = await engine.listSessions();
    const sessionIds = sessions.map((s) => s.id);
    for (const s of sessions) {
      clearSseEventBuffer(s.id);
    }
    const projectKey = resolveChatProjectRegistryKey(request);
    if (projectKey) {
      captureSessionsForProject(projectKey, sessionIds, request.session_id);
    }
    const isolatedHome = engine.getIsolatedHome();
    const workDirId = projectKey;
    if (isolatedHome && workDirId && request.user_id) {
      const baseConfig = agentService.getAgentConfig();
      const baseWorkspaceDir =
        baseConfig?.workspaceDir || path.join(getAppDataDir(), "workspace");
      const projectDir = resolveComputerProjectWorkspaceDir(
        baseWorkspaceDir,
        request.user_id,
        workDirId,
      );
      archiveFlowagentsSessions(isolatedHome, projectDir);
    }
  } catch {
    /* non-blocking — mirror /computer/agent/stop */
  }
  if (request.session_id) {
    clearSseEventBuffer(request.session_id);
  }

  log.info(
    `[DevComputer] auto_reload: stopping engine registryKey=${registryKey} (query=${queryKey})`,
  );
  return agentService.stopEngine(registryKey);
}
