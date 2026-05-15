import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { AUTH_KEYS, STORAGE_KEYS } from "@shared/constants";
import {
  getDomainTokenKey,
  getWorkbenchAccessTokenKey,
} from "@shared/utils/domain";
import {
  loadWorkbenchConfig,
  WORKBENCH_APP_AGENT_ID_SETTING_KEY,
  WORKBENCH_LOCALE_SETTING_KEY,
} from "./workbenchConfig";

let store: Record<string, unknown> = {};

const mockSettingsGet = vi.fn(async (key: string) => store[key] ?? null);

vi.stubGlobal("window", {
  electronAPI: {
    settings: {
      get: mockSettingsGet,
    },
  },
});

describe("loadWorkbenchConfig", () => {
  beforeEach(() => {
    store = {};
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("appAgentId 优先使用 auth userInfo", async () => {
    vi.stubEnv("VITE_NUWAX_APP_AGENT_ID", "env-agent");
    store[AUTH_KEYS.USER_INFO] = {
      currentDomain: "https://app.example.com",
      appAgentId: "auth-agent",
    };
    store[WORKBENCH_APP_AGENT_ID_SETTING_KEY] = "setting-agent";

    const result = await loadWorkbenchConfig();

    expect(result.config.appAgentId).toBe("auth-agent");
  });

  it("appAgentId 缺少 userInfo 时回退到 setting", async () => {
    vi.stubEnv("VITE_NUWAX_APP_AGENT_ID", "env-agent");
    store[AUTH_KEYS.USER_INFO] = {
      currentDomain: "https://app.example.com",
    };
    store[WORKBENCH_APP_AGENT_ID_SETTING_KEY] = "setting-agent";

    const result = await loadWorkbenchConfig();

    expect(result.config.appAgentId).toBe("setting-agent");
  });

  it("appAgentId 缺少 userInfo 和 setting 时回退到 env", async () => {
    vi.stubEnv("VITE_NUWAX_APP_AGENT_ID", "env-agent");
    store[AUTH_KEYS.USER_INFO] = {
      currentDomain: "https://app.example.com",
    };

    const result = await loadWorkbenchConfig();

    expect(result.config.appAgentId).toBe("env-agent");
  });

  it("baseUrl 优先使用 auth currentDomain，并使用域名 token cache", async () => {
    store[AUTH_KEYS.USER_INFO] = {
      currentDomain: "https://current.example.com///",
      app_agent_id: "auth-agent",
    };
    store[STORAGE_KEYS.STEP1_CONFIG] = {
      serverHost: "https://step.example.com",
      workspaceDir: "/tmp/workspace",
    };
    store[getDomainTokenKey("https://current.example.com")] = "domain-token";

    const result = await loadWorkbenchConfig();

    expect(result.config.baseUrl).toBe("https://current.example.com");
    expect(result.config.accessToken).toBe("domain-token");
  });

  it("accessToken 优先使用 workbench 独立 token cache", async () => {
    store[AUTH_KEYS.USER_INFO] = {
      currentDomain: "https://current.example.com",
      app_agent_id: "auth-agent",
    };
    store[STORAGE_KEYS.STEP1_CONFIG] = {
      workspaceDir: "/tmp/workspace",
    };
    store[getDomainTokenKey("https://current.example.com")] = "domain-token";
    store[getWorkbenchAccessTokenKey("https://current.example.com")] =
      "workbench-token";

    const result = await loadWorkbenchConfig();

    expect(result.config.accessToken).toBe("workbench-token");
  });

  it("缺少一次性 token 时不会吞掉 workbench 独立 token 或误启 mock", async () => {
    store[AUTH_KEYS.AUTH_TOKEN] = "   ";
    store[AUTH_KEYS.USER_INFO] = {
      currentDomain: "https://current.example.com",
      appAgentId: "auth-agent",
      token: "fallback-user-token",
    };
    store[STORAGE_KEYS.STEP1_CONFIG] = {
      workspaceDir: "/tmp/workspace",
    };
    store[getWorkbenchAccessTokenKey("https://current.example.com")] =
      "workbench-token";

    const result = await loadWorkbenchConfig();

    expect(result.config.accessToken).toBe("workbench-token");
    expect(result.missing.accessToken).toBe(false);
    expect(result.missing.appAgentId).toBe(false);
    expect(result.useMock).toBe(false);
    expect(result.config.useMock).toBe(false);
  });

  it("baseUrl 缺少 currentDomain 时回退到 step1_config.serverHost", async () => {
    store[AUTH_KEYS.USER_INFO] = {
      appAgent: { id: "auth-agent" },
    };
    store[STORAGE_KEYS.STEP1_CONFIG] = {
      serverHost: "https://step.example.com/",
    };
    store[AUTH_KEYS.AUTH_TOKEN] = "one-shot-token";

    const result = await loadWorkbenchConfig();

    expect(result.config.baseUrl).toBe("https://step.example.com");
    expect(result.config.accessToken).toBe("one-shot-token");
  });

  it("workspaceDir 来自 step1_config，locale 来自现有 i18n setting", async () => {
    store[AUTH_KEYS.USER_INFO] = {
      currentDomain: "https://app.example.com",
      appAgentId: "auth-agent",
    };
    store[STORAGE_KEYS.STEP1_CONFIG] = {
      workspaceDir: "/Users/me/project",
    };
    store[WORKBENCH_LOCALE_SETTING_KEY] = "zh-CN";

    const result = await loadWorkbenchConfig();

    expect(result.config.workspaceDir).toBe("/Users/me/project");
    expect(result.config.locale).toBe("zh-cn");
    expect(result.config.previewContainer).toBe("electron-webview");
  });

  it("返回缺失状态，并在缺 token 或 appAgentId 时允许 useMock", async () => {
    const result = await loadWorkbenchConfig();

    expect(result.missing).toEqual({
      baseUrl: true,
      accessToken: true,
      appAgentId: true,
      workspaceDir: true,
    });
    expect(result.missingKeys).toEqual([
      "baseUrl",
      "accessToken",
      "appAgentId",
      "workspaceDir",
    ]);
    expect(result.useMock).toBe(true);
    expect(result.config.useMock).toBe(true);
  });

  it("缺少 baseUrl 或 workspaceDir 不会在真实 token/appAgentId 存在时启用 mock", async () => {
    store[AUTH_KEYS.USER_INFO] = {
      token: "real-token",
      app_agent_id: "auth-agent",
    };

    const result = await loadWorkbenchConfig();

    expect(result.missing).toMatchObject({
      baseUrl: true,
      accessToken: false,
      appAgentId: false,
      workspaceDir: true,
    });
    expect(result.missingKeys).toEqual(["baseUrl", "workspaceDir"]);
    expect(result.useMock).toBe(false);
    expect(result.config.useMock).toBe(false);
  });
});
