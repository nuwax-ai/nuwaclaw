import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  buildRedirectUrl,
  buildNewSessionUrl,
  buildChatSessionUrl,
  syncSessionCookie,
  syncCookieAndGetRedirectUrl,
  syncCookieAndGetNewSessionUrl,
  syncCookieAndGetChatUrl,
} from "./sessionUrl";

const { mockSettings, mockSession, mockLogger } = vi.hoisted(() => ({
  mockSettings: { get: vi.fn(), set: vi.fn() },
  mockSession: { setCookie: vi.fn(), getCookie: vi.fn() },
  mockLogger: {
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
  it("extracts hostname from valid URL for cookie domain", async () => {
    await syncSessionCookie("https://app.example.com:8080/path", "tok123");

    expect(mockSession.setCookie).toHaveBeenCalledWith({
      url: "https://app.example.com:8080/path",
      name: "ticket",
      value: "tok123",
      domain: "app.example.com",
      httpOnly: true,
      secure: true,
    });
  });

  it("falls back to stripping protocol for invalid URL", async () => {
    await syncSessionCookie("not-a-valid-url", "tok123");

    expect(mockSession.setCookie).toHaveBeenCalledWith({
      url: "not-a-valid-url",
      name: "ticket",
      value: "tok123",
      domain: "not-a-valid-url",
      httpOnly: true,
      secure: false,
    });
  });

  it("sets secure: true for https, false for http", async () => {
    await syncSessionCookie("https://example.com", "tok");
    expect(mockSession.setCookie).toHaveBeenCalledWith(
      expect.objectContaining({ secure: true }),
    );

    mockSession.setCookie.mockClear();

    await syncSessionCookie("http://example.com", "tok");
    expect(mockSession.setCookie).toHaveBeenCalledWith(
      expect.objectContaining({ secure: false }),
    );
  });

  it("omits domain for IPv4 host (host-only cookie)", async () => {
    await syncSessionCookie("http://127.0.0.1:8080", "tok-ip");

    expect(mockSession.setCookie).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "http://127.0.0.1:8080",
        name: "ticket",
        value: "tok-ip",
        secure: false,
      }),
    );
    const payload = mockSession.setCookie.mock.calls[0][0];
    expect(payload).not.toHaveProperty("domain");
  });

  it("omits domain for localhost (host-only cookie)", async () => {
    await syncSessionCookie("http://localhost:3000", "tok-local");

    expect(mockSession.setCookie).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "http://localhost:3000",
        name: "ticket",
        value: "tok-local",
        secure: false,
      }),
    );
    const payload = mockSession.setCookie.mock.calls[0][0];
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
        domain: "example.com",
      }),
    );
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

  it("skips syncing when target already has ticket cookie", async () => {
    mockGetCurrentAuth.mockResolvedValue({
      isLoggedIn: true,
      userInfo: { id: 7, currentDomain: "https://example.com", username: "u" },
    });
    mockSettings.get.mockImplementation((key: string) => {
      if (key === "auth.token") return Promise.resolve(null);
      if (key === "auth.tokens.example.com") return Promise.resolve("my-token");
      return Promise.resolve(null);
    });
    mockSession.getCookie.mockResolvedValue({ success: true, found: true });

    const result = await syncCookieAndGetRedirectUrl();
    expect(result).toBe(
      "https://example.com/api/sandbox/config/redirect/7?hideMenu=true",
    );
    expect(mockSession.setCookie).not.toHaveBeenCalled();
    expect(mockSettings.set).not.toHaveBeenCalledWith("auth.token", null);
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
    expect(mockLogger.info).toHaveBeenCalledWith(
      "[SessionUrl][Diag] 会话前状态",
      "SessionUrl",
      expect.objectContaining({
        domain: "https://example.com",
        hasToken: true,
      }),
    );
    expect(mockLogger.info).toHaveBeenCalledWith(
      "[SessionUrl][Diag] 准备同步 ticket cookie",
      "SessionUrl",
      expect.objectContaining({ domain: "https://example.com" }),
    );
    expect(mockLogger.info).toHaveBeenCalledWith(
      "[SessionUrl][Diag] ticket cookie 同步成功",
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
