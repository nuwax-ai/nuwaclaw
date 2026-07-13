import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  resolveInstalledPackageEntry: vi.fn(),
  spawn: vi.fn(),
  spawnSync: vi.fn(),
  unref: vi.fn(),
}));

vi.mock("../src/core/engines/packageResolve.js", () => ({
  resolveInstalledPackageEntry: mocks.resolveInstalledPackageEntry,
}));

vi.mock("node:child_process", () => ({
  spawn: mocks.spawn,
  spawnSync: mocks.spawnSync,
}));

describe("fileServer", () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.resolveInstalledPackageEntry.mockReset();
    mocks.spawn.mockReset();
    mocks.spawnSync.mockReset();
    mocks.unref.mockReset();
    mocks.resolveInstalledPackageEntry.mockReturnValue(
      "/fake/nuwax-file-server.js",
    );
    mocks.spawn.mockReturnValue({ unref: mocks.unref });
  });

  it("starts the package dependency entry with the requested port", async () => {
    const { startFileServer } = await import("../src/core/serve/fileServer.js");

    startFileServer(60015);

    expect(mocks.resolveInstalledPackageEntry).toHaveBeenCalledWith(
      "nuwax-file-server",
      "nuwax-file-server/dist/cli.js",
    );
    expect(mocks.spawn).toHaveBeenCalledWith(
      process.execPath,
      ["/fake/nuwax-file-server.js", "start", "--port", "60015"],
      { stdio: "ignore", detached: true },
    );
    expect(mocks.unref).toHaveBeenCalled();
  });

  it("stops the package dependency entry when available", async () => {
    const { stopFileServer } = await import("../src/core/serve/fileServer.js");

    stopFileServer();

    expect(mocks.spawnSync).toHaveBeenCalledWith(
      process.execPath,
      ["/fake/nuwax-file-server.js", "stop"],
      { stdio: "ignore" },
    );
  });

  it("does not throw during shutdown when the package entry is missing", async () => {
    mocks.resolveInstalledPackageEntry.mockImplementationOnce(() => {
      throw new Error("missing");
    });
    const { stopFileServer } = await import("../src/core/serve/fileServer.js");

    expect(() => stopFileServer()).not.toThrow();
    expect(mocks.spawnSync).not.toHaveBeenCalled();
  });
});
