/**
 * Engine Hooks — extensible registry for env providers and prompt enhancers.
 *
 * Allows feature modules (e.g., GUI Agent) to inject env vars and system prompts
 * into agent engines without modifying core engine code.
 *
 * Usage:
 *   // In feature module:
 *   registerEnvProvider(() => ({ GUI_AGENT_PORT: '60010', GUI_AGENT_TOKEN: 'xxx' }));
 *   registerPromptEnhancer((base) => base ? `${base}\n\n${extra}` : extra);
 */

import log from "electron-log";

// ==================== Env Providers ====================

export type EnvProvider = () => Record<string, string> | undefined;

const envProviders: EnvProvider[] = [];

/** Register a function that returns extra env vars to inject into engine processes. Returns an unregister function. */
export function registerEnvProvider(provider: EnvProvider): () => void {
  envProviders.push(provider);
  return () => {
    const idx = envProviders.indexOf(provider);
    if (idx >= 0) envProviders.splice(idx, 1);
  };
}

/** Collect env vars from all registered providers. */
export function collectEnvFromProviders(): Record<string, string> {
  const result: Record<string, string> = {};
  for (const provider of envProviders) {
    try {
      const env = provider();
      if (env) Object.assign(result, env);
    } catch (e) {
      log.warn("[EngineHooks] env provider error:", e);
    }
  }
  return result;
}

// ==================== Prompt Enhancers ====================

export type PromptEnhancer = (
  basePrompt: string | undefined,
) => string | undefined;

const promptEnhancers: PromptEnhancer[] = [];

/** Register a function that can append/modify the system prompt. Returns an unregister function. */
export function registerPromptEnhancer(enhancer: PromptEnhancer): () => void {
  promptEnhancers.push(enhancer);
  return () => {
    const idx = promptEnhancers.indexOf(enhancer);
    if (idx >= 0) promptEnhancers.splice(idx, 1);
  };
}

/** Run all registered enhancers on the base system prompt. */
export function enhanceSystemPrompt(
  basePrompt: string | undefined,
): string | undefined {
  let result = basePrompt;
  for (const enhancer of promptEnhancers) {
    try {
      result = enhancer(result);
    } catch (e) {
      log.warn("[EngineHooks] prompt enhancer error:", e);
    }
  }
  return result;
}
