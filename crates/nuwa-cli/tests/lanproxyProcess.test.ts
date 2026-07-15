import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

const mocks = vi.hoisted(() => ({
  spawn: vi.fn(),
  kill: vi.fn(),
}));

vi.mock("node:child_process", () => ({
  spawn: mocks.spawn,
}));

describe("startLanproxy", () => {
  let tmpDir: string;
  let savedSavedKey: string | undefined;

  beforeEach(() => {
    vi.resetModules();
    mocks.spawn.mockReset();
    mocks.kill.mockReset();
    mocks.spawn.mockReturnValue({ pid: 1234, killed: false, kill: mocks.kill });
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "nuwa-cli-lanproxy-proc-"));
    savedSavedKey = process.env.NUWAX_SAVED_KEY;
    process.env.NUWAX_SAVED_KEY = "electron-key";
  });

  afterEach(() => {
    if (savedSavedKey === undefined) delete process.env.NUWAX_SAVED_KEY;
    else process.env.NUWAX_SAVED_KEY = savedSavedKey;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("spawns lanproxy with Electron-compatible client args", async () => {
    const bin = path.join(tmpDir, "nuwax-lanproxy-test");
    fs.writeFileSync(bin, "");
    const { startLanproxy } =
      await import("../src/core/serve/lanproxyProcess.js");

    const handle = startLanproxy({
      pathOverride: bin,
      serverHost: "https://agent.nuwax.com/",
      serverPort: 443,
      clientKey: "saved-key",
      ssl: true,
    });

    expect(mocks.spawn).toHaveBeenCalledWith(
      bin,
      ["-s", "agent.nuwax.com", "-p", "443", "-k", "saved-key", "--ssl=true"],
      {
        env: expect.not.objectContaining({ NUWAX_SAVED_KEY: "electron-key" }),
        stdio: "ignore",
      },
    );
    handle.stop();
    expect(mocks.kill).toHaveBeenCalled();
  });
});
