export type OpenAICompatEngineType =
  | "claude-code"
  | "nuwaxcode"
  | "codex-cli"
  | "pi-agent"
  | "hermes-agent"
  | "kilo-cli"
  | "openclaw";

export interface OpenAICompatInput {
  engineType?: OpenAICompatEngineType;
  apiProtocol?: string;
  model?: string;
  apiKey?: string;
  baseUrl?: string;
  chat2responseProxyBaseUrl?: string;
  chat2responseEnabled?: boolean;
  chat2responseLocalBaseUrl?: string;
}

export type OpenAICompatRoutingResult = {
  isOpenAICompatible: boolean;
  chat2responseEnabled: boolean;
  finalOpenAIBaseUrl: string;
  openAIBaseUrlSource:
    | "config.baseUrl"
    | "env.OPENAI_BASE_URL"
    | "chat2response-proxy"
    | "none";
  chat2responseReason:
    | "not-applicable"
    | "disabled"
    | "missing-upstream"
    | "official-openai-baseurl"
    | "missing-proxy-url"
    | "routed-via-proxy";
};

function parseBooleanFlag(value: string | undefined): boolean | undefined {
  if (value === undefined) return undefined;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return undefined;
}

function trimTrailingSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

function isOfficialOpenAIBaseUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    return host === "api.openai.com" || host.endsWith(".openai.com");
  } catch {
    return false;
  }
}

/**
 * Inject OpenAI-compatible credentials and optional chat2response routing.
 *
 * Why this exists:
 * 1. nuwaxcode and codex-cli both need OPENAI_* env wiring when model/provider
 *    is OpenAI-compatible.
 * 2. codex-cli effectively targets the newer Responses-style protocol, while
 *    many domestic providers still expose OpenAI Chat-compatible endpoints.
 * 3. Therefore codex-cli needs a compatibility path where a third-party
 *    chat2response proxy converts Chat traffic to Responses upstream.
 */
export function applyOpenAICompatibleEnv(
  config: OpenAICompatInput,
  env: Record<string, string>,
): OpenAICompatRoutingResult {
  const apiProtocol = (config.apiProtocol || "").toLowerCase();
  const effectiveModel = env.OPENCODE_MODEL || config.model || "";
  const isOpenAICompatible =
    apiProtocol === "openai" || effectiveModel.startsWith("openai-compatible/");

  if (!isOpenAICompatible) {
    return {
      isOpenAICompatible: false,
      chat2responseEnabled: false,
      finalOpenAIBaseUrl: env.OPENAI_BASE_URL || "",
      openAIBaseUrlSource: env.OPENAI_BASE_URL ? "env.OPENAI_BASE_URL" : "none",
      chat2responseReason: "not-applicable",
    };
  }

  if (config.apiKey && !env.OPENAI_API_KEY) {
    env.OPENAI_API_KEY = config.apiKey;
  }
  if (config.baseUrl && !env.OPENAI_BASE_URL) {
    env.OPENAI_BASE_URL = config.baseUrl;
  }

  let openAIBaseUrlSource: OpenAICompatRoutingResult["openAIBaseUrlSource"] =
    env.OPENAI_BASE_URL ? "env.OPENAI_BASE_URL" : "none";
  if (
    !env.OPENAI_BASE_URL &&
    config.baseUrl &&
    trimTrailingSlash(config.baseUrl).length > 0
  ) {
    openAIBaseUrlSource = "config.baseUrl";
  }

  let chat2responseEnabled = false;
  let chat2responseReason: OpenAICompatRoutingResult["chat2responseReason"] =
    "not-applicable";

  if (config.engineType === "codex-cli") {
    const envFlag = parseBooleanFlag(
      env.NUWAX_CHAT2RESPONSE_ENABLED ?? env.CHAT2RESPONSE_ENABLED,
    );
    const enabled =
      config.chat2responseEnabled ?? (envFlag === undefined ? true : envFlag);
    chat2responseEnabled = enabled;

    const upstream = trimTrailingSlash(
      env.OPENAI_BASE_URL || config.baseUrl || "",
    );
    if (!enabled) {
      chat2responseReason = "disabled";
    } else if (!upstream) {
      chat2responseReason = "missing-upstream";
    } else if (isOfficialOpenAIBaseUrl(upstream)) {
      chat2responseReason = "official-openai-baseurl";
    } else {
      const proxyUrl = trimTrailingSlash(
        config.chat2responseLocalBaseUrl ||
          config.chat2responseProxyBaseUrl ||
          env.NUWAX_CHAT2RESPONSE_PROXY_URL ||
          env.CHAT2RESPONSE_PROXY_URL ||
          "",
      );
      if (!proxyUrl) {
        chat2responseReason = "missing-proxy-url";
      } else {
        env.NUWAX_CHAT2RESPONSE_UPSTREAM_BASE_URL = upstream;
        env.OPENAI_BASE_URL = proxyUrl;
        openAIBaseUrlSource = "chat2response-proxy";
        chat2responseReason = "routed-via-proxy";
      }
    }
  }

  return {
    isOpenAICompatible: true,
    chat2responseEnabled,
    finalOpenAIBaseUrl: env.OPENAI_BASE_URL || "",
    openAIBaseUrlSource,
    chat2responseReason,
  };
}
