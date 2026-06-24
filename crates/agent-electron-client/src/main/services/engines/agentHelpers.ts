import * as path from "path";
import log from "electron-log";
import type { AgentEngineType } from "./types";
import type { ModelProviderConfig } from "@shared/types/computerTypes";

/** Map agent_config.agent_server.command to engine type */
export function mapAgentCommand(command: string): AgentEngineType | null {
  if (command === "nuwaxcode") return "nuwaxcode";
  if (command === "claude-code" || command === "claude-code-acp-ts")
    return "claude-code";
  if (
    command === "codex-cli" ||
    command === "codex-acp" ||
    command === "nuwax-codex-acp"
  ) {
    return "codex-cli";
  }
  return null;
}

/**
 * 解析自定义下发引擎在会话列表中的展示名。
 * 优先级：ACP agentInfo.name > agent_server.agent_id > command 文件名。
 */
export function resolveCustomEngineDisplayName(args: {
  acpAgentName?: string | null;
  agentId?: string | null;
  customCommand?: string | null;
}): string | undefined {
  const acpName = args.acpAgentName?.trim();
  if (acpName) return acpName;

  const agentId = args.agentId?.trim();
  if (agentId) return agentId;

  const command = args.customCommand?.trim();
  if (command) return path.basename(command);

  return undefined;
}

/**
 * Resolve template placeholders in agent_server.env using model_provider.
 * rcoder does this internally in handle_chat_core; Electron needs to do it here.
 *
 * Templates: {MODEL_PROVIDER_BASE_URL}, {MODEL_PROVIDER_API_KEY}, {MODEL_PROVIDER_MODEL}, {MODEL_PROVIDER_DEFAULT_MODEL}
 */
export function resolveAgentEnv(
  env: Record<string, string>,
  modelProvider?: ModelProviderConfig,
): Record<string, string> {
  const resolved: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    let v = value;
    if (modelProvider) {
      v = v.replace(
        /\{MODEL_PROVIDER_BASE_URL\}/g,
        modelProvider.base_url || "",
      );
      v = v.replace(/\{MODEL_PROVIDER_API_KEY\}/g, modelProvider.api_key || "");
      v = v.replace(
        /\{MODEL_PROVIDER_DEFAULT_MODEL\}/g,
        modelProvider.default_model || modelProvider.model || "",
      );
      v = v.replace(/\{MODEL_PROVIDER_MODEL\}/g, modelProvider.model || "");
    }
    // Skip entries with unresolved placeholders (missing model_provider fields)
    if (/\{MODEL_PROVIDER_\w+\}/.test(v)) {
      log.warn(
        `[resolveAgentEnv] ⚠️ Skipping unresolved template variable: ${key}=${v}`,
      );
      continue;
    }
    resolved[key] = v;
  }
  return resolved;
}
