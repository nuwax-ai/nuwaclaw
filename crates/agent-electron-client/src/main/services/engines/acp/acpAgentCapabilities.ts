/**
 * ACP agent capability helpers (initialize handshake).
 */

export type AgentCapabilitiesLike = Record<string, unknown> | null | undefined;

/** Whether the agent supports `session/resume` (silent context restore, no history replay). */
export function supportsResumeSession(caps: AgentCapabilitiesLike): boolean {
  if (!caps) return false;
  const sessionCaps = caps.sessionCapabilities as
    | Record<string, unknown>
    | undefined;
  return sessionCaps?.resume != null;
}

/** Whether the agent supports `session/load` (preferred on chat path when true). */
export function supportsLoadSession(caps: AgentCapabilitiesLike): boolean {
  if (!caps) return false;
  return caps.loadSession === true;
}
