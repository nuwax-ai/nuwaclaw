import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  buildRedirectUrl,
  buildNewSessionUrl,
  buildChatSessionUrl,
  syncSessionCookie,
  syncCookieAndGetRedirectUrl,
  syncCookieAndGetNewSessionUrl,
  syncCookieAndGetChatUrl,
  persistTicketCookie,
} from "./sessionUrl";

const { mockSettings, mockSession, mockLogger } = vi.hoisted(() => ({
  mockSettings: { get: vi.fn(), set: vi.fn() },
  mockSession: { setCookie: vi.fn(), getCookie: vi.fn() },
  mockLogger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.stubGlobal("window", {
  electronAPI: { settings: mockSettings, session: mockSession },
});

const mockGetCurrentAuth = vi.fn();
vi.mock("../core/auth", () => ({
  getCurrentAuth: (...args: unknown[]) => mockGetCurrentAuth(...args),
}));
vi.mock("./logService", () => ({
  logger: mockLogger,
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockSession.setCookie.mockResolvedValue({ success: true });
  mockSession.getCookie.mockResolvedValue({ success: true, found: false });
});

describe("buildRedirectUrl", () => {
  it("strips trailing slashes and builds correct URL", () => {
    expect(buildRedirectUrl("https://example.com///", "user1")).toBe(
      "https://example.com/api/sandbox/config/redirect/user1?hideMenu=true",
    );
    expect(buildRedirectUrl("https://example.com/", "user1")).toBe(
      "https://example.com/api/sandbox/config/redirect/user1?hideMenu=true",
    );
    expect(buildRedirectUrl("https://example.com", "user1")).toBe(
      "https://example.com/api/sandbox/config/redirect/user1?hideMenu=true",
    );
  });

  it("works with numeric configId", () => {
    expect(buildRedirectUrl("https://example.com", 42)).toBe(
      "https://example.com/api/sandbox/config/redirect/42?hideMenu=true",
    );
  });
});

describe("buildNewSessionUrl", () => {
  it("builds correct new-session URL", () => {
    expect(buildNewSessionUrl("https://example.com", 42)).toBe(
      "https://example.com/api/sandbox/config/redirect/new/42?hideMenu=true",
    );
  });

  it("strips trailing slashes", () => {
    expect(buildNewSessionUrl("https://example.com///", 42)).toBe(
      "https://example.com/api/sandbox/config/redirect/new/42?hideMenu=true",
    );
  });
});

describe("buildChatSessionUrl", () => {
  it("builds correct URL with session id", () => {
    expect(buildChatSessionUrl("https://example.com", "sess-abc-123")).toBe(
      "https://example.com/api/sandbox/config/redirect/chat/sess-abc-123?hideMenu=true",
    );
  });

  it("strips trailing slashes", () => {
    expect(buildChatSessionUrl("https://example.com///", "s1")).toBe(
      "https://example.com/api/sandbox/config/redirect/chat/s1?hideMenu=true",
    );
  });
});

describe("syncSessionCookie", () => {
  it("不设 domain 和 secure，由主进程根据 URL scheme 判断", async () => {
    await syncSessionCookie("https://app.example.com:8080/path", "tok123");

    const payload = mockSession.setCookie.mock.calls[0][0];
    expect(payload).toEqual({
      url: "https://app.example.com:8080/path",
      name: "ticket",
      value: "tok123",
      httpOnly: true,
    });
    expect(payload).not.toHaveProperty("domain");
    expect(payload).not.toHaveProperty("secure");
  });

  it("invalid URL 也不设 domain 和 secure", async () => {
    await syncSessionCookie("not-a-valid-url", "tok123");

    const payload = mockSession.setCookie.mock.calls[0][0];
    expect(payload).toEqual({
      url: "not-a-valid-url",
      name: "ticket",
      value: "tok123",
      httpOnly: true,
    });
    expect(payload).not.toHaveProperty("domain");
    expect(payload).not.toHaveProperty("secure");
  });

  it("host-only cookie — 不设 domain，与 webview Set-Cookie 行为一致", async () => {
    await syncSessionCookie("https://example.com", "tok");

    const payload = mockSession.setCookie.mock.calls[0][0];
    expect(payload).not.toHaveProperty("domain");
  });

  it("IPv4 host 也不设 domain", async () => {
    await syncSessionCookie("http://127.0.0.1:8080", "tok-ip");

    const payload = mockSession.setCookie.mock.calls[0][0];
    expect(payload).toEqual({
      url: "http://127.0.0.1:8080",
      name: "ticket",
      value: "tok-ip",
      httpOnly: true,
    });
    expect(payload).not.toHaveProperty("domain");
  });

  it("localhost 也不设 domain", async () => {
    await syncSessionCookie("http://localhost:3000", "tok-local");

    const payload = mockSession.setCookie.mock.calls[0][0];
    expect(payload).toEqual({
      url: "http://localhost:3000",
      name: "ticket",
      value: "tok-local",
      httpOnly: true,
    });
    expect(payload).not.toHaveProperty("domain");
  });
});

describe("syncCookieAndGetRedirectUrl", () => {
  it("returns null when not logged in", async () => {
    mockGetCurrentAuth.mockResolvedValue({
      isLoggedIn: false,
      userInfo: null,
    });

    const result = await syncCookieAndGetRedirectUrl();
    expect(result).toBeNull();
    expect(mockSession.setCookie).not.toHaveBeenCalled();
  });

  it("returns null when domain is missing", async () => {
    mockGetCurrentAuth.mockResolvedValue({
      isLoggedIn: true,
      userInfo: { id: 1, username: "u" },
    });

    const result = await syncCookieAndGetRedirectUrl();
    expect(result).toBeNull();
    expect(mockSession.setCookie).not.toHaveBeenCalled();
  });

  it("returns null when userId is missing", async () => {
    mockGetCurrentAuth.mockResolvedValue({
      isLoggedIn: true,
      userInfo: { currentDomain: "https://example.com", username: "u" },
    });

    const result = await syncCookieAndGetRedirectUrl();
    expect(result).toBeNull();
    expect(mockSession.setCookie).not.toHaveBeenCalled();
  });

  it("returns redirect URL and syncs cookie when all present", async () => {
    mockGetCurrentAuth.mockResolvedValue({
      isLoggedIn: true,
      userInfo: { id: 7, currentDomain: "https://example.com", username: "u" },
    });
    mockSettings.get.mockResolvedValue("my-token");

    const result = await syncCookieAndGetRedirectUrl();
    expect(result).toBe(
      "https://example.com/api/sandbox/config/redirect/7?hideMenu=true",
    );
    expect(mockSession.setCookie).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "https://example.com",
        name: "ticket",
        value: "my-token",
      }),
    );
    // host-only cookie，不设 domain
    const payload = mockSession.setCookie.mock.calls[0][0];
    expect(payload).not.toHaveProperty("domain");
  });

  it("clears local auth token after syncing to webview cookie", async () => {
    mockGetCurrentAuth.mockResolvedValue({
      isLoggedIn: true,
      userInfo: { id: 7, currentDomain: "https://example.com", username: "u" },
    });
    mockSettings.get.mockResolvedValue("my-token");

    await syncCookieAndGetRedirectUrl();

    expect(mockSession.setCookie).toHaveBeenCalled();
    expect(mockSettings.set).toHaveBeenCalledWith("auth.token", null);
  });

  it("keeps local auth token when cookie sync fails", async () => {
    mockGetCurrentAuth.mockResolvedValue({
      isLoggedIn: true,
      userInfo: { id: 7, currentDomain: "https://example.com", username: "u" },
    });
    mockSettings.get.mockResolvedValue("my-token");
    mockSession.setCookie.mockResolvedValue({
      success: false,
      error: "cookie write failed",
    });

    await expect(syncCookieAndGetRedirectUrl()).rejects.toThrow(
      "cookie write failed",
    );
    expect(mockSettings.set).not.toHaveBeenCalledWith("auth.token", null);
  });

  it("returns URL without syncing cookie when token is null", async () => {
    mockGetCurrentAuth.mockResolvedValue({
      isLoggedIn: true,
      userInfo: { id: 7, currentDomain: "https://example.com", username: "u" },
    });
    mockSettings.get.mockResolvedValue(null);

    const result = await syncCookieAndGetRedirectUrl();
    expect(result).toBe(
      "https://example.com/api/sandbox/config/redirect/7?hideMenu=true",
    );
    expect(mockSession.setCookie).not.toHaveBeenCalled();
  });

  it("overwrites cookie when domain cache token exists (regardless of existing cookie)", async () => {
    mockGetCurrentAuth.mockResolvedValue({
      isLoggedIn: true,
      userInfo: { id: 7, currentDomain: "https://example.com", username: "u" },
    });
    mockSettings.get.mockImplementation((key: string) => {
      if (key === "auth.token") return Promise.resolve(null);
      if (key === "auth.tokens.example.com") return Promise.resolve("my-token");
      return Promise.resolve(null);
    });

    const result = await syncCookieAndGetRedirectUrl();
    expect(result).toBe(
      "https://example.com/api/sandbox/config/redirect/7?hideMenu=true",
    );
    // 有 token 时无条件覆盖，不管现有 cookie 状态
    expect(mockSession.setCookie).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "https://example.com",
        name: "ticket",
        value: "my-token",
      }),
    );
  });

  it("overwrites existing ticket when one-shot auth token is present", async () => {
    mockGetCurrentAuth.mockResolvedValue({
      isLoggedIn: true,
      userInfo: { id: 7, currentDomain: "https://example.com", username: "u" },
    });
    mockSettings.get.mockResolvedValue("fresh-token");
    mockSession.getCookie.mockResolvedValue({ success: true, found: true });

    const result = await syncCookieAndGetRedirectUrl();
    expect(result).toBe(
      "https://example.com/api/sandbox/config/redirect/7?hideMenu=true",
    );
    expect(mockSession.setCookie).toHaveBeenCalled();
    expect(mockSettings.set).toHaveBeenCalledWith("auth.token", null);
  });

  it("prints diagnostic logs regardless of NODE_ENV", async () => {
    mockGetCurrentAuth.mockResolvedValue({
      isLoggedIn: true,
      userInfo: { id: 7, currentDomain: "https://example.com", username: "u" },
    });
    mockSettings.get.mockResolvedValue("my-token");

    const result = await syncCookieAndGetRedirectUrl();
    expect(result).toBe(
      "https://example.com/api/sandbox/config/redirect/7?hideMenu=true",
    );
    expect(mockLogger.debug).toHaveBeenCalledWith(
      "[SessionUrl] Pre-session state",
      "SessionUrl",
      expect.objectContaining({
        domain: "https://example.com",
        hasToken: true,
      }),
    );
    expect(mockLogger.debug).toHaveBeenCalledWith(
      "[SessionUrl] ticket cookie synced successfully",
      "SessionUrl",
      expect.objectContaining({ domain: "https://example.com" }),
    );
  });
});

