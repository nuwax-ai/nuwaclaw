import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

let tmpHome: string;

vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof os>();
  return { ...actual, homedir: () => tmpHome };
});

const textMock = vi.fn();
const passwordMock = vi.fn();
const confirmMock = vi.fn();
const selectMock = vi.fn();
const isCancelMock = vi.fn(() => false);
vi.mock("@clack/prompts", () => ({
  text: (...args: unknown[]) => textMock(...args),
  password: (...args: unknown[]) => passwordMock(...args),
  confirm: (...args: unknown[]) => confirmMock(...args),
  select: (...args: unknown[]) => selectMock(...args),
  isCancel: (...args: unknown[]) => isCancelMock(...args),
}));

const registerClientMock = vi.fn();
vi.mock("../src/core/auth/regClient.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../src/core/auth/regClient.js")>();
  return {
    ...actual,
    registerClient: (...args: unknown[]) => registerClientMock(...args),
  };
});

const listElectronSavedLoginsMock = vi.fn(() => []);
vi.mock("../src/core/auth/electronImport.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../src/core/auth/electronImport.js")>();
  return {
    ...actual,
    listElectronSavedLogins: () => listElectronSavedLoginsMock(),
  };
});

describe("login/logout/status commands", () => {
  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "nuwaclaw-login-test-"));
    vi.resetModules();
    textMock.mockReset();
    passwordMock.mockReset();
    confirmMock.mockReset();
    selectMock.mockReset();
    isCancelMock.mockReset().mockReturnValue(false);
    registerClientMock.mockReset();
    listElectronSavedLoginsMock.mockReset().mockReturnValue([]);
    process.exitCode = 0;
  });

  afterEach(() => {
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  it("logs in directly with --domain --saved-key, no prompts", async () => {
    registerClientMock.mockResolvedValue({
      id: 1,
      configKey: "new-saved-key",
      name: "alice",
      online: true,
    });
    const { loginCommand } = await import("../src/commands/login.js");
    await loginCommand({ domain: "example.com", savedKey: "old-key" });

    expect(textMock).not.toHaveBeenCalled();
    expect(passwordMock).not.toHaveBeenCalled();
    expect(registerClientMock).toHaveBeenCalledWith(
      "https://example.com",
      expect.objectContaining({ savedKey: "old-key" }),
    );

    const { readCredentials } = await import("../src/core/auth/credentials.js");
    expect(readCredentials()).toMatchObject({
      domain: "https://example.com",
      configKey: "new-saved-key",
      savedKey: "new-saved-key",
    });
  });

  it("first-time login with -u prompts for a hidden password", async () => {
    passwordMock.mockResolvedValueOnce("hunter2");
    registerClientMock.mockResolvedValue({
      id: 1,
      configKey: "fresh-key",
      name: "bob",
      online: true,
    });
    const { loginCommand } = await import("../src/commands/login.js");
    await loginCommand({ domain: "example.com", username: "bob" });

    expect(registerClientMock).toHaveBeenCalledWith(
      "https://example.com",
      expect.objectContaining({
        username: "bob",
        password: "hunter2",
        savedKey: undefined,
      }),
    );
    const { readCredentials } = await import("../src/core/auth/credentials.js");
    expect(readCredentials().savedKey).toBe("fresh-key");
    expect(readCredentials().configKey).toBe("fresh-key");
  });

  it("cancelling the password prompt aborts without calling reg", async () => {
    passwordMock.mockResolvedValueOnce(Symbol("cancel"));
    isCancelMock.mockReturnValueOnce(true);
    const { loginCommand } = await import("../src/commands/login.js");
    await loginCommand({ domain: "example.com", username: "bob" });
    expect(registerClientMock).not.toHaveBeenCalled();
  });

  it("reuses the existing savedKey when neither --saved-key nor -u is given", async () => {
    const { writeCredentials } =
      await import("../src/core/auth/credentials.js");
    writeCredentials({
      domain: "https://example.com",
      username: "alice",
      savedKey: "existing-key",
    });
    registerClientMock.mockResolvedValue({
      id: 1,
      configKey: "existing-key",
      name: "alice",
      online: true,
    });

    const { loginCommand } = await import("../src/commands/login.js");
    await loginCommand({});
    expect(registerClientMock).toHaveBeenCalledWith(
      "https://example.com",
      expect.objectContaining({ savedKey: "existing-key", username: "alice" }),
    );
  });

  it("errors clearly when there's no savedKey and neither --saved-key nor -u was given", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { loginCommand } = await import("../src/commands/login.js");
    await loginCommand({ domain: "example.com" });
    expect(registerClientMock).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
    errSpy.mockRestore();
  });

  it("offers and uses a single detected Electron-client login when nothing else was given, without sharing device identity (own deviceId still used)", async () => {
    listElectronSavedLoginsMock.mockReturnValue([
      {
        domain: "agent.nuwax.com",
        username: "alice",
        savedKey: "electron-saved-key",
        isCurrent: true,
      },
    ]);
    confirmMock.mockResolvedValue(true);
    registerClientMock.mockResolvedValue({
      id: 1,
      configKey: "new-key",
      name: "alice",
      online: true,
    });

    const { loginCommand } = await import("../src/commands/login.js");
    await loginCommand({});

    expect(confirmMock).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining("agent.nuwax.com"),
      }),
    );
    expect(registerClientMock).toHaveBeenCalledWith(
      "https://agent.nuwax.com",
      expect.objectContaining({
        username: "alice",
        savedKey: "electron-saved-key",
      }),
    );
    const { readCredentials } = await import("../src/core/auth/credentials.js");
    expect(readCredentials()).toMatchObject({
      domain: "https://agent.nuwax.com",
    });
  });

  it("declining the single-match Electron import confirm falls through to the existing error, without calling reg", async () => {
    listElectronSavedLoginsMock.mockReturnValue([
      {
        domain: "agent.nuwax.com",
        username: "alice",
        savedKey: "electron-saved-key",
        isCurrent: true,
      },
    ]);
    confirmMock.mockResolvedValue(false);
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const { loginCommand } = await import("../src/commands/login.js");
    await loginCommand({});

    expect(registerClientMock).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
    errSpy.mockRestore();
  });

  it("shows a picker with multiple detected Electron logins and uses the picked one", async () => {
    listElectronSavedLoginsMock.mockReturnValue([
      {
        domain: "agent.nuwax.com",
        username: "alice",
        savedKey: "key-alice",
        isCurrent: false,
      },
      {
        domain: "localhost",
        username: "bob",
        savedKey: "key-bob",
        isCurrent: true,
      },
    ]);
    // The "current" entry is sorted first; index 1 = the second option shown.
    selectMock.mockResolvedValue(1);
    registerClientMock.mockResolvedValue({
      id: 1,
      configKey: "new-key",
      name: "bob",
      online: true,
    });

    const { loginCommand } = await import("../src/commands/login.js");
    await loginCommand({});

    expect(selectMock).toHaveBeenCalled();
    expect(registerClientMock).toHaveBeenCalledWith(
      "https://agent.nuwax.com",
      expect.objectContaining({ username: "alice", savedKey: "key-alice" }),
    );
  });

  it("picking 'manual login' from the multi-match picker falls through to the existing error", async () => {
    listElectronSavedLoginsMock.mockReturnValue([
      { domain: "a.com", username: "x", savedKey: "k1", isCurrent: false },
      { domain: "b.com", username: "y", savedKey: "k2", isCurrent: false },
    ]);
    selectMock.mockResolvedValue(-1);
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const { loginCommand } = await import("../src/commands/login.js");
    await loginCommand({});

    expect(registerClientMock).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
    errSpy.mockRestore();
  });

  it("--domain filters detected Electron logins down to that domain only", async () => {
    listElectronSavedLoginsMock.mockReturnValue([
      {
        domain: "agent.nuwax.com",
        username: "alice",
        savedKey: "key-alice",
        isCurrent: false,
      },
      {
        domain: "other.example.com",
        username: "carol",
        savedKey: "key-carol",
        isCurrent: false,
      },
    ]);
    confirmMock.mockResolvedValue(true);
    registerClientMock.mockResolvedValue({
      id: 1,
      configKey: "new-key",
      name: "alice",
      online: true,
    });

    const { loginCommand } = await import("../src/commands/login.js");
    await loginCommand({ domain: "https://agent.nuwax.com" });

    // Only one match after filtering -> confirm, not select.
    expect(confirmMock).toHaveBeenCalled();
    expect(selectMock).not.toHaveBeenCalled();
    expect(registerClientMock).toHaveBeenCalledWith(
      "https://agent.nuwax.com",
      expect.objectContaining({ username: "alice", savedKey: "key-alice" }),
    );
  });

  it("surfaces a RegError message and sets exitCode on failed registration", async () => {
    const { RegError } = await import("../src/core/auth/regClient.js");
    registerClientMock.mockRejectedValue(new RegError("凭证无效", "4010"));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { loginCommand } = await import("../src/commands/login.js");
    await loginCommand({ domain: "example.com", savedKey: "bad-key" });
    expect(process.exitCode).toBe(1);
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining("凭证无效"));
    errSpy.mockRestore();
  });

  it("logout clears configKey/token but keeps domain/username/savedKey", async () => {
    const { writeCredentials, readCredentials } =
      await import("../src/core/auth/credentials.js");
    writeCredentials({
      domain: "https://example.com",
      username: "alice",
      configKey: "sk",
      savedKey: "sk",
      token: "one-shot",
      lastRegAt: "2026-01-01T00:00:00.000Z",
    });
    const { logoutCommand } = await import("../src/commands/login.js");
    await logoutCommand();
    expect(readCredentials()).toEqual({
      domain: "https://example.com",
      username: "alice",
      savedKey: "sk",
    });
  });

  it("status reports NOT logged in after logout, even though savedKey (device memory) remains — regression test for the configKey/savedKey mixup", async () => {
    const { writeCredentials } =
      await import("../src/core/auth/credentials.js");
    writeCredentials({
      domain: "https://example.com",
      username: "alice",
      configKey: "sk",
      savedKey: "sk",
    });
    const { logoutCommand, statusCommand } =
      await import("../src/commands/login.js");
    await logoutCommand();

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await statusCommand({});
    const printed = logSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(printed).toContain("未登录");
    expect(printed).toContain("免密重新登录");
    logSpy.mockRestore();
  });

  it("status --remote calls reg with the stored savedKey to verify it's still valid", async () => {
    const { writeCredentials } =
      await import("../src/core/auth/credentials.js");
    writeCredentials({
      domain: "https://example.com",
      username: "alice",
      configKey: "sk",
      savedKey: "sk",
    });
    registerClientMock.mockResolvedValue({
      id: 1,
      configKey: "sk",
      name: "alice",
      online: true,
    });
    const { statusCommand } = await import("../src/commands/login.js");
    await statusCommand({ remote: true });
    expect(registerClientMock).toHaveBeenCalledWith(
      "https://example.com",
      expect.objectContaining({ savedKey: "sk" }),
    );
  });

  it("status --remote is a no-op (no network call) when logged out, even with --remote passed", async () => {
    const { writeCredentials } =
      await import("../src/core/auth/credentials.js");
    writeCredentials({
      domain: "https://example.com",
      username: "alice",
      savedKey: "sk", // configKey absent — logged out
    });
    const { statusCommand } = await import("../src/commands/login.js");
    await statusCommand({ remote: true });
    expect(registerClientMock).not.toHaveBeenCalled();
  });

  it("status without login does not attempt a network call", async () => {
    const { statusCommand } = await import("../src/commands/login.js");
    await statusCommand({});
    expect(registerClientMock).not.toHaveBeenCalled();
  });
});
