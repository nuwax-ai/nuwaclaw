import type { ComputerChatRequest } from "@shared/types/computerTypes";

/**
 * 引擎 Map 注册 key（与 unifiedAgent.ensureEngineForRequest 一致）。
 * 无可用字段时回退 "default"。
 */
export function resolveChatEngineRegistryKey(
  request: ComputerChatRequest,
): string {
  return (
    request.agent_work_dir ||
    request.project_id ||
    request.session_id ||
    "default"
  );
}

/** 有值时的注册 key；无 agent_work_dir / project_id / session_id 时返回 undefined。 */
export function resolveChatEngineKey(
  request: ComputerChatRequest,
): string | undefined {
  const key = resolveChatEngineRegistryKey(request);
  return key === "default" ? undefined : key;
}

/**
 * 按 ensureEngine 优先级列出候选 key，用于 reload 定位已运行引擎
 * （含历史请求 key 不一致、session_id 定位等场景）。
 */
export function resolveChatEngineKeyCandidates(
  request: ComputerChatRequest,
): string[] {
  const keys = [
    request.agent_work_dir,
    request.project_id,
    request.session_id,
  ].filter(Boolean) as string[];
  return [...new Set(keys)];
}

/** projectSessionRegistry 用的 project 维度 key。 */
export function resolveChatProjectRegistryKey(
  request: ComputerChatRequest,
): string | undefined {
  return request.agent_work_dir || request.project_id || undefined;
}
