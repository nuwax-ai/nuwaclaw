import type { ComputerChatRequest } from "@shared/types/computerTypes";
import { isNormalProjectServiceType } from "./agentWorkDir";

/**
 * key 推导的入参字段子集：chat 请求（ComputerChatRequest）与其结构超集；
 * stop/status/cancel 等非 chat 入口的 body 只需携带这些字段即可复用同源推导。
 */
export type ChatProjectKeyInput = Pick<
  ComputerChatRequest,
  "agent_work_dir" | "project_id" | "session_id" | "service_type"
>;

/**
 * normalProject 业务的 key 作用域前缀。
 *
 * key 主维度为 conversationId（project_id）：同一常规项目下多个对话各自独立
 * 引擎/会话，可并行不互相抢占（cwd 仍按 agent_work_dir 共享同一工作目录，见
 * acpSessionSetup.buildWorkDirAndProjectDir）。前缀按 service_type 给 normalProject
 * 引擎单独作用域，与普通会话引擎隔离，并保留与历史前缀化 key 的双形态兼容。
 */
const NORMAL_PROJECT_KEY_PREFIX = "normalProject:";

function scopeKeyByServiceType(
  request: ChatProjectKeyInput,
  id: string,
): string {
  return isNormalProjectServiceType(request.service_type)
    ? NORMAL_PROJECT_KEY_PREFIX + id
    : id;
}

/**
 * 引擎 Map 注册 key（与 unifiedAgent.ensureEngineForRequest 一致）。
 * 主维度为 conversationId（project_id），使同一常规项目下不同对话各自独立引擎、
 * 可并行；agent_work_dir 仅作 cwd 推导与无 conversationId 时的回退。无可用字段时
 * 回退 "default"；normalProject 业务加作用域前缀。
 */
export function resolveChatEngineRegistryKey(
  request: ChatProjectKeyInput,
): string {
  const id = request.project_id || request.agent_work_dir || request.session_id;
  return id ? scopeKeyByServiceType(request, id) : "default";
}

/** 有值时的注册 key；无 agent_work_dir / project_id / session_id 时返回 undefined。 */
export function resolveChatEngineKey(
  request: ChatProjectKeyInput,
): string | undefined {
  const key = resolveChatEngineRegistryKey(request);
  return key === "default" ? undefined : key;
}

/**
 * 按 ensureEngine 优先级列出候选 key，用于 reload 定位已运行引擎
 * （含历史请求 key 不一致、session_id 定位等场景）。
 * normalProject 业务对每个 id 同时给出前缀形态与原始形态——兼容前缀化改造
 * 之前已按原始 id 建立的存量引擎。已有 conversationId 时不再探测共享目录 id，
 * 否则首次请求可能 reload 同目录的另一对话；session_id 仍可精确定位本会话。
 */
export function resolveChatEngineKeyCandidates(
  request: ChatProjectKeyInput,
): string[] {
  const ids = [
    request.project_id || request.agent_work_dir,
    request.session_id,
  ].filter(Boolean) as string[];
  const keys: string[] = [];
  for (const id of ids) {
    for (const candidate of [scopeKeyByServiceType(request, id), id]) {
      if (!keys.includes(candidate)) keys.push(candidate);
    }
  }
  return keys;
}

/** projectSessionRegistry 用的对话维度 key（normalProject 同样加前缀隔离）。 */
export function resolveChatProjectRegistryKey(
  request: ChatProjectKeyInput,
): string | undefined {
  const id = request.project_id || request.agent_work_dir;
  return id ? scopeKeyByServiceType(request, id) : undefined;
}

/**
 * projectSessionRegistry 读取侧候选 key：前缀形态 + 原始形态。
 *
 * 写入侧（chat 成功回写 / devcomputer reload capture）经
 * resolveChatProjectRegistryKey 对 normalProject 业务带前缀；读取侧
 * （session_id 补全 / 陈旧 SSE 清理）请求的 service_type 携带情况可能与写入时
 * 不同，双形态探测保证 normalProject 会话在 reload 后仍能按 key 恢复。
 * 无 service_type 时前缀形态与原始形态相同，去重后即存量行为。
 * 已有 conversationId 时不回退共享目录 id，防止补全另一对话的 session 或关闭其 SSE。
 */
export function projectRegistryKeyCandidates(
  request: ChatProjectKeyInput,
): string[] {
  const ids = [request.project_id || request.agent_work_dir].filter(
    Boolean,
  ) as string[];
  const keys: string[] = [];
  for (const id of ids) {
    for (const candidate of [scopeKeyByServiceType(request, id), id]) {
      if (!keys.includes(candidate)) keys.push(candidate);
    }
  }
  return keys;
}
