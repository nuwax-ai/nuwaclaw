/**
 * Detailed session type for the Sessions tab.
 * Aggregated from AcpEngine internal session data.
 */
export interface DetailedSession {
  id: string;
  title?: string;
  engineType: "claude-code" | "nuwaxcode";
  projectId?: string;
  status: "idle" | "pending" | "active" | "terminating";
  createdAt: number;
  lastActivity?: number;
}
