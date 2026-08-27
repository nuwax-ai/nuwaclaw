/**
 * 单元测试：lanproxy 三层健康检查（进程存活 + 云端隧道回探）
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockReadSetting = vi.fn();

vi.mock("electron-log", () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock("../../db", () => ({
  readSetting: (...args: unknown[]) => mockReadSetting(...args),
}));

vi.mock("../i18n", () => ({
  t: (key: string) => key,
}));

import {
  confirmLanproxyHealthy,
  waitForLanproxyTunnel,
  getBusinessDomain,
  normalizeBusinessDomain,
  isLanproxyTunnelEnvelopeHealthy,
  checkLanproxyHealth,
  probeLanproxyAfterStart,
} from "./lanproxyHealth";

describe("normalizeBusinessDomain / getBusinessDomain", () => {
  beforeEach(() => {
    mockReadSetting.mockReset();
  });

  it("adds https and strips trailing slash", () => {
    expect(normalizeBusinessDomain("agent.nuwax.com/")).toBe(
      "https://agent.nuwax.com",
    );
    expect(normalizeBusinessDomain("https://example.com/path/")).toBe(
      "https://example.com/path",
    );
  });

  it("prefers step1_config.serverHost as business domain", () => {
    mockReadSetting.mockImplementation((key: string) => {
      if (key === "step1_config") {
        return { serverHost: "https://biz.example.com" };
      }
      if (key === "lanproxy.server_host") return "tunnel.internal";
      return null;
    });
    expect(getBusinessDomain()).toBe("https://biz.example.com");
  });

  it("falls back to lanproxy.server_host when step1 is missing", () => {
    mockReadSetting.mockImplementation((key: string) => {
      if (key === "lanproxy.server_host") return "legacy.example.com";
      return null;
    });
    expect(getBusinessDomain()).toBe("https://legacy.example.com");
  });

  it("falls back to DEFAULT_SERVER_HOST when nothing is configured", () => {
    mockReadSetting.mockReturnValue(null);
    expect(getBusinessDomain()).toBe("https://agent.nuwax.com");
  });
});

describe("isLanproxyTunnelEnvelopeHealthy", () => {
  it("accepts code 0000, success true, or data.online", () => {
    expect(isLanproxyTunnelEnvelopeHealthy({ code: "0000" })).toBe(true);
    expect(isLanproxyTunnelEnvelopeHealthy({ success: true })).toBe(true);
    expect(isLanproxyTunnelEnvelopeHealthy({ data: { online: true } })).toBe(
      true,
    );
    expect(isLanproxyTunnelEnvelopeHealthy({ code: "9999" })).toBe(false);
  });
});

describe("confirmLanproxyHealthy", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns false when pid is undefined", async () => {
    expect(await confirmLanproxyHealthy(undefined, 0)).toBe(false);
  });

  it("returns true when the pid stays alive across the stabilize window", async () => {
    const killSpy = vi.spyOn(process, "kill").mockReturnValue(true);
    expect(await confirmLanproxyHealthy(9999, 0)).toBe(true);
    killSpy.mockRestore();
  });

  it("returns false when the pid dies during the stabilize window", async () => {
    let alive = true;
    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => {
      if (alive) return true;
      const err = new Error("ESRCH") as NodeJS.ErrnoException;
      err.code = "ESRCH";
      throw err;
    });

    const promise = confirmLanproxyHealthy(9999, 20);
    await new Promise((resolve) => setTimeout(resolve, 10));
    alive = false;
    expect(await promise).toBe(false);
    killSpy.mockRestore();
  });
});

describe("waitForLanproxyTunnel", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("resolves true when the cloud reports code 0000", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ code: "0000", success: true, data: {} }),
    } as Response);

    const ok = await waitForLanproxyTunnel(
      "https://example.com",
      "config-key",
      1000,
      10,
    );

    expect(ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://example.com/api/sandbox/config/health/config-key",
      expect.any(Object),
    );
  });

  it("resolves true when data.online becomes true after retries", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValueOnce(new Error("ECONNREFUSED"))
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ code: "9999", success: false }),
      } as Response)
      .mockResolvedValue({
        ok: true,
        json: async () => ({
          code: "9999",
          success: false,
          data: { online: true },
        }),
      } as Response);

    const ok = await waitForLanproxyTunnel(
      "https://example.com/",
      "config-key",
      5000,
      10,
    );

    expect(ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("resolves false when the tunnel never comes online within timeout", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ code: "9999", success: false }),
    } as Response);

    const ok = await waitForLanproxyTunnel(
      "https://example.com",
      "config-key",
      80,
      10,
    );
    expect(ok).toBe(false);
  });

  it("resolves false without a request when domain or configKey is missing", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    expect(await waitForLanproxyTunnel("", "config-key", 100, 10)).toBe(false);
    expect(
      await waitForLanproxyTunnel("https://example.com", "", 100, 10),
    ).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fast-fails on 404 without waiting for full timeout", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({}),
    } as Response);

    const started = Date.now();
    const ok = await waitForLanproxyTunnel(
      "https://example.com",
      "config-key",
      10_000,
      500,
    );
    expect(ok).toBe(false);
    expect(Date.now() - started).toBeLessThan(2000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("fast-fails when 200 returns non-JSON (probe aimed at an SPA fallback)", async () => {
    // 场景：serverHost 被误设为前端域，探针打到 SPA 的 HTML fallback（200 + text/html）
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ "content-type": "text/html" }),
      json: async () => {
        throw new SyntaxError("Unexpected token '<'");
      },
    } as unknown as Response);

    const started = Date.now();
    const ok = await waitForLanproxyTunnel(
      "http://localhost:3000",
      "config-key",
      10_000,
      500,
    );
    expect(ok).toBe(false);
    // 快失败：不重试至超时（旧行为是静默吞掉解析错误轮询满 10s）
    expect(Date.now() - started).toBeLessThan(2000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("checkLanproxyHealth", () => {
  beforeEach(() => {
    mockReadSetting.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("uses business domain from step1_config, not lanproxy.server_host", async () => {
    mockReadSetting.mockImplementation((key: string) => {
      if (key === "step1_config") {
        return { serverHost: "https://biz.example.com" };
      }
      // 即便隧道地址存在，也不应被使用
      if (key === "lanproxy.server_host") return "tunnel.internal";
      return null;
    });

    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ code: "0000", message: "ok", data: {} }),
    } as Response);

    const result = await checkLanproxyHealth("my-key");
    expect(result.healthy).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://biz.example.com/api/sandbox/config/health/my-key",
      expect.any(Object),
    );
  });

  it("returns unhealthy when business domain resolve still yields empty", async () => {
    // getBusinessDomain 现有 DEFAULT 兜底；此处验证 savedKey 为空的快失败
    const fetchMock = vi.spyOn(globalThis, "fetch");
    const result = await checkLanproxyHealth("");
    expect(result.healthy).toBe(false);
    expect(result.error).toMatch(/empty/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("probeLanproxyAfterStart", () => {
  beforeEach(() => {
    mockReadSetting.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("skips cloud probe when process is not stable", async () => {
    vi.spyOn(process, "kill").mockImplementation(() => {
      throw Object.assign(new Error("ESRCH"), { code: "ESRCH" });
    });
    const fetchMock = vi.spyOn(globalThis, "fetch");

    const result = await probeLanproxyAfterStart(1234, "key", 0);
    expect(result.healthy).toBe(false);
    expect(result.error).toMatch(/not stable/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns healthy when process stable and tunnel online", async () => {
    vi.spyOn(process, "kill").mockReturnValue(true);
    mockReadSetting.mockImplementation((key: string) => {
      if (key === "step1_config") {
        return { serverHost: "https://biz.example.com" };
      }
      return null;
    });
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        code: "0000",
        message: "ok",
        data: { online: true },
      }),
    } as Response);

    // stabilizeMs=0：单测跳过 1s 稳定窗口
    const result = await probeLanproxyAfterStart(1234, "key", 0);
    expect(result).toEqual({ healthy: true });
  });

  it("includes the probed domain and configKey in the failure message", async () => {
    vi.spyOn(process, "kill").mockReturnValue(true);
    mockReadSetting.mockImplementation((key: string) => {
      if (key === "step1_config") {
        // serverHost 违反前后端一体不变量：被设成了前端域
        return { serverHost: "http://localhost:3000" };
      }
      return null;
    });
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ "content-type": "text/html" }),
      json: async () => {
        throw new SyntaxError("Unexpected token '<'");
      },
    } as unknown as Response);

    const result = await probeLanproxyAfterStart(1234, "cfg-123", 0);
    expect(result.healthy).toBe(false);
    // 报错带上探测目标——带偏场景一眼定位（此前是笼统的 timed out）
    expect(result.error).toContain("domain=http://localhost:3000");
    expect(result.error).toContain("configKey=cfg-123");
  });
});
