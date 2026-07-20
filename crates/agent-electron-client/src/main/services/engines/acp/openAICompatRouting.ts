export type OpenAICompatEngineType =
  | "claude-code"
  | "nuwaxcode"
  | "codex"
  | "codex-cli";

export interface OpenAICompatInput {
  engineType?: OpenAICompatEngineType;
  apiProtocol?: string;
  model?: string;
  apiKey?: string;
  baseUrl?: string;
}

export interface OpenAICompatModelInput {
  model?: string;
  defaultModel?: string;
  envModel?: string;
}

export interface ResolvedOpenAICompatModel {
  rawModel: string;
  providerModel: string;
  isOpenAICompatibleModel: boolean;
}

export interface OpenAICompatEnvResult {
  isOpenAICompatible: boolean;
}

/** Whether two model strings refer to the same provider model (ignores openai-compatible/ prefix). */
export function modelsEquivalentForProvider(
  a: string | undefined | null,
  b: string | undefined | null,
): boolean {
  const left = (a || "").trim();
  const right = (b || "").trim();
  if (!left || !right) return false;
  if (left === right) return true;
  const resolvedA = resolveOpenAICompatModel({ model: left });
  const resolvedB = resolveOpenAICompatModel({ model: right });
  if (!resolvedA || !resolvedB) return false;
  return (
    resolvedA.providerModel === resolvedB.providerModel ||
    resolvedA.rawModel === resolvedB.rawModel
  );
}

export function resolveOpenAICompatModel(
  input: OpenAICompatModelInput,
): ResolvedOpenAICompatModel | null {
  const rawModel = (
    input.envModel ||
    input.model ||
    input.defaultModel ||
    ""
  ).trim();
  if (!rawModel) return null;

  const prefix = "openai-compatible/";
  const isOpenAICompatibleModel = rawModel.startsWith(prefix);
  const providerModel = isOpenAICompatibleModel
    ? rawModel.slice(prefix.length).trim()
    : rawModel;
  if (!providerModel) return null;

  return {
    rawModel,
    providerModel,
    isOpenAICompatibleModel,
  };
}

export function applyOpenAICompatibleEnv(
  config: OpenAICompatInput,
  env: Record<string, string>,
): OpenAICompatEnvResult {
  const apiProtocol = (config.apiProtocol || "").toLowerCase();
  const resolvedModel = resolveOpenAICompatModel({
    model: config.model,
    envModel: env.OPENCODE_MODEL || env.ANTHROPIC_MODEL || env.CODEX_MODEL,
  });
  const isOpenAICompatible =
    apiProtocol === "openai" || resolvedModel?.isOpenAICompatibleModel === true;

  if (!isOpenAICompatible) {
    return { isOpenAICompatible: false };
  }

  if (config.apiKey && !env.OPENAI_API_KEY) {
    env.OPENAI_API_KEY = config.apiKey;
  }
  if (config.baseUrl && !env.OPENAI_BASE_URL) {
    env.OPENAI_BASE_URL = config.baseUrl;
  }

  return { isOpenAICompatible: true };
}
