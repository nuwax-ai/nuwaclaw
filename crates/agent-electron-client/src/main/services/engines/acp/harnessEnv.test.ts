import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { applyHarnessModelEnv, applyHarnessRuntimeEnv } from "./harnessEnv";

describe("Harness environment", () => {
  it.each([
    ["openai", "chat", undefined],
    ["responses", "responses", undefined],
    ["anthropic", undefined, "anthropic"],
  ])("selects the %s model protocol", (apiProtocol, wire, protocol) => {
    const env: Record<string, string> = {};
    const needsAuth = applyHarnessModelEnv(
      {
        baseUrl: "https://gateway.example",
        apiKey: "gateway-key",
        apiProtocol,
      },
      env,
    );
    expect(needsAuth).toBe(false);
    expect(env.NUWAX_WIRE_API).toBe(wire);
    expect(env.NUWAX_API_PROTOCOL).toBe(protocol);
    expect(env.NUWAX_API_KEY).toBe("gateway-key");
  });

  it("ignores old engine settings and keeps gateway credentials paired", () => {
    const env: Record<string, string> = {
      OPENAI_API_KEY: "different-gateway-key",
      CODEX_MODEL: "legacy",
      NUWAX_MODEL: "openai-compatible/current",
      CODEX_WIRE_API: "chat",
      NUWAX_API_PROTOCOL: "anthropic",
      NUWAX_MODEL_CONTEXT_WINDOW: "32000",
      CODEX_API_KEY: "legacy-engine-key",
    };
    expect(
      applyHarnessModelEnv({ baseUrl: "https://gateway.example" }, env),
    ).toBe(false);
    expect(env).toEqual({
      NUWAX_BASE_URL: "https://gateway.example",
      NUWAX_MODEL: "current",
      NUWAX_API_PROTOCOL: "anthropic",
      NUWAX_MODEL_CONTEXT_WINDOW: "32000",
      NUWAX_PROVIDER_ID: "zhipu-glm-5",
    });
  });

  it("uses the OpenAI credential variable for the adapter's direct ACP login", () => {
    const env: Record<string, string> = { NUWAX_API_KEY: "direct-key" };
    expect(applyHarnessModelEnv({}, env)).toBe(true);
    expect(env.OPENAI_API_KEY).toBe("direct-key");
    expect(env).not.toHaveProperty("NUWAX_API_KEY");
  });

  it("uses its own isolated home even if the old engine's state exists", () => {
    const isolatedHome = fs.mkdtempSync(path.join(os.tmpdir(), "harness-env-"));
    try {
      const engineHome = path.join(isolatedHome, ".nuwax-harness");
      const legacyHome = path.join(isolatedHome, ".codex");
      fs.mkdirSync(legacyHome);
      const env: Record<string, string> = {
        CODEX_PATH: "old-binary",
        CODEX_HOME: legacyHome,
        NUWAX_HOME: legacyHome,
      };
      applyHarnessModelEnv({}, env);
      applyHarnessRuntimeEnv(env, "bundled-harness", isolatedHome, "logs");
      expect(env).toMatchObject({
        NUWAX_PATH: "bundled-harness",
        NUWAX_HOME: engineHome,
        CODEX_SQLITE_HOME: engineHome,
        APP_SERVER_LOGS: "logs",
      });
      expect(env).not.toHaveProperty("CODEX_PATH");
      expect(env).not.toHaveProperty("CODEX_HOME");
      expect(fs.statSync(engineHome).isDirectory()).toBe(true);
      expect(fs.statSync(legacyHome).isDirectory()).toBe(true);
    } finally {
      fs.rmSync(isolatedHome, { recursive: true, force: true });
    }
  });
});
