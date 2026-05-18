/**
 * Build OPENCODE_CONFIG_CONTENT payload for OpenCode-family ACP engines.
 */

import type { SandboxProcessConfig } from "@shared/types/sandbox";
import type { ApplyOpencodeSandboxConfigResult } from "./opencodeAcpSandbox";

export const DEFAULT_OPENCODE_ACP_PERMISSION: Record<string, string> = {
  edit: "allow",
  bash: "allow",
  webfetch: "allow",
  doom_loop: "allow",
  external_directory: "allow",
  question: "deny",
};

export type AgentMcpServerEntry = {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  type?: string;
};

export function buildOpencodeMcpSection(
  mcpServers: Record<string, AgentMcpServerEntry> | undefined,
): Record<string, unknown> | undefined {
  if (!mcpServers || Object.keys(mcpServers).length === 0) {
    return undefined;
  }
  const mcpConfig: Record<string, unknown> = {};
  for (const [name, srv] of Object.entries(mcpServers)) {
    if ("url" in srv && srv.url) {
      mcpConfig[name] = {
        type: srv.type === "sse" ? "sse" : "streamable-http",
        url: srv.url,
        enabled: true,
      };
    } else if ("command" in srv && srv.command) {
      mcpConfig[name] = {
        type: "local",
        command: [srv.command, ...(srv.args || [])],
        environment: srv.env || {},
        enabled: true,
      };
    }
  }
  return Object.keys(mcpConfig).length > 0 ? mcpConfig : undefined;
}

export function buildOpencodeProviderSection(
  model: string | undefined,
): Record<string, unknown> | undefined {
  if (!model) return undefined;
  const slashIdx = model.indexOf("/");
  if (slashIdx <= 0) return undefined;
  const providerID = model.substring(0, slashIdx);
  const modelID = model.substring(slashIdx + 1);
  // Infer key env var from providerID pattern (openai-compatible/anthropic-compatible
  // are special cases; dot-separated model IDs like "gpt-4o" from provider "gpt" are
  // treated as custom providers with no default env).
  const envVars: string[] =
    providerID === "openai-compatible"
      ? ["OPENAI_API_KEY"]
      : providerID === "anthropic-compatible"
        ? ["ANTHROPIC_API_KEY"]
        : [];
  return {
    [providerID]: {
      name: providerID,
      env: envVars,
      models: {
        [modelID]: { name: modelID },
      },
    },
  };
}

export type BuildOpencodeSpawnConfigOptions = {
  mcpServers?: Record<string, AgentMcpServerEntry>;
  model?: string;
  sandboxConfig?: SandboxProcessConfig;
  workspaceDir: string;
  applySandbox?: (options: {
    configObj: Record<string, unknown>;
    sandboxConfig: SandboxProcessConfig;
    workspaceDir: string;
  }) => ApplyOpencodeSandboxConfigResult;
};

export type BuildOpencodeSpawnConfigResult = {
  configObj: Record<string, unknown>;
  sandboxApply?: ApplyOpencodeSandboxConfigResult;
};

export function buildOpencodeSpawnConfig(
  options: BuildOpencodeSpawnConfigOptions,
): BuildOpencodeSpawnConfigResult {
  const configObj: Record<string, unknown> = {};
  const mcp = buildOpencodeMcpSection(options.mcpServers);
  if (mcp) {
    configObj.mcp = mcp;
  }
  configObj.permission = { ...DEFAULT_OPENCODE_ACP_PERMISSION };

  let sandboxApply: ApplyOpencodeSandboxConfigResult | undefined;
  if (
    options.sandboxConfig?.enabled &&
    options.sandboxConfig.type !== "none" &&
    options.applySandbox
  ) {
    sandboxApply = options.applySandbox({
      configObj,
      sandboxConfig: options.sandboxConfig,
      workspaceDir: options.workspaceDir,
    });
  }

  const provider = buildOpencodeProviderSection(options.model);
  if (provider) {
    configObj.provider = provider;
  }

  return { configObj, sandboxApply };
}

export type OpencodeSandboxActiveLog = {
  path: "opencode-config-sandbox" | "mcp-plus-permission-deny";
  builtinBashDenied: boolean;
  builtinEditDenied: boolean;
  engineVersion: string | undefined;
};

export function describeOpencodeSandboxActive(
  sandboxApply: ApplyOpencodeSandboxConfigResult | undefined,
): OpencodeSandboxActiveLog | false {
  if (!sandboxApply) return false;
  return {
    path: sandboxApply.opencodeSandboxConfigInjected
      ? "opencode-config-sandbox"
      : "mcp-plus-permission-deny",
    builtinBashDenied: sandboxApply.builtinBashDenied,
    builtinEditDenied: sandboxApply.builtinEditDenied,
    engineVersion: sandboxApply.engineVersion,
  };
}
