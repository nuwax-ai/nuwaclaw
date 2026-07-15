import {
  AGENT_METHODS,
  type ActiveSession,
  type ClientContext,
  type SessionModeState,
} from "@agentclientprotocol/sdk";

/**
 * Uniform surface chat.ts programs against, regardless of whether the
 * session came from `session/new` (wrapped ActiveSession, which has its own
 * convenience prompt()) or `session/load` (a raw request/response pair with
 * no SDK-provided wrapper — ClientContext.attachSession() is private).
 */
export interface SessionHandle {
  sessionId: string;
  modes: SessionModeState | null | undefined;
  prompt(text: string): Promise<unknown>;
}

export function wrapNewSession(session: ActiveSession): SessionHandle {
  return {
    sessionId: session.sessionId,
    modes: session.modes,
    prompt: (text) => session.prompt(text),
  };
}

export function wrapResumedSession(
  ctx: ClientContext,
  sessionId: string,
  modes: SessionModeState | null | undefined,
): SessionHandle {
  return {
    sessionId,
    modes,
    prompt: (text) =>
      ctx.request(AGENT_METHODS.session_prompt, {
        sessionId,
        prompt: [{ type: "text", text }],
      }),
  };
}
