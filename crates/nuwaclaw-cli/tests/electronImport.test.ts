import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

let tmpHome: string;

vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof os>();
  return { ...actual, homedir: () => tmpHome };
});

/**
 * Symlinks the *real* better-sqlite3 (a devDependency, already built) into
 * the fake `~/.nuwaclaw/cli/tools/node_modules/` location the lazy-installer
 * would otherwise `npm install` into — lets tests exercise the real
 * query/parsing logic without a real (slow, network-dependent) install.
 */
function linkRealBetterSqlite3(home: string): void {
  const realPkgDir = path.dirname(
    require.resolve("better-sqlite3/package.json"),
  );
  const fakeModules = path.join(
    home,
    ".nuwaclaw",
    "cli",
    "tools",
    "node_modules",
  );
  fs.mkdirSync(fakeModules, { recursive: true });
  fs.symlinkSync(realPkgDir, path.join(fakeModules, "better-sqlite3"), "dir");
}

function createElectronDb(home: string, rows: Record<string, unknown>): void {
  const dbPath = path.join(home, ".nuwaclaw", "nuwaclaw.db");
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const Database = require(
    path.dirname(require.resolve("better-sqlite3/package.json")),
  );
  const db = new Database(dbPath);
  db.exec("CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
  const insert = db.prepare("INSERT INTO settings (key, value) VALUES (?, ?)");
  for (const [key, value] of Object.entries(rows)) {
    insert.run(key, JSON.stringify(value));
  }
  db.close();
}

describe("listElectronSavedLogins", () => {
  beforeEach(() => {
    tmpHome = fs.mkdtempSync(
      path.join(os.tmpdir(), "nuwaclaw-electron-import-test-"),
    );
    vi.resetModules();
  });

  afterEach(() => {
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  it("returns [] when there's no Electron db file at all (most common case: Electron client never installed)", async () => {
    const { listElectronSavedLogins } =
      await import("../src/core/auth/electronImport.js");
    expect(listElectronSavedLogins()).toEqual([]);
  });

  it("parses multiple saved-key entries, matching real observed key shapes, and marks the currently-active one", async () => {
    linkRealBetterSqlite3(tmpHome);
    createElectronDb(tmpHome, {
      "auth.config_key": "some-active-config-key",
      "auth.username": "alice",
      "auth.user_info": { currentDomain: "https://agent.nuwax.com" },
      "auth.saved_keys.agent.nuwax.com_alice": "key-for-alice-nuwax",
      "auth.saved_keys.localhost_bob": "key-for-bob-local",
    });

    const { listElectronSavedLogins } =
      await import("../src/core/auth/electronImport.js");
    const logins = listElectronSavedLogins();
    expect(logins).toHaveLength(2);

    const alice = logins.find((l) => l.username === "alice");
    const bob = logins.find((l) => l.username === "bob");
    expect(alice).toMatchObject({
      domain: "agent.nuwax.com",
      username: "alice",
      isCurrent: true,
    });
    expect(typeof alice?.savedKey).toBe("string");
    expect(alice?.savedKey.length).toBeGreaterThan(0);
    expect(bob).toMatchObject({
      domain: "localhost",
      username: "bob",
      isCurrent: false,
    });
  });

  it("marks nothing as current when auth.config_key is absent (Electron client itself is logged out)", async () => {
    linkRealBetterSqlite3(tmpHome);
    createElectronDb(tmpHome, {
      "auth.username": "alice",
      "auth.user_info": { currentDomain: "https://agent.nuwax.com" },
      "auth.saved_keys.agent.nuwax.com_alice": "key-for-alice",
    });
    const { listElectronSavedLogins } =
      await import("../src/core/auth/electronImport.js");
    expect(listElectronSavedLogins()[0].isCurrent).toBe(false);
  });

  it("skips a saved-key row whose key has no '_' separator instead of throwing", async () => {
    linkRealBetterSqlite3(tmpHome);
    createElectronDb(tmpHome, {
      "auth.saved_keys.malformed": "whatever",
      "auth.saved_keys.good.host_carol": "key-for-carol",
    });
    const { listElectronSavedLogins } =
      await import("../src/core/auth/electronImport.js");
    const logins = listElectronSavedLogins();
    expect(logins).toHaveLength(1);
    expect(logins[0].username).toBe("carol");
  });

  it("returns [] (never throws) when the db file exists but isn't a valid sqlite file", async () => {
    fs.mkdirSync(path.join(tmpHome, ".nuwaclaw"), { recursive: true });
    fs.writeFileSync(
      path.join(tmpHome, ".nuwaclaw", "nuwaclaw.db"),
      "not a real sqlite file",
    );
    linkRealBetterSqlite3(tmpHome);
    const { listElectronSavedLogins } =
      await import("../src/core/auth/electronImport.js");
    expect(listElectronSavedLogins()).toEqual([]);
  });

  it("returns [] (never throws) when better-sqlite3 can't be installed", async () => {
    // No symlink set up, so ensureSqliteReader's fs.existsSync check fails
    // and it falls through to a real npm install attempt — mock spawnSync so
    // that "attempt" fails fast instead of hitting the network.
    fs.mkdirSync(path.join(tmpHome, ".nuwaclaw"), { recursive: true });
    fs.writeFileSync(path.join(tmpHome, ".nuwaclaw", "nuwaclaw.db"), "x");
    vi.doMock("node:child_process", async (importOriginal) => {
      const actual =
        await importOriginal<typeof import("node:child_process")>();
      return { ...actual, spawnSync: () => ({ status: 1 }) };
    });
    const { listElectronSavedLogins } =
      await import("../src/core/auth/electronImport.js");
    expect(listElectronSavedLogins()).toEqual([]);
    vi.doUnmock("node:child_process");
  });
});
