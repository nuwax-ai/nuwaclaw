import log from "electron-log";
import type { ComputerChatRequest } from "@shared/types/computerTypes";
import { resolveProjectSession } from "./projectSessionRegistry";

/**
 * 请求未带 session_id 时，从 registry 补全（常见于 reload 后上游只传 project_id）。
 */
export function ensureSessionIdFromRegistry(
  request: ComputerChatRequest,
): string | undefined {
  if (request.session_id) return request.session_id;

  const keys = [request.agent_work_dir, request.project_id].filter(
    Boolean,
  ) as string[];

  for (const key of keys) {
    const remembered = resolveProjectSession(key);
    if (remembered) {
      request.session_id = remembered;
      log.info(
        `[HTTP] Resolved session_id from registry: ${remembered} (key=${key})`,
      );
      return remembered;
    }
  }
  return undefined;
}
