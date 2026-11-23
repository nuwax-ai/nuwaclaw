import * as fs from "node:fs";
import * as path from "node:path";
import { resolveOpenAICompatModel } from "./openAICompatRouting";

interface HarnessModelConfig {
  model?: string;
  baseUrl?: string;
  apiKey?: string;
  apiProtocol?: string;
}

function takeHarnessEnv(
  env: Record<string, string>,
  key: string,
): string | undefined {
  const value = env[key]?.trim();
  delete env[key];
  return value || undefined;
}

/** 配置实际发给 Harness 的模型路由，并返回是否需要 ACP API key 登录。 */
export function applyHarnessModelEnv(
  config: HarnessModelConfig,
  env: Record<string, string>,
): boolean {
  for (const key of Object.keys(env)) {
    if (key.toUpperCase().startsWith("CODEX_")) delete env[key];
  }

  const routes = [
    { baseUrl: config.baseUrl?.trim(), apiKey: config.apiKey?.trim() },
    {
      baseUrl: env.OPENAI_BASE_URL?.trim(),
      apiKey: env.OPENAI_API_KEY?.trim(),
    },
    {
      baseUrl: takeHarnessEnv(env, "NUWAX_BASE_URL"),
      apiKey: takeHarnessEnv(env, "NUWAX_API_KEY"),
    },
  ];
  // 端点和凭据必须来自同一配置，避免把某个网关的 key 发到另一个端点。
  const route =
    routes.find(({ baseUrl, apiKey }) => baseUrl && apiKey) ??
    routes.find(({ baseUrl }) => baseUrl);
  const apiKey = route
    ? route.apiKey
    : routes.find((candidate) => candidate.apiKey)?.apiKey;
  delete env.OPENAI_BASE_URL;
  delete env.OPENAI_API_KEY;
  if (route?.baseUrl) env.NUWAX_BASE_URL = route.baseUrl;
  if (apiKey) {
    env[route ? "NUWAX_API_KEY" : "OPENAI_API_KEY"] = apiKey;
  }

  const model = resolveOpenAICompatModel({
    model: config.model,
    envModel:
      takeHarnessEnv(env, "NUWAX_MODEL") ||
      env.OPENCODE_MODEL ||
      env.ANTHROPIC_MODEL,
  });
  if (model) env.NUWAX_MODEL = model.providerModel;
  env.NUWAX_PROVIDER_ID =
    takeHarnessEnv(env, "NUWAX_PROVIDER_ID") || "zhipu-glm-5";
  env.NUWAX_MODEL_CONTEXT_WINDOW =
    takeHarnessEnv(env, "NUWAX_MODEL_CONTEXT_WINDOW") || "200000";

  const protocol = config.apiProtocol?.trim().toLowerCase();
  const providerProtocol = takeHarnessEnv(
    env,
    "NUWAX_API_PROTOCOL",
  )?.toLowerCase();
  const wireApi = takeHarnessEnv(env, "NUWAX_WIRE_API");
  if (protocol === "anthropic" || providerProtocol === "anthropic") {
    env.NUWAX_API_PROTOCOL = "anthropic";
  } else {
    if (providerProtocol) env.NUWAX_API_PROTOCOL = providerProtocol;
    env.NUWAX_WIRE_API =
      wireApi || (protocol === "responses" ? "responses" : "chat");
  }

  const disableThinking =
    takeHarnessEnv(env, "NUWAX_DISABLE_THINKING") ||
    env.CLAUDE_CODE_DISABLE_THINKING;
  if (disableThinking) env.NUWAX_DISABLE_THINKING = disableThinking;
  return !route && Boolean(apiKey);
}

export function applyHarnessRuntimeEnv(
  env: Record<string, string>,
  enginePath: string,
  isolatedHome: string,
  logDir: string,
): void {
  const engineHome = path.join(isolatedHome, ".nuwax-harness");
  fs.mkdirSync(engineHome, { recursive: true });
  env.NUWAX_HOME = engineHome;
  // Harness 0.18.59 的原生 app-server 仍使用这个 SQLite 路径变量。
  env.CODEX_SQLITE_HOME = engineHome;
  env.NUWAX_PATH = enginePath;
  env.NUWAX_LOG_DIR = logDir;
  env.APP_SERVER_LOGS = logDir;
}