describe("syncCookieAndGetNewSessionUrl", () => {
  it("returns null when not logged in", async () => {
    mockGetCurrentAuth.mockResolvedValue({
      isLoggedIn: false,
      userInfo: null,
    });

    const result = await syncCookieAndGetNewSessionUrl();
    expect(result).toBeNull();
  });

  it("returns new-session URL and syncs cookie", async () => {
    mockGetCurrentAuth.mockResolvedValue({
      isLoggedIn: true,
      userInfo: { id: 7, currentDomain: "https://example.com", username: "u" },
    });
    mockSettings.get.mockResolvedValue("my-token");

    const result = await syncCookieAndGetNewSessionUrl();
    expect(result).toBe(
      "https://example.com/api/sandbox/config/redirect/new/7?hideMenu=true",
    );
    expect(mockSession.setCookie).toHaveBeenCalled();
  });
});

describe("syncCookieAndGetChatUrl", () => {
  it("returns null when not logged in", async () => {
    mockGetCurrentAuth.mockResolvedValue({
      isLoggedIn: false,
      userInfo: null,
    });

    const result = await syncCookieAndGetChatUrl("sess-1");
    expect(result).toBeNull();
  });

  it("returns null when domain is missing", async () => {
    mockGetCurrentAuth.mockResolvedValue({
      isLoggedIn: true,
      userInfo: { id: 1, username: "u" },
    });

    const result = await syncCookieAndGetChatUrl("sess-1");
    expect(result).toBeNull();
  });

  it("returns chat URL and syncs cookie", async () => {
    mockGetCurrentAuth.mockResolvedValue({
      isLoggedIn: true,
      userInfo: { id: 7, currentDomain: "https://example.com", username: "u" },
    });
    mockSettings.get.mockResolvedValue("my-token");

    const result = await syncCookieAndGetChatUrl("sess-abc");
    expect(result).toBe(
      "https://example.com/api/sandbox/config/redirect/chat/sess-abc?hideMenu=true",
    );
    expect(mockSession.setCookie).toHaveBeenCalled();
  });

  it("returns chat URL even when user id is missing", async () => {
    mockGetCurrentAuth.mockResolvedValue({
      isLoggedIn: true,
      userInfo: { currentDomain: "https://example.com", username: "u" },
    });
    mockSettings.get.mockResolvedValue("my-token");

    const result = await syncCookieAndGetChatUrl("sess-no-id");
    expect(result).toBe(
      "https://example.com/api/sandbox/config/redirect/chat/sess-no-id?hideMenu=true",
    );
    expect(mockSession.setCookie).toHaveBeenCalled();
  });

  it("returns chat URL without cookie when token is null", async () => {
    mockGetCurrentAuth.mockResolvedValue({
      isLoggedIn: true,
      userInfo: { id: 7, currentDomain: "https://example.com", username: "u" },
    });
    mockSettings.get.mockResolvedValue(null);

    const result = await syncCookieAndGetChatUrl("sess-abc");
    expect(result).toBe(
      "https://example.com/api/sandbox/config/redirect/chat/sess-abc?hideMenu=true",
    );
    expect(mockSession.setCookie).not.toHaveBeenCalled();
  });
});

