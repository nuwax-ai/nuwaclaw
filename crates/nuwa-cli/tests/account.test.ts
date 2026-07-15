import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

let tmpHome: string;

vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof os>();
  return { ...actual, homedir: () => tmpHome };
});

const registerClientMock = vi.fn();
vi.mock("../src/core/auth/regClient.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../src/core/auth/regClient.js")>();
  return {
    ...actual,
    registerClient: (...args: unknown[]) => registerClientMock(...args),
  };
});

const getServeStatusMock = vi.fn();
vi.mock("../src/core/serve/serveLock.js", () => ({
  getServeStatus: (...args: unknown[]) => getServeStatusMock(...args),
}));

describe("account commands", () => {
  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "nuwa-cli-account-test-"));
    vi.resetModules();
    registerClientMock.mockReset();
    getServeStatusMock.mockReset().mockResolvedValue({ state: "stopped" });
    process.exitCode = 0;
  });

  afterEach(() => {
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  it("lists stored accounts and marks the current one", async () => {
    const { writeCredentials } =
      await import("../src/core/auth/credentials.js");
    writeCredentials({
      domain: "https://example.com",
      username: "alice",
      savedKey: "alice-key",
      accounts: {
        "example.com_alice": {
          domain: "https://example.com",
          username: "alice",
          computerName: "alice-pc",
          savedKey: "alice-key",
        },
        "example.org_bob": {
          domain: "https://example.org",
          username: "bob",
          computerName: "bob-pc",
          savedKey: "bob-key",
        },
      },
    });
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const { accountListCommand } = await import("../src/commands/account.js");

    await accountListCommand();

    const printed = logSpy.mock.calls.map((call) => call[0]).join("\n");
    expect(printed).toContain("* example.com_alice");
    expect(printed).toContain("  example.org_bob");
    expect(printed).toContain("bob-pc");
    logSpy.mockRestore();
  });

  it("switches to a stored account using savedKey and refreshes current credentials", async () => {
    const { writeCredentials, readCredentials } =
      await import("../src/core/auth/credentials.js");
    writeCredentials({
      domain: "https://example.com",
      username: "alice",
      savedKey: "alice-key",
      accounts: {
        "example.org_bob": {
          domain: "https://example.org",
          username: "bob",
          computerName: "bob-old",
          savedKey: "bob-key",
        },
      },
    });
    registerClientMock.mockResolvedValue({
      id: 1,
      configKey: "bob-renewed-key",
      name: "bob-new",
      online: true,
    });
    const { accountSwitchCommand } = await import("../src/commands/account.js");

    await accountSwitchCommand("example.org_bob");

    expect(registerClientMock).toHaveBeenCalledWith(
      "https://example.org",
      expect.objectContaining({
        username: "bob",
        password: "",
        savedKey: "bob-key",
      }),
    );
    expect(readCredentials()).toMatchObject({
      domain: "https://example.org",
      username: "bob",
      computerName: "bob-new",
      savedKey: "bob-renewed-key",
      accounts: {
        "example.org_bob": expect.objectContaining({
          savedKey: "bob-renewed-key",
        }),
      },
    });
  });

  it("refuses to switch while serve is running because services must restart", async () => {
    getServeStatusMock.mockResolvedValue({
      state: "running",
      pid: 123,
      port: 60016,
      host: "127.0.0.1",
      startedAt: "2026-01-01T00:00:00.000Z",
    });
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { accountSwitchCommand } = await import("../src/commands/account.js");

    await accountSwitchCommand("example.org_bob");

    expect(registerClientMock).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
    expect(errSpy).toHaveBeenCalledWith(
      expect.stringContaining("需要重启所有服务"),
    );
    errSpy.mockRestore();
  });
});
