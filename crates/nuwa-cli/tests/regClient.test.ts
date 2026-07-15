import { describe, it, expect, vi, afterEach } from "vitest";
import {
  registerClient,
  normalizeServerHost,
  defaultSandboxValue,
  RegError,
} from "../src/core/auth/regClient.js";
import { CLI_AGENT_PORT, CLI_FILE_SERVER_PORT } from "../src/core/ports.js";

function mockFetchOnce(status: number, body: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      statusText: "mock",
      json: async () => body,
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("normalizeServerHost", () => {
  it("prepends https:// when no scheme is given", () => {
    expect(normalizeServerHost("agent.nuwax.com")).toBe(
      "https://agent.nuwax.com",
    );
  });

  it("preserves an explicit scheme and strips trailing slashes", () => {
    expect(normalizeServerHost("http://localhost:8080/")).toBe(
      "http://localhost:8080",
    );
  });

  it("passes through empty input unchanged", () => {
    expect(normalizeServerHost("  ")).toBe("");
  });
});

describe("registerClient", () => {
  const params = {
    username: "u",
    password: "p",
    sandboxConfigValue: {
      agentPort: 60016,
      vncPort: 0,
      fileServerPort: 60015,
      guiMcpPort: 0,
      adminServerPort: 0,
    },
  };

  it("returns data on a 0000 envelope", async () => {
    mockFetchOnce(200, {
      code: "0000",
      message: "ok",
      success: true,
      data: { id: 1, configKey: "ck", name: "u", online: true },
    });
    const result = await registerClient("https://example.com", params);
    expect(result.configKey).toBe("ck");
  });

  it("throws RegError with the mapped message for a known error code", async () => {
    mockFetchOnce(200, {
      code: "4011",
      message: "",
      success: false,
      data: null,
    });
    await expect(
      registerClient("https://example.com", params),
    ).rejects.toMatchObject({
      message: "登录已过期",
      code: "4011",
    });
  });

  it("throws RegError using the server's own message when present", async () => {
    mockFetchOnce(200, {
      code: "1234",
      message: "custom failure",
      success: false,
      data: null,
    });
    await expect(registerClient("https://example.com", params)).rejects.toThrow(
      "custom failure",
    );
  });

  it("throws on a non-2xx HTTP response", async () => {
    mockFetchOnce(500, {});
    await expect(registerClient("https://example.com", params)).rejects.toThrow(
      /HTTP 500/,
    );
  });

  it("throws RegError on a network-level failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("network down")),
    );
    await expect(
      registerClient("https://example.com", params),
    ).rejects.toBeInstanceOf(RegError);
  });
});

describe("defaultSandboxValue", () => {
  it("uses the CLI-owned agent and file-server ports by default", () => {
    expect(defaultSandboxValue()).toMatchObject({
      agentPort: CLI_AGENT_PORT,
      fileServerPort: CLI_FILE_SERVER_PORT,
    });
  });

  it("allows serve --tunnel to override the current agent port", () => {
    expect(defaultSandboxValue({ agentPort: 12345 })).toMatchObject({
      agentPort: 12345,
      fileServerPort: CLI_FILE_SERVER_PORT,
    });
  });
});
