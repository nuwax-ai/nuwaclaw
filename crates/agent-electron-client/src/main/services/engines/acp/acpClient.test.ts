import { describe, it, expect } from "vitest";
import {
  applyOpenAICompatibleEnv,
  resolveOpenAICompatModel,
  type OpenAICompatInput,
} from "./openAICompatRouting";

function createBaseConfig(
  overrides: Partial<OpenAICompatInput>,
): OpenAICompatInput {
  return {
    ...overrides,
  };
}

describe("resolveOpenAICompatModel", () => {
  it("strips openai-compatible prefix for provider model env vars", () => {
    expect(
      resolveOpenAICompatModel({ model: "openai-compatible/glm-5" }),
    ).toEqual({
      rawModel: "openai-compatible/glm-5",
      providerModel: "glm-5",
      isOpenAICompatibleModel: true,
    });
  });

  it("uses default_model when model is not present", () => {
    expect(
      resolveOpenAICompatModel({ defaultModel: "openai-compatible/qwen-max" }),
    ).toEqual({
      rawModel: "openai-compatible/qwen-max",
      providerModel: "qwen-max",
      isOpenAICompatibleModel: true,
    });
  });

  it("prefers request env model over fallback model fields", () => {
    expect(
      resolveOpenAICompatModel({
        model: "openai-compatible/qwen-max",
        defaultModel: "openai-compatible/deepseek-chat",
        envModel: "openai-compatible/glm-5",
      }),
    ).toEqual({
      rawModel: "openai-compatible/glm-5",
      providerModel: "glm-5",
      isOpenAICompatibleModel: true,
    });
  });

  it("keeps provider-native model names unchanged", () => {
    expect(resolveOpenAICompatModel({ model: "glm-5" })).toEqual({
      rawModel: "glm-5",
      providerModel: "glm-5",
      isOpenAICompatibleModel: false,
    });
  });
});

describe("applyOpenAICompatibleEnv", () => {
  it("codex + domestic baseUrl routes to chat2response proxy", () => {
    const env: Record<string, string> = {
      CHAT2RESPONSE_PROXY_URL: "https://chat2response.example.com/proxy",
    };
    const config = createBaseConfig({
      engineType: "codex",
      apiProtocol: "openai",
      baseUrl: "https://api.deepseek.com/v1",
      apiKey: "sk-domestic",
    });

    const result = applyOpenAICompatibleEnv(config, env);

    expect(result.isOpenAICompatible).toBe(true);
    expect(result.chat2responseReason).toBe("routed-via-proxy");
    expect(result.openAIBaseUrlSource).toBe("chat2response-proxy");
    expect(env.OPENAI_BASE_URL).toBe("https://chat2response.example.com/proxy");
    expect(env.NUWAX_CHAT2RESPONSE_UPSTREAM_BASE_URL).toBe(
      "https://api.deepseek.com/v1",
    );
    expect(env.OPENAI_API_KEY).toBe("sk-domestic");
  });

  it("codex prefers local managed chat2response service when provided", () => {
    const env: Record<string, string> = {
      CHAT2RESPONSE_PROXY_URL: "https://chat2response.remote.example.com/proxy",
    };
    const config = createBaseConfig({
      engineType: "codex",
      apiProtocol: "openai",
      baseUrl: "https://api.deepseek.com/v1",
      apiKey: "sk-domestic",
      chat2responseLocalBaseUrl: "http://127.0.0.1:60009/v1",
    });

    const result = applyOpenAICompatibleEnv(config, env);

    expect(result.chat2responseReason).toBe("routed-via-proxy");
    expect(result.openAIBaseUrlSource).toBe("chat2response-proxy");
    expect(env.OPENAI_BASE_URL).toBe("http://127.0.0.1:60009/v1");
  });

  it("codex + official OpenAI baseUrl does not route via proxy", () => {
    const env: Record<string, string> = {
      CHAT2RESPONSE_PROXY_URL: "https://chat2response.example.com/proxy",
    };
    const config = createBaseConfig({
      engineType: "codex",
      apiProtocol: "openai",
      baseUrl: "https://api.openai.com/v1",
      apiKey: "sk-openai",
    });

    const result = applyOpenAICompatibleEnv(config, env);

    expect(result.chat2responseReason).toBe("official-openai-baseurl");
    expect(result.openAIBaseUrlSource).toBe("env.OPENAI_BASE_URL");
    expect(env.OPENAI_BASE_URL).toBe("https://api.openai.com/v1");
    expect(env.NUWAX_CHAT2RESPONSE_UPSTREAM_BASE_URL).toBeUndefined();
  });

  it("nuwaxcode keeps standard OpenAI-compatible injection behavior", () => {
    const env: Record<string, string> = {};
    const config = createBaseConfig({
      engineType: "nuwaxcode",
      apiProtocol: "openai",
      baseUrl: "https://api.qwen.example.com/v1",
      apiKey: "sk-qwen",
      model: "openai-compatible/qwen-max",
    });

    const result = applyOpenAICompatibleEnv(config, env);

    expect(result.isOpenAICompatible).toBe(true);
    expect(result.chat2responseReason).toBe("not-applicable");
    expect(env.OPENAI_API_KEY).toBe("sk-qwen");
    expect(env.OPENAI_BASE_URL).toBe("https://api.qwen.example.com/v1");
  });
});
