import log from "electron-log";
import type { ComputerChatRequest } from "@shared/types/computerTypes";
import { projectRegistryKeyCandidates } from "./chatEngineKey";
import { resolveProjectSession } from "./projectSessionRegistry";

/**
 * 请求未带 session_id 时，从 registry 补全（常见于 reload 后上游只传 project_id）。
 * key 用前缀+原始双形态候选探测（写入侧对 normalProject 业务带 normalProject:
 * 前缀，读取侧请求的 service_type 携带情况可能与写入时不同）。
 */
export function ensureSessionIdFromRegistry(
  request: ComputerChatRequest,
): string | undefined {
  if (request.session_id) return request.session_id;

  for (const key of projectRegistryKeyCandidates(request)) {
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
