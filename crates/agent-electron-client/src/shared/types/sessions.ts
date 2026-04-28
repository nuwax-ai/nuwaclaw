/**
 * Detailed session type for the Sessions tab.
 * Aggregated from AcpEngine internal session data.
 */
export interface DetailedSession {
  id: string;
  title?: string;
  engineType:
    | "claude-code"
    | "nuwaxcode"
    | "codex-cli"
    | "pi-agent"
    | "hermes-agent"
    | "kilo-cli"
    | "openclaw";
  projectId?: string;
  status: "idle" | "pending" | "active" | "terminating";
  createdAt: number;
  lastActivity?: number;
}
