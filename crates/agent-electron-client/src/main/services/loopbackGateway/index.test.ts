/**
 * 单元测试：loopbackGateway 编排 —— 运行时键携带 backend（域名变更可被
 * refreshLoopbackGateway 检测并通知 renderer 重载 webview）。
 *
 * 背景（设计文档 §6）：serverHost 是前后端一体域名；仅域名变化时网关
 * origin/形态不变，旧行为的变更检测键（enabled/origin/mode）完全相同，
 * 导致 renderer 永远收不到 nuwax:loopback-changed。
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => {
  const store = new Map<string, unknown>();
  const sendSpy = vi.fn();
  return {
    store,
    sendSpy,
    startGateway: vi.fn(),
    readSetting: (key: string) => store.get(key) ?? null,
    writeSetting: (key: string, value: unknown) => {
      store.set(key, value);
    },
  };
});

vi.mock("electron", () => ({
  app: {
    isPackaged: true,
    getAppPath: () => "/app",
    getPath: () => "/tmp",
  },
  session: {
    defaultSession: { webRequest: { onBeforeRequest: vi.fn() } },
  },
  webContents: { fromId: vi.fn(() => null) },
  BrowserWindow: {
    getAllWindows: () => [{ webContents: { send: mocks.sendSpy } }],
  },
}));

vi.mock("electron-log", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../../db", () => ({
  readSetting: (key: string) => mocks.readSetting(key),
  writeSetting: (key: string, value: unknown) => mocks.writeSetting(key, value),
}));

vi.mock("../startupPorts", () => ({
  getConfiguredPorts: () => ({ agent: 60006 }),
}));

vi.mock("../../ipc/nuwaxBridgeHandlers", () => ({
  NUWAX_TOKEN_KEY_PREFIX: "nuwax.accessToken.",
}));

vi.mock("./gateway", () => ({
  startLoopbackGateway: mocks.startGateway,
}));

async function importFresh() {
  vi.resetModules();
  // ensure/refresh 依赖模块级 running 状态，每用例重新加载
  return await import("./index");
}

function fakeHandle() {
  return {
    origin: "http://127.0.0.1:46800",
    mode: "proxy" as const,
    close: vi.fn(async () => {}),
  };
}

describe("loopbackGateway runtime key carries backend", () => {
  beforeEach(() => {
    mocks.store.clear();
    mocks.sendSpy.mockClear();
    mocks.startGateway.mockReset().mockImplementation(async () => fakeHandle());
    // proxy 形态：gateway 模式 + dist 不可达（process.resourcesPath 指向空目录）
    process.resourcesPath = "/nonexistent-resources";
  });

  it("ensure writes the runtime key with the resolved backend origin", async () => {
    mocks.store.set("step1_config", {
      nuwaxLoadMode: "gateway",
      serverHost: "https://a.example.com",
    });
    const { ensureLoopbackGateway } = await importFresh();
    const handle = await ensureLoopbackGateway();

    expect(handle?.origin).toBe("http://127.0.0.1:46800");
    expect(mocks.startGateway).toHaveBeenCalledWith(
      expect.objectContaining({ targetOrigin: "https://a.example.com" }),
    );
    expect(mocks.store.get("nuwax.loopback")).toMatchObject({
      enabled: true,
      origin: "http://127.0.0.1:46800",
      backend: "https://a.example.com",
    });
  });

  it("notifies the renderer when only the domain changed (backend differs)", async () => {
    mocks.store.set("step1_config", {
      nuwaxLoadMode: "gateway",
      serverHost: "https://a.example.com",
    });
    const mod = await importFresh();
    await mod.ensureLoopbackGateway();
    expect(mocks.sendSpy).not.toHaveBeenCalled();

    // 域名切换：serverHost 前后端一体，后端域随之变化
    mocks.store.set("step1_config", {
      nuwaxLoadMode: "gateway",
      serverHost: "https://b.example.com",
    });
    await mod.refreshLoopbackGateway();

    // 网关以新后端重启 + renderer 收到重载通知（旧行为：键不变 → 静默跳过）
    expect(mocks.startGateway).toHaveBeenLastCalledWith(
      expect.objectContaining({ targetOrigin: "https://b.example.com" }),
    );
    expect(mocks.sendSpy).toHaveBeenCalledTimes(1);
    expect(mocks.sendSpy).toHaveBeenCalledWith(
      "nuwax:loopback-changed",
      expect.objectContaining({ backend: "https://b.example.com" }),
    );
  });

  it("stays silent when nothing changed (no reload flicker)", async () => {
    mocks.store.set("step1_config", {
      nuwaxLoadMode: "gateway",
      serverHost: "https://a.example.com",
    });
    const mod = await importFresh();
    await mod.ensureLoopbackGateway();
    await mod.refreshLoopbackGateway();

    expect(mocks.sendSpy).not.toHaveBeenCalled();
  });
});

describe("syncWebviewOverrideFromEnv (NUWAX_WEBVIEW_ORIGIN)", () => {
  beforeEach(() => {
    mocks.store.clear();
    delete process.env.NUWAX_WEBVIEW_ORIGIN;
  });

  it("writes the override runtime key when the env is set (protocol normalized)", async () => {
    process.env.NUWAX_WEBVIEW_ORIGIN = "localhost:5173/";
    const { syncWebviewOverrideFromEnv } = await importFresh();
    syncWebviewOverrideFromEnv();

    expect(mocks.store.get("nuwax.webviewOverride")).toEqual({
      origin: "https://localhost:5173",
    });
  });

  it("clears the key when the env is absent (前后端一体默认)", async () => {
    mocks.store.set("nuwax.webviewOverride", {
      origin: "http://localhost:3000",
    });
    const { syncWebviewOverrideFromEnv } = await importFresh();
    syncWebviewOverrideFromEnv();

    expect(mocks.store.get("nuwax.webviewOverride")).toEqual({ origin: null });
  });
});
