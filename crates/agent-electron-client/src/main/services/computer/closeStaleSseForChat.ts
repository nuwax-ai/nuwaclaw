import log from "electron-log";
import type { ComputerChatRequest } from "@shared/types/computerTypes";
import { resolveProjectSession } from "./projectSessionRegistry";
import {
  closeSseClientsForSession,
  collectOpenSseSessionIdsForProjectKeys,
} from "./sseManager";

export interface ChatSseSessionLookup {
  findSessionByProjectId(projectId: string): { id: string } | null;
  listSessionsDetailed?: () => Array<{ id: string; projectId?: string }>;
}

function projectKeysForBody(body: ComputerChatRequest): Set<string> {
  const keys = new Set<string>();
  if (body.agent_work_dir) keys.add(body.agent_work_dir);
  if (body.project_id) keys.add(body.project_id);
  return keys;
}

/** Collect session_ids that may still have an open progress SSE for this chat request. */
export function collectStaleSseSessionIds(
  body: ComputerChatRequest,
  acpEngine: ChatSseSessionLookup,
): string[] {
  const keys = projectKeysForBody(body);
  const ids = new Set<string>();

  if (body.session_id) ids.add(body.session_id);

  for (const key of keys) {
    const remembered = resolveProjectSession(key);
    if (remembered) ids.add(remembered);

    const session = acpEngine.findSessionByProjectId(key);
    if (session?.id) ids.add(session.id);
  }

  if (acpEngine.listSessionsDetailed) {
    for (const session of acpEngine.listSessionsDetailed()) {
      if (session.projectId && keys.has(session.projectId)) {
        ids.add(session.id);
      }
      for (const key of keys) {
        if (session.id === key) ids.add(session.id);
      }
    }
  }

  for (const sessionId of collectOpenSseSessionIdsForProjectKeys(keys)) {
    ids.add(sessionId);
  }

  return [...ids];
}

/**
 * Close any lingering progress SSE for this project before a new /chat turn.
 * Must run before acpEngine.chat() so prompt_start is not written to a stale connection.
 */
export function closeStaleSseBeforeChat(
  body: ComputerChatRequest,
  acpEngine: ChatSseSessionLookup,
): void {
  const sessionIds = collectStaleSseSessionIds(body, acpEngine);
  if (sessionIds.length === 0) return;

  log.info(
    `[SSE] Closing stale progress connection(s) before /chat: project_id=${body.project_id}, sessions=[${sessionIds.join(", ")}]`,
  );
  for (const sessionId of sessionIds) {
    closeSseClientsForSession(sessionId);
  }
}
