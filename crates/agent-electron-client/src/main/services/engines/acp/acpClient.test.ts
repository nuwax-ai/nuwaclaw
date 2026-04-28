import { describe, it, expect } from "vitest";
import {
  applyOpenAICompatibleEnv,
  type OpenAICompatInput,
} from "./openAICompatRouting";

function createBaseConfig(
  overrides: Partial<OpenAICompatInput>,
): OpenAICompatInput {
  return {
    ...overrides,
  };
}

describe("applyOpenAICompatibleEnv", () => {
  it("codex-cli + domestic baseUrl routes to chat2response proxy", () => {
    const env: Record<string, string> = {
      CHAT2RESPONSE_PROXY_URL: "https://chat2response.example.com/proxy",
    };
    const config = createBaseConfig({
      engineType: "codex-cli",
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

  it("codex-cli + official OpenAI baseUrl does not route via proxy", () => {
    const env: Record<string, string> = {
      CHAT2RESPONSE_PROXY_URL: "https://chat2response.example.com/proxy",
    };
    const config = createBaseConfig({
      engineType: "codex-cli",
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
