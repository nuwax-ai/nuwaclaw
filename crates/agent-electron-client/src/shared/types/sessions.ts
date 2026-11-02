/**
 * Detailed session type for the Sessions tab.
 * Aggregated from AcpEngine internal session data.
 */
import type { AgentEngineType } from "./electron";

export interface DetailedSession {
  id: string;
  title?: string;
  engineType: AgentEngineType;
  /**
   * 自定义下发引擎的展示名（如 ACP initialize 返回的 agentInfo.name）。
   * 仅当 agent_server.command 不在内置引擎列表时填充；内置引擎走 engineType + i18n。
   */
  engineDisplayName?: string;
  projectId?: string;
  status: "idle" | "pending" | "active" | "terminating";
  createdAt: number;
  lastActivity?: number;
}
