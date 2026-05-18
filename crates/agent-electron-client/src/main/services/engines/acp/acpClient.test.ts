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
  it("nuwaxcode injects standard OpenAI-compatible env vars", () => {
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
    expect(env.OPENAI_API_KEY).toBe("sk-qwen");
    expect(env.OPENAI_BASE_URL).toBe("https://api.qwen.example.com/v1");
  });

  it("does not inject OpenAI env vars for provider-native models", () => {
    const env: Record<string, string> = {};
    const config = createBaseConfig({
      engineType: "nuwaxcode",
      apiProtocol: "anthropic",
      baseUrl: "https://anthropic.example.com",
      apiKey: "sk-anthropic",
      model: "claude-sonnet-4-5",
    });

    const result = applyOpenAICompatibleEnv(config, env);

    expect(result.isOpenAICompatible).toBe(false);
    expect(env.OPENAI_API_KEY).toBeUndefined();
    expect(env.OPENAI_BASE_URL).toBeUndefined();
  });
});
