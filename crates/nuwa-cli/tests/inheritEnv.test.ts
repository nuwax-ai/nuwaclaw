import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { buildEngineEnv } from "../src/core/env/inheritEnv.js";

// This suite runs inside a Claude Code session, whose own process.env may
// already carry ANTHROPIC_*/CODEX_* vars for its own purposes — so every
// test that asserts on those keys must save/restore them to stay
// deterministic regardless of the ambient environment it runs in.
const WATCHED_KEYS = [
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_BASE_URL",
  "ANTHROPIC_MODEL",
  "CODEX_API_KEY",
  "CODEX_BASE_URL",
  "CODEX_MODEL",
  "NODE_OPTIONS",
  "ELECTRON_RUN_AS_NODE",
  "NUWAX_SERVER_HOST",
  "NUWAX_SAVED_KEY",
  "NUWAX_AGENT_PORT",
  "NUWAX_FILE_SERVER_PORT",
  "NUWACLI_FORCE_ENGINE",
  "NUWACLI_PASSWORD",
  "NUWACLI_SERVE_LOCK_PATH",
  "NUWACLI_CODEX_ACP_BIN",
  "CODEX_ACP_BIN",
  "CLAUDE_CODE_ACP_PATH",
  "npm_config_registry",
];

let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = Object.fromEntries(WATCHED_KEYS.map((k) => [k, process.env[k]]));
  for (const k of WATCHED_KEYS) delete process.env[k];
});

afterEach(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe("buildEngineEnv", () => {
  it("passes HOME and other user env through untouched by default", () => {
    const original = { ...process.env };
    const env = buildEngineEnv("claude");
    expect(env.HOME).toBe(original.HOME);
    expect(env.PATH).toBe(original.PATH);
  });

  it("injects nothing beyond the base env when no overlay is given", () => {
    const env = buildEngineEnv("claude");
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(env.CODEX_API_KEY).toBeUndefined();
  });

  it("strips noise vars that belong to this process, not the user's shell", () => {
    Object.assign(process.env, {
      NODE_OPTIONS: "--inspect",
      ELECTRON_RUN_AS_NODE: "1",
      NUWAX_SERVER_HOST: "https://electron.example",
      NUWAX_SAVED_KEY: "electron-key",
      NUWAX_AGENT_PORT: "60005",
      NUWAX_FILE_SERVER_PORT: "60006",
      NUWACLI_FORCE_ENGINE: "codex",
      NUWACLI_PASSWORD: "secret",
      NUWACLI_SERVE_LOCK_PATH: "/tmp/electron.lock",
      NUWACLI_CODEX_ACP_BIN: "/tmp/codex-acp",
      CODEX_ACP_BIN: "/tmp/codex-acp",
      CLAUDE_CODE_ACP_PATH: "/tmp/claude-acp",
      npm_config_registry: "https://example.com",
    });
    const env = buildEngineEnv("claude");
    expect(env.NODE_OPTIONS).toBeUndefined();
    expect(env.ELECTRON_RUN_AS_NODE).toBeUndefined();
    expect(env.NUWAX_SERVER_HOST).toBeUndefined();
    expect(env.NUWAX_SAVED_KEY).toBeUndefined();
    expect(env.NUWAX_AGENT_PORT).toBeUndefined();
    expect(env.NUWAX_FILE_SERVER_PORT).toBeUndefined();
    expect(env.NUWACLI_FORCE_ENGINE).toBeUndefined();
    expect(env.NUWACLI_PASSWORD).toBeUndefined();
    expect(env.NUWACLI_SERVE_LOCK_PATH).toBeUndefined();
    expect(env.NUWACLI_CODEX_ACP_BIN).toBeUndefined();
    expect(env.CODEX_ACP_BIN).toBeUndefined();
    expect(env.CLAUDE_CODE_ACP_PATH).toBeUndefined();
    expect(env.npm_config_registry).toBeUndefined();
  });

  it("applies overlay only to the fields the user explicitly set, per engine", () => {
    const claudeEnv = buildEngineEnv("claude", { apiKey: "sk-test" });
    expect(claudeEnv.ANTHROPIC_API_KEY).toBe("sk-test");
    expect(claudeEnv.ANTHROPIC_BASE_URL).toBeUndefined();

    const codexEnv = buildEngineEnv("codex", {
      baseUrl: "https://example.com/v1",
    });
    expect(codexEnv.CODEX_BASE_URL).toBe("https://example.com/v1");
    expect(codexEnv.CODEX_API_KEY).toBeUndefined();
  });
});
