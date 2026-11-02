// ACP initialize-time client capability assembly shared by nuwa-cli &
// nuwaclaw, so both hosts opt into the same (experimental) feature set.

export interface ClientCapabilitiesLike {
  terminal?: boolean;
  plan?: Record<string, never>;
  [key: string]: unknown;
}

/**
 * Build the `clientCapabilities` payload for initialize. Declaring `plan: {}`
 * opts the client into receiving `plan_update` / `plan_removed` session
 * updates (experimental in v1; both SDK 0.26 and 1.x accept it, agents that
 * don't know it ignore it).
 */
export function buildClientCapabilities(
  input: { terminal?: boolean } = {},
): ClientCapabilitiesLike {
  return {
    ...(input.terminal ? { terminal: true } : {}),
    plan: {},
  };
}
