/**
 * ACP / 业务 mode 类型定义（v3）
 *
 * 两套概念不要搞混：
 * 1) 业务 agent_mode（ask / yolo）：由 chat 请求 agent_config.agent_server.agent_mode
 *    驱动，只影响本端对 ACP session/request_permission 的审批策略。
 * 2) 引擎 ACP session mode（如 claude 的 default/auto/plan）：由 Agent 自行默认，
 *    客户端不把 ask/yolo 通过 session/set_mode 下发。
 *
 * Mode 不做本地持久化。
 */

/** ACP agent mode（本期只实现 ask / yolo） */
export type AcpMode = "ask" | "yolo";

/** 解析 ACP session mode id（newSession/load/resume 返回的 currentModeId） */
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
  if (agentMode === "ask" || agentMode === "yolo") {
    return { mode: agentMode, isFallback: false };
  }
  // 未知 mode fail-safe 为 ask
  return { mode: "ask", isFallback: true };
}
