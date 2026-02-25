import log from 'electron-log';
import type { AgentEngineType, ModelProviderConfig } from './unifiedAgent';

/** Map agent_config.agent_server.command to engine type */
export function mapAgentCommand(command: string): AgentEngineType | null {
  if (command === 'nuwaxcode') return 'nuwaxcode';
  if (command === 'claude-code' || command === 'claude-code-acp-ts') return 'claude-code';
  return null;
}

/**
 * Resolve template placeholders in agent_server.env using model_provider.
 * rcoder does this internally in handle_chat_core; Electron needs to do it here.
 *
 * Templates: {MODEL_PROVIDER_BASE_URL}, {MODEL_PROVIDER_API_KEY}, {MODEL_PROVIDER_MODEL}
 */
export function resolveAgentEnv(
  env: Record<string, string>,
  modelProvider?: ModelProviderConfig,
): Record<string, string> {
  const resolved: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    let v = value;
    if (modelProvider) {
      v = v.replace(/\{MODEL_PROVIDER_BASE_URL\}/g, modelProvider.base_url || '');
      v = v.replace(/\{MODEL_PROVIDER_API_KEY\}/g, modelProvider.api_key || '');
      v = v.replace(/\{MODEL_PROVIDER_MODEL\}/g, modelProvider.model || '');
    }
    // Skip entries with unresolved placeholders (missing model_provider fields)
    if (/\{MODEL_PROVIDER_\w+\}/.test(v)) {
      log.warn(`[resolveAgentEnv] ⚠️ 跳过未解析的模板变量: ${key}=${v}`);
      continue;
    }
    resolved[key] = v;
  }
  return resolved;
}
