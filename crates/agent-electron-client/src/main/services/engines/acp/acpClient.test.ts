import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  applyOpenAICompatibleEnv,
  resolveOpenAICompatModel,
  type OpenAICompatInput,
} from "./openAICompatRouting";

const mockGetNodeBinPathWithFallback = vi.fn(
  () =>
    "/Applications/NuwaClaw.app/Contents/Resources/node/darwin-arm64/bin/node",
);
const mockResolveCustomAgentBinary = vi.fn(() => null);

vi.mock("electron-log", () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock("electron", () => ({
  app: {
    getPath: vi.fn(() => "/tmp"),
    getAppPath: vi.fn(() => "/tmp/app"),
  },
}));

vi.mock("../../system/dependencies", () => ({
  getAppEnv: vi.fn(() => ({ PATH: "/mock" })),
  applySharedPackageManagerCacheEnv: vi.fn(
    (env: Record<string, string>) => env,
  ),
  getNuwaxcodeBundledBinPath: vi.fn(() => null),
  getCodexAcpBundledBinPath: vi.fn(() => null),
  getNodeBinPathWithFallback: () => mockGetNodeBinPathWithFallback(),
  getClaudeCodeAcpBundledDir: vi.fn(() => null),
}));

vi.mock("../../agentInstaller", () => ({
  resolveCustomAgentBinary: (...args: unknown[]) =>
    mockResolveCustomAgentBinary(...args),
}));

vi.mock("../../utils/spawnNoWindow", () => ({
  spawnJsFile: vi.fn(),
  resolveNpmPackageEntry: vi.fn(),
  resolveNpmBinShimSpawnTarget: vi.fn(() => null),
}));

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

describe("resolveAcpBinary — custom node agent", () => {
  beforeEach(() => {
    mockGetNodeBinPathWithFallback.mockReset();
    mockGetNodeBinPathWithFallback.mockReturnValue(
      "/Applications/NuwaClaw.app/Contents/Resources/node/darwin-arm64/bin/node",
    );
    mockResolveCustomAgentBinary.mockReset();
    mockResolveCustomAgentBinary.mockReturnValue(null);
  });

  it("resolves command=node to bundled Node absolute path", async () => {
    const { resolveAcpBinary, isNodeInterpreterCommand } =
      await import("./acpClient");

    expect(isNodeInterpreterCommand("node")).toBe(true);
    expect(isNodeInterpreterCommand("node.exe")).toBe(true);
    expect(isNodeInterpreterCommand("/usr/bin/node")).toBe(false);

    const resolved = resolveAcpBinary("node");
    expect(resolved.binPath).toBe(
      "/Applications/NuwaClaw.app/Contents/Resources/node/darwin-arm64/bin/node",
    );
    expect(resolved.binArgs).toEqual([]);
    expect(resolved.isNative).toBe(true);
    // 已解析为 bundled node，不应再走 which/PATH 回退
    expect(mockResolveCustomAgentBinary).not.toHaveBeenCalled();
  });

  it("falls through when bundled node is unavailable", async () => {
    mockGetNodeBinPathWithFallback.mockReturnValue(null);
    mockResolveCustomAgentBinary.mockReturnValue(null);

    const { resolveAcpBinary } = await import("./acpClient");
    const resolved = resolveAcpBinary("node");
    // 无 bundled node 时仍回退裸命令名（由 spawn/PATH 处理）
    expect(resolved.binPath).toBe("node");
    expect(mockResolveCustomAgentBinary).toHaveBeenCalledWith("node");
  });
});
