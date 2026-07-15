import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import * as http from "node:http";

let tmpHome: string;

vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof os>();
  return { ...actual, homedir: () => tmpHome };
});

describe("serveLock", () => {
  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "nuwa-cli-serveLock-"));
    vi.resetModules();
  });
  afterEach(() => {
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  it("writeServeLock / readServeLock round-trip; clearServeLock removes it", async () => {
    const { writeServeLock, readServeLock, clearServeLock } =
      await import("../src/core/serve/serveLock.js");
    const { cliServeLockPath } = await import("../src/util/paths.js");
    const info = {
      pid: 12345,
      port: 60016,
      host: "127.0.0.1",
      startedAt: "2026-07-08T10:00:00.000Z",
    };
    writeServeLock(info);
    expect(readServeLock()).toEqual(info);
    expect(cliServeLockPath()).toBe(
      path.join(tmpHome, ".nuwa-cli", "serve.lock"),
    );
    expect(fs.existsSync(cliServeLockPath())).toBe(true);
    clearServeLock();
    expect(readServeLock()).toBeNull();
    expect(fs.existsSync(cliServeLockPath())).toBe(false);
  });

  it("readServeLock returns null when missing or corrupt", async () => {
    const { readServeLock } = await import("../src/core/serve/serveLock.js");
    expect(readServeLock()).toBeNull();
    const { cliServeLockPath, ensureDir } =
      await import("../src/util/paths.js");
    ensureDir(path.dirname(cliServeLockPath()));
    fs.writeFileSync(cliServeLockPath(), "not json");
    expect(readServeLock()).toBeNull();
  });

  it("probeServeHealth is true for a healthy /health, false when down", async () => {
    const { probeServeHealth } = await import("../src/core/serve/serveLock.js");
    const server = http.createServer((req, res) => {
      if (req.url === "/health") {
        res.end(JSON.stringify({ status: "ok" }));
        return;
      }
      res.statusCode = 404;
      res.end();
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const port = (server.address() as { port: number }).port;
    expect(await probeServeHealth("127.0.0.1", port)).toBe(true);
    await new Promise<void>((r) => server.close(() => r()));
    // Connection refused after close — should be false, and fast (not the
    // full timeout).
    expect(await probeServeHealth("127.0.0.1", port, 500)).toBe(false);
  });

  it("getServeStatus auto-cleans a stale lock whose PID is dead", async () => {
    const { writeServeLock, getServeStatus, readServeLock } =
      await import("../src/core/serve/serveLock.js");
    writeServeLock({
      pid: 99999999,
      port: 1,
      host: "127.0.0.1",
      startedAt: "2026-07-08T10:00:00.000Z",
    });
    const status = await getServeStatus();
    expect(status.state).toBe("stopped");
    expect(readServeLock()).toBeNull();
  });

  it("startServeHttp writes serve.lock on listen and clears it on stop", async () => {
    const { startServeHttp } = await import("../src/core/serve/server.js");
    const { cliServeLockPath } = await import("../src/util/paths.js");
    const handle = startServeHttp({
      port: 0,
      host: "127.0.0.1",
      engine: "claude",
      cwd: "/tmp",
      permissionMode: "yolo",
    });
    await new Promise<void>((r) => handle.server.once("listening", r));
    expect(fs.existsSync(cliServeLockPath())).toBe(true);
    await handle.stop();
    expect(fs.existsSync(cliServeLockPath())).toBe(false);
  });
});
