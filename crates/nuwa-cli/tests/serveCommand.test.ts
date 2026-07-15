import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

let tmpHome: string;

vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof os>();
  return { ...actual, homedir: () => tmpHome };
});

const mocks = vi.hoisted(() => ({
  registerClient: vi.fn(),
  startServeHttp: vi.fn(),
  stopHttp: vi.fn(),
  addAcceptedSecret: vi.fn(),
  startFileServer: vi.fn(),
  stopFileServer: vi.fn(),
  startLanproxy: vi.fn(),
  stopLanproxy: vi.fn(),
  getDeviceId: vi.fn(() => "device-id"),
}));

vi.mock("../src/core/auth/regClient.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../src/core/auth/regClient.js")>();
  return {
    ...actual,
    registerClient: (...args: unknown[]) => mocks.registerClient(...args),
  };
});

vi.mock("../src/core/auth/deviceId.js", () => ({
  getDeviceId: () => mocks.getDeviceId(),
}));

vi.mock("../src/core/serve/server.js", () => ({
  startServeHttp: (...args: unknown[]) => mocks.startServeHttp(...args),
}));

vi.mock("../src/core/serve/fileServer.js", () => ({
  startFileServer: (...args: unknown[]) => mocks.startFileServer(...args),
  stopFileServer: (...args: unknown[]) => mocks.stopFileServer(...args),
}));

vi.mock("../src/core/serve/lanproxyProcess.js", () => ({
  startLanproxy: (...args: unknown[]) => mocks.startLanproxy(...args),
}));

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let i = 0; i < 20; i += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("timed out waiting for condition");
}

describe("serveCommand", () => {
  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "nuwa-cli-serve-cmd-"));
    vi.resetModules();
    process.exitCode = 0;
    mocks.registerClient.mockReset();
    mocks.startServeHttp.mockReset();
    mocks.stopHttp.mockReset().mockResolvedValue(undefined);
    mocks.addAcceptedSecret.mockReset();
    mocks.startFileServer.mockReset();
    mocks.stopFileServer.mockReset();
    mocks.startLanproxy.mockReset();
    mocks.stopLanproxy.mockReset();
    mocks.startServeHttp.mockReturnValue({
      secret: "serve-secret",
      stop: mocks.stopHttp,
      addAcceptedSecret: mocks.addAcceptedSecret,
    });
    mocks.startLanproxy.mockReturnValue({
      pid: 1234,
      stop: mocks.stopLanproxy,
    });
  });

  afterEach(() => {
    fs.rmSync(tmpHome, { recursive: true, force: true });
    process.exitCode = 0;
  });

  it("keeps the current account mapping in sync after tunnel re-registration", async () => {
    const { writeCredentials, readCredentials } =
      await import("../src/core/auth/credentials.js");
    writeCredentials({
      domain: "https://example.com",
      username: "alice",
      computerName: "Alice Mac",
      configKey: "old-config",
      savedKey: "old-config",
      savedKeys: { "example.com_alice": "old-config" },
      accounts: {
        "example.com_alice": {
          domain: "https://example.com",
          username: "alice",
          computerName: "Alice Mac",
          savedKey: "old-config",
        },
      },
      serverHost: "existing-lanproxy.example.com",
      serverPort: 443,
    });
    mocks.registerClient.mockResolvedValue({
      id: 1,
      configKey: "renewed-config",
      name: "Alice Mac",
      online: true,
      configValue: {},
      token: "token",
    });

    const { serveCommand } = await import("../src/commands/serve.js");
    const running = serveCommand({
      engine: "claude",
      tunnel: true,
      approve: "deny",
    });

    await waitFor(() => mocks.startLanproxy.mock.calls.length > 0);
    process.emit("SIGINT");
    await running;

    expect(readCredentials()).toMatchObject({
      savedKey: "renewed-config",
      serverHost: "existing-lanproxy.example.com",
      serverPort: 443,
      savedKeys: { "example.com_alice": "renewed-config" },
      accounts: {
        "example.com_alice": {
          savedKey: "renewed-config",
          serverHost: "existing-lanproxy.example.com",
          serverPort: 443,
        },
      },
    });
    expect(mocks.startLanproxy).toHaveBeenCalledWith(
      expect.objectContaining({
        serverHost: "existing-lanproxy.example.com",
        serverPort: 443,
        clientKey: "renewed-config",
      }),
    );
    expect(mocks.addAcceptedSecret).toHaveBeenCalledWith("renewed-config");
    expect(mocks.startServeHttp).toHaveBeenCalledWith(
      expect.objectContaining({
        cwd: path.join(tmpHome, ".nuwa-cli", "workspaces"),
        acceptedSecrets: ["old-config"],
        allowUnauthenticatedComputerRoutes: true,
      }),
    );
    expect(mocks.startFileServer).toHaveBeenCalledWith(
      60015,
      path.join(tmpHome, ".nuwa-cli", "workspaces"),
    );
    expect(mocks.stopLanproxy).toHaveBeenCalled();
  });
});
