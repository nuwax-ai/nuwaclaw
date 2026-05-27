/**
 * Detailed session type for the Sessions tab.
 * Aggregated from AcpEngine internal session data.
 */
import type { AgentEngineType } from "./electron";

export interface DetailedSession {
  id: string;
  title?: string;
  engineType: AgentEngineType;
  projectId?: string;
  status: "idle" | "pending" | "active" | "terminating";
  createdAt: number;
  lastActivity?: number;
}