// --- JWT expiry & token cache clearing ---

/** Helper: build a minimal JWT-like string with a given exp (epoch seconds). */
function makeJwt(exp: number): string {
  const header = btoa(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = btoa(JSON.stringify({ exp }));
  return `${header}.${payload}.sig`;
}

function setupAuthWithDomain(domain = "https://example.com") {
  mockGetCurrentAuth.mockResolvedValue({
    isLoggedIn: true,
    userInfo: { id: 7, currentDomain: domain, username: "u" },
  });
}

describe("syncCookieAndBuildUrl — JWT expiry guard", () => {
  it("skips cookie sync when one-shot token is expired, clears AUTH_TOKEN only", async () => {
    setupAuthWithDomain();
    const expiredJwt = makeJwt(Math.floor(Date.now() / 1000) - 60); // expired 60s ago
    mockSettings.get.mockResolvedValue(expiredJwt);

    const result = await syncCookieAndGetRedirectUrl();

    expect(result).toBe(
      "https://example.com/api/sandbox/config/redirect/7?hideMenu=true",
    );
    expect(mockSession.setCookie).not.toHaveBeenCalled();
    // Only AUTH_TOKEN cleared, not domain cache
    expect(mockSettings.set).toHaveBeenCalledWith("auth.token", null);
    expect(mockSettings.set).not.toHaveBeenCalledWith(
      "auth.tokens.example.com",
      null,
    );
  });

  it("skips cookie sync when domain cache token is expired, clears domain key only", async () => {
    setupAuthWithDomain();
    const expiredJwt = makeJwt(Math.floor(Date.now() / 1000) - 60);
    mockSettings.get.mockImplementation((key: string) => {
      if (key === "auth.token") return Promise.resolve(null);
      if (key === "auth.tokens.example.com") return Promise.resolve(expiredJwt);
      return Promise.resolve(null);
    });

    const result = await syncCookieAndGetRedirectUrl();

    expect(result).toBe(
      "https://example.com/api/sandbox/config/redirect/7?hideMenu=true",
    );
    expect(mockSession.setCookie).not.toHaveBeenCalled();
    // Only domain key cleared, not global AUTH_TOKEN
    expect(mockSettings.set).toHaveBeenCalledWith(
      "auth.tokens.example.com",
      null,
    );
    expect(mockSettings.set).not.toHaveBeenCalledWith("auth.token", null);
  });

  it("proceeds with cookie sync when token is not expired", async () => {
    setupAuthWithDomain();
    const validJwt = makeJwt(Math.floor(Date.now() / 1000) + 3600); // expires in 1h
    mockSettings.get.mockResolvedValue(validJwt);

    const result = await syncCookieAndGetRedirectUrl();

    expect(result).toBe(
      "https://example.com/api/sandbox/config/redirect/7?hideMenu=true",
    );
    expect(mockSession.setCookie).toHaveBeenCalledWith(
      expect.objectContaining({ name: "ticket", value: validJwt }),
    );
  });

  it("proceeds with cookie sync for non-JWT token (no exp field)", async () => {
    setupAuthWithDomain();
    mockSettings.get.mockResolvedValue("opaque-token-not-jwt");

    const result = await syncCookieAndGetRedirectUrl();

    expect(result).toBe(
      "https://example.com/api/sandbox/config/redirect/7?hideMenu=true",
    );
    expect(mockSession.setCookie).toHaveBeenCalledWith(
      expect.objectContaining({ value: "opaque-token-not-jwt" }),
    );
  });

  it("proceeds with cookie sync for malformed JWT", async () => {
    setupAuthWithDomain();
    mockSettings.get.mockResolvedValue("not-even..a..jwt");

    const result = await syncCookieAndGetRedirectUrl();

    expect(mockSession.setCookie).toHaveBeenCalled();
  });

  it("treats token as valid if expired within clock-skew buffer (30s)", async () => {
    setupAuthWithDomain();
    // Expired only 10 seconds ago — within the 30s grace period
    const barelyExpiredJwt = makeJwt(Math.floor(Date.now() / 1000) - 10);
    mockSettings.get.mockResolvedValue(barelyExpiredJwt);

    const result = await syncCookieAndGetRedirectUrl();

    // Should still sync — not treated as expired
    expect(mockSession.setCookie).toHaveBeenCalledWith(
      expect.objectContaining({ value: barelyExpiredJwt }),
    );
  });
});

describe("persistTicketCookie", () => {
  it("clears both AUTH_TOKEN and domain token cache after webview login", async () => {
    mockSession.getCookie.mockResolvedValue({ found: true });
    mockSession.flushStore = vi.fn().mockResolvedValue(undefined);

    await persistTicketCookie("https://example.com");

    expect(mockSettings.set).toHaveBeenCalledWith("auth.token", null);
    expect(mockSettings.set).toHaveBeenCalledWith(
      "auth.tokens.example.com",
      null,
    );
  });

  it("skips clearing when no ticket cookie is present", async () => {
    mockSession.getCookie.mockResolvedValue({ found: false });

    await persistTicketCookie("https://example.com");

    expect(mockSettings.set).not.toHaveBeenCalled();
  });

  it("does not throw on failure, logs warning instead", async () => {
    mockSession.getCookie.mockRejectedValue(new Error("cookie read failed"));

    await expect(
      persistTicketCookie("https://example.com"),
    ).resolves.toBeUndefined();
    expect(mockLogger.warn).toHaveBeenCalledWith(
      "[SessionUrl] persistTicketCookie failed",
      "SessionUrl",
      expect.objectContaining({ domain: "https://example.com" }),
    );
  });
});
