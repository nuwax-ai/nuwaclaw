import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  buildRedirectUrl,
  syncSessionCookie,
  syncCookieAndGetRedirectUrl,
} from "./sessionUrl";

const mockSettings = { get: vi.fn() };
const mockSession = { setCookie: vi.fn() };

vi.stubGlobal("window", {
  electronAPI: { settings: mockSettings, session: mockSession },
});

const mockGetCurrentAuth = vi.fn();
vi.mock("../core/auth", () => ({
  getCurrentAuth: (...args: unknown[]) => mockGetCurrentAuth(...args),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("buildRedirectUrl", () => {
  it("strips trailing slashes and builds correct URL", () => {
    expect(buildRedirectUrl("https://example.com///", "user1")).toBe(
      "https://example.com/api/sandbox/config/redirect/user1",
    );
    expect(buildRedirectUrl("https://example.com/", "user1")).toBe(
      "https://example.com/api/sandbox/config/redirect/user1",
    );
    expect(buildRedirectUrl("https://example.com", "user1")).toBe(
      "https://example.com/api/sandbox/config/redirect/user1",
    );
  });

  it("works with numeric userId", () => {
    expect(buildRedirectUrl("https://example.com", 42)).toBe(
      "https://example.com/api/sandbox/config/redirect/42",
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

  it("returns URL and syncs cookie when all present", async () => {
    mockGetCurrentAuth.mockResolvedValue({
      isLoggedIn: true,
      userInfo: { id: 7, currentDomain: "https://example.com", username: "u" },
    });
    mockSettings.get.mockResolvedValue("my-token");

    const result = await syncCookieAndGetRedirectUrl();
    expect(result).toBe("https://example.com/api/sandbox/config/redirect/7");
    expect(mockSession.setCookie).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "https://example.com",
        name: "ticket",
        value: "my-token",
        domain: "example.com",
      }),
    );
  });

  it("returns URL without syncing cookie when token is null", async () => {
    mockGetCurrentAuth.mockResolvedValue({
      isLoggedIn: true,
      userInfo: { id: 7, currentDomain: "https://example.com", username: "u" },
    });
    mockSettings.get.mockResolvedValue(null);

    const result = await syncCookieAndGetRedirectUrl();
    expect(result).toBe("https://example.com/api/sandbox/config/redirect/7");
    expect(mockSession.setCookie).not.toHaveBeenCalled();
  });
});
