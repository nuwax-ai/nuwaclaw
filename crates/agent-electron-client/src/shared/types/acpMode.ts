/**
 * ACP / 业务 mode 类型定义（v4）
 *
 * 两套概念不要搞混：
 * 1) 业务 agent_mode（ask / yolo / plan）：由 chat 请求 agent_config.agent_server.agent_mode
 *    驱动。ask/yolo 只影响本端对 ACP session/request_permission 的审批策略；
 *    plan 额外触发引擎侧 session/set_mode（见 syncEngineSessionModeForChat），
 *    且本地审批策略强制折算为 ask（ExitPlanMode/plan_exit 类确认必须人工放行）。
 * 2) 引擎 ACP session mode（如 claude 的 default/auto/plan、nuwaxcode 的 build/plan）：
 *    由 Agent 在 session/new|load|resume 结果中广告（modes 字段或 mode config option），
 *    仅当业务请求为 plan 时下发 set_mode，ask/yolo 保持引擎默认。
 *
 * Mode 不做本地持久化。
 */

/** ACP agent mode（v4 增加 plan：只规划不执行） */
export type AcpMode = "ask" | "yolo" | "plan";

/** ACP engine ID（v3 收敛：codex 统一使用，codex-cli/codex-acp/nuwax-codex-acp 兼容映射） */
export type AgentEngineId = "claude-code" | "nuwaxcode" | "codex";

/** 旧 engine ID → 新 AgentEngineId 兼容映射 */
export const ENGINE_ID_ALIASES: Record<string, AgentEngineId> = {
  "codex-cli": "codex",
  "codex-acp": "codex",
  "nuwax-codex-acp": "codex",
};

/** 将任意 engine 标识规范化为 AgentEngineId，未知值返回 null */
export function normalizeEngineId(raw: string): AgentEngineId | null {
  if (ENGINE_ID_ALIASES[raw]) return ENGINE_ID_ALIASES[raw];
  if (raw === "claude-code" || raw === "nuwaxcode" || raw === "codex")
    return raw;
  return null;
}

/**
 * 解析 ACP session mode id（newSession/load/resume 返回的 currentModeId）。
 * 引擎 mode id（default/plan/build…）不映射为业务 agent_mode，恒返回 null。
 */
export function parseAcpModeId(modeId?: string | null): AcpMode | null {
  if (modeId === "ask" || modeId === "yolo") return modeId;
  return null;
}

/** 解析 agent_mode 字段。缺省 → yolo，非法 → fail-safe ask + warning 标记 */
export function resolveEffectiveMode(agentMode?: string | null): {
  mode: AcpMode;
  isFallback: boolean;
} {
  if (!agentMode) return { mode: "yolo", isFallback: false };
  if (agentMode === "ask" || agentMode === "yolo" || agentMode === "plan") {
    return { mode: agentMode, isFallback: false };
  }
  // 未知 mode fail-safe 为 ask
  return { mode: "ask", isFallback: true };
}
