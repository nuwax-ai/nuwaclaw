import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

let tmpHome: string;
let savedPasswordEnv: string | undefined;

vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof os>();
  return { ...actual, homedir: () => tmpHome };
});

const textMock = vi.fn();
const passwordMock = vi.fn();
const isCancelMock = vi.fn(() => false);
vi.mock("@clack/prompts", () => ({
  text: (...args: unknown[]) => textMock(...args),
  password: (...args: unknown[]) => passwordMock(...args),
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

describe("login/logout/status commands", () => {
  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "nuwa-cli-login-test-"));
    savedPasswordEnv = process.env.NUWACLI_PASSWORD;
    delete process.env.NUWACLI_PASSWORD;
    vi.resetModules();
    textMock.mockReset();
    passwordMock.mockReset();
    isCancelMock.mockReset().mockReturnValue(false);
    registerClientMock.mockReset();
    process.exitCode = 0;
  });

  afterEach(() => {
    if (savedPasswordEnv === undefined) delete process.env.NUWACLI_PASSWORD;
    else process.env.NUWACLI_PASSWORD = savedPasswordEnv;
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
      computerName: "alice",
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

  it("reuses the savedKey for the same domain + username during password login", async () => {
    const { writeCredentials } =
      await import("../src/core/auth/credentials.js");
    writeCredentials({
      domain: "https://example.com",
      username: "bob",
      savedKey: "old-bob-key",
      savedKeys: { "example.com_bob": "old-bob-key" },
    });
    passwordMock.mockResolvedValueOnce("hunter2");
    registerClientMock.mockResolvedValue({
      id: 1,
      configKey: "renewed-bob-key",
      name: "bob",
      online: true,
    });

    const { loginCommand } = await import("../src/commands/login.js");
    await loginCommand({ domain: "https://example.com", username: "bob" });

    expect(registerClientMock).toHaveBeenCalledWith(
      "https://example.com",
      expect.objectContaining({
        username: "bob",
        password: "hunter2",
        savedKey: "old-bob-key",
      }),
    );
    const { readCredentials } = await import("../src/core/auth/credentials.js");
    expect(readCredentials().savedKeys).toMatchObject({
      "example.com_bob": "renewed-bob-key",
    });
  });

  it("does not reuse the default savedKey for a different username", async () => {
    const { writeCredentials } =
      await import("../src/core/auth/credentials.js");
    writeCredentials({
      domain: "https://example.com",
      username: "alice",
      savedKey: "alice-key",
      savedKeys: { "example.com_alice": "alice-key" },
    });
    passwordMock.mockResolvedValueOnce("hunter2");
    registerClientMock.mockResolvedValue({
      id: 1,
      configKey: "bob-key",
      name: "bob",
      online: true,
    });

    const { loginCommand } = await import("../src/commands/login.js");
    await loginCommand({ domain: "https://example.com", username: "bob" });

    expect(registerClientMock).toHaveBeenCalledWith(
      "https://example.com",
      expect.objectContaining({
        username: "bob",
        password: "hunter2",
        savedKey: undefined,
      }),
    );
  });

  it("uses NUWACLI_PASSWORD for non-interactive username login", async () => {
    process.env.NUWACLI_PASSWORD = "env-secret";
    registerClientMock.mockResolvedValue({
      id: 1,
      configKey: "fresh-key",
      name: "bob",
      online: true,
    });
    const { loginCommand } = await import("../src/commands/login.js");
    await loginCommand({ domain: "example.com", username: "bob" });

    expect(passwordMock).not.toHaveBeenCalled();
    expect(registerClientMock).toHaveBeenCalledWith(
      "https://example.com",
      expect.objectContaining({
        username: "bob",
        password: "env-secret",
        savedKey: undefined,
      }),
    );
    const { readCredentials } = await import("../src/core/auth/credentials.js");
    expect(JSON.stringify(readCredentials())).not.toContain("env-secret");
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
      savedKeys: { "example.com_alice": "existing-key" },
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
      computerName: "我的电脑001",
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
      computerName: "我的电脑001",
      savedKey: "sk",
    });
  });

  it("status reports NOT logged in after logout, even though savedKey (device memory) remains — regression test for the configKey/savedKey mixup", async () => {
    const { writeCredentials } =
      await import("../src/core/auth/credentials.js");
    writeCredentials({
      domain: "https://example.com",
      username: "alice",
      computerName: "我的电脑001",
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
      computerName: "我的电脑001",
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
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await statusCommand({ remote: true });
    expect(registerClientMock).toHaveBeenCalledWith(
      "https://example.com",
      expect.objectContaining({ savedKey: "sk" }),
    );
    const printed = logSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(printed).toContain("电脑名：我的电脑001");
    logSpy.mockRestore();
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
