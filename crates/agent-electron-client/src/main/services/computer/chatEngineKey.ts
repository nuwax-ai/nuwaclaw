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
 * 常规项目 id（devTargetId）与 conversationId 同为数字单段名：service_type 不进
 * key 的话，同 userId 下两个 id 空间撞号会共用同一引擎实例，但两类会话的
 * projectDir 不同层（computer-project-workspace/{u}/normalProject/{pid} vs
 * .../{u}/{pid}），后到会话会落错工作目录——前缀隔离两个 id 空间。
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
 * 无可用字段时回退 "default"；normalProject 业务加作用域前缀。
 */
export function resolveChatEngineRegistryKey(
  request: ChatProjectKeyInput,
): string {
  const id = request.agent_work_dir || request.project_id || request.session_id;
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
 * 之前已按原始 id 建立的存量引擎。
 */
export function resolveChatEngineKeyCandidates(
  request: ChatProjectKeyInput,
): string[] {
  const ids = [
    request.agent_work_dir,
    request.project_id,
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

/** projectSessionRegistry 用的 project 维度 key（normalProject 同样加前缀隔离）。 */
export function resolveChatProjectRegistryKey(
  request: ChatProjectKeyInput,
): string | undefined {
  const id = request.agent_work_dir || request.project_id;
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
 */
export function projectRegistryKeyCandidates(
  request: ChatProjectKeyInput,
): string[] {
  const ids = [request.agent_work_dir, request.project_id].filter(
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
