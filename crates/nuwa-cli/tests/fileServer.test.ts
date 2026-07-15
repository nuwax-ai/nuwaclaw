import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  resolveInstalledPackageEntry: vi.fn(),
  spawn: vi.fn(),
  spawnSync: vi.fn(),
  unref: vi.fn(),
  ensureDir: vi.fn(),
  tmpDir: vi.fn(() => "/tmp/nuwa-cli-test"),
  workspacesDir: vi.fn(() => "/tmp/nuwa-cli-workspaces"),
  logsDir: vi.fn(() => "/tmp/nuwa-cli-logs"),
}));

vi.mock("../src/core/engines/packageResolve.js", () => ({
  resolveInstalledPackageEntry: mocks.resolveInstalledPackageEntry,
}));

vi.mock("node:child_process", () => ({
  spawn: mocks.spawn,
  spawnSync: mocks.spawnSync,
}));

vi.mock("../src/util/paths.js", () => ({
  ensureDir: mocks.ensureDir,
  logsDir: mocks.logsDir,
  tmpDir: mocks.tmpDir,
  workspacesDir: mocks.workspacesDir,
}));

describe("fileServer", () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.resolveInstalledPackageEntry.mockReset();
    mocks.spawn.mockReset();
    mocks.spawnSync.mockReset();
    mocks.unref.mockReset();
    mocks.ensureDir.mockReset();
    mocks.tmpDir.mockClear();
    mocks.workspacesDir.mockClear();
    mocks.logsDir.mockClear();
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
      {
        env: expect.objectContaining({
          TMPDIR: "/tmp/nuwa-cli-test/file-server-60015",
          TMP: "/tmp/nuwa-cli-test/file-server-60015",
          TEMP: "/tmp/nuwa-cli-test/file-server-60015",
          COMPUTER_WORKSPACE_DIR: "/tmp/nuwa-cli-workspaces",
          PROJECT_SOURCE_DIR: "/tmp/nuwa-cli-workspaces/project_workspace",
          UPLOAD_PROJECT_DIR: "/tmp/nuwa-cli-test/file-server-project-zips",
          DIST_TARGET_DIR: "/tmp/nuwa-cli-test/file-server-dist",
          LOG_BASE_DIR: "/tmp/nuwa-cli-logs/file-server/project_logs",
          COMPUTER_LOG_DIR: "/tmp/nuwa-cli-logs/file-server/computer_logs",
        }),
        stdio: "ignore",
        detached: true,
      },
    );
    expect(mocks.ensureDir).toHaveBeenCalledWith(
      "/tmp/nuwa-cli-test/file-server-60015",
    );
    expect(mocks.ensureDir).toHaveBeenCalledWith("/tmp/nuwa-cli-workspaces");
    expect(mocks.unref).toHaveBeenCalled();
  });

  it("stops the package dependency entry when available", async () => {
    const { stopFileServer } = await import("../src/core/serve/fileServer.js");

    stopFileServer(60015);

    expect(mocks.spawnSync).toHaveBeenCalledWith(
      process.execPath,
      ["/fake/nuwax-file-server.js", "stop"],
      {
        env: expect.objectContaining({
          TMPDIR: "/tmp/nuwa-cli-test/file-server-60015",
          TMP: "/tmp/nuwa-cli-test/file-server-60015",
          TEMP: "/tmp/nuwa-cli-test/file-server-60015",
          COMPUTER_WORKSPACE_DIR: "/tmp/nuwa-cli-workspaces",
        }),
        stdio: "ignore",
      },
    );
  });

  it("does not throw during shutdown when the package entry is missing", async () => {
    mocks.resolveInstalledPackageEntry.mockImplementationOnce(() => {
      throw new Error("missing");
    });
    const { stopFileServer } = await import("../src/core/serve/fileServer.js");

    expect(() => stopFileServer(60015)).not.toThrow();
    expect(mocks.spawnSync).not.toHaveBeenCalled();
  });
});
