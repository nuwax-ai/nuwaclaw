import * as fs from "node:fs";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import pc from "picocolors";
import { nuwaclawHome, cliToolsDir, ensureDir } from "../../util/paths.js";

const require = createRequire(import.meta.url);

/** Pinned to the npm-published version confirmed to exist at write time; bump deliberately. */
const BETTER_SQLITE3_VERSION = "12.11.1";

const SAVED_KEY_PREFIX = "auth.saved_keys.";

export interface ElectronSavedLogin {
  domain: string;
  username: string;
  savedKey: string;
  /** Matches the Electron client's *currently* logged-in identity (its configKey is set and this entry's domain+username match auth.user_info/auth.username). */
  isCurrent: boolean;
}

/** Mirrors the Electron client's `normalizeDomainForTokenKey` (src/shared/utils/domain.ts) — strips scheme/port/path down to a bare lowercase hostname, which is what it uses to build `auth.saved_keys.<host>_<username>` keys. */
export function normalizeHostname(domain: string): string {
  try {
    return new URL(domain).hostname.toLowerCase();
  } catch {
    return domain
      .replace(/^https?:\/\//i, "")
      .split("/")[0]
      .split(":")[0]
      .toLowerCase();
  }
}

function electronDbPath(): string {
  return path.join(nuwaclawHome(), "nuwaclaw.db");
}

/**
 * Cheap existence check only — no sqlite read, no lazy-install side effect.
 * For read-only diagnostics like `doctor` that want to hint "you may have an
 * importable login" without paying the cost of actually querying it (that
 * happens later, inside `login`, where installing a reader is appropriate
 * for an action the user explicitly took).
 */
export function hasElectronLoginData(): boolean {
  return fs.existsSync(electronDbPath());
}

function betterSqlite3EntryPath(): string {
  return path.join(cliToolsDir(), "node_modules", "better-sqlite3");
}

function ensureToolsProjectMarker(toolsDir: string): void {
  const marker = path.join(toolsDir, "package.json");
  if (fs.existsSync(marker)) return;
  fs.writeFileSync(
    marker,
    JSON.stringify(
      { name: "nuwaclaw-cli-tools", private: true, version: "0.0.0" },
      null,
      2,
    ),
  );
}

/**
 * Lazily installs `better-sqlite3` (native, prebuilt) the same way the claude
 * adapter is installed — only touched when a user actually has an Electron
 * client db to read, never a default dependency of nuwaclaw itself.
 */
function ensureSqliteReader(): typeof import("better-sqlite3") {
  const entry = betterSqlite3EntryPath();
  if (!fs.existsSync(entry)) {
    const toolsDir = cliToolsDir();
    ensureDir(toolsDir);
    ensureToolsProjectMarker(toolsDir);
    console.error(
      pc.dim(
        `[nuwaclaw] 检测到 NuwaClaw 客户端数据，正在安装 better-sqlite3@${BETTER_SQLITE3_VERSION} 以读取其登录信息...`,
      ),
    );
    const result = spawnSync(
      "npm",
      [
        "install",
        `better-sqlite3@${BETTER_SQLITE3_VERSION}`,
        "--no-save",
        "--no-audit",
        "--no-fund",
      ],
      { cwd: toolsDir, stdio: "inherit" },
    );
    if (result.status !== 0 || !fs.existsSync(entry)) {
      throw new Error("安装 better-sqlite3 失败");
    }
  }
  return require(entry) as typeof import("better-sqlite3");
}

function safeJsonParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

/**
 * Reads the Electron NuwaClaw client's own saved logins (its `settings`
 * key-value table, opened read-only) so `nuwaclaw login` can offer to reuse
 * one instead of asking the user to copy a savedKey by hand. Best-effort
 * only: any failure (db missing, sqlite unavailable, malformed rows) yields
 * an empty list rather than throwing — this must never block the existing
 * explicit `--domain`/`--saved-key` login path.
 *
 * Deliberately does NOT share device identity: nuwaclaw-cli keeps its own
 * deviceId and calls its own reg with whatever domain/username/savedKey is
 * picked here, so it registers as an independent device from the Electron
 * client (matching the port/deviceId separation already used elsewhere).
 */
export function listElectronSavedLogins(): ElectronSavedLogin[] {
  const dbPath = electronDbPath();
  if (!fs.existsSync(dbPath)) return [];

  let Database: typeof import("better-sqlite3");
  try {
    Database = ensureSqliteReader();
  } catch {
    return [];
  }

  let db: InstanceType<typeof Database> | undefined;
  try {
    db = new Database(dbPath, { readonly: true, fileMustExist: true });
    const rows = db
      .prepare(
        `SELECT key, value FROM settings WHERE key LIKE ? OR key IN ('auth.user_info', 'auth.username', 'auth.config_key')`,
      )
      .all(`${SAVED_KEY_PREFIX}%`) as { key: string; value: string }[];

    let currentUsername: string | undefined;
    let currentHostname: string | undefined;
    let hasConfigKey = false;
    const savedKeyRows: { key: string; value: string }[] = [];

    for (const row of rows) {
      if (row.key === "auth.config_key") {
        hasConfigKey = Boolean(safeJsonParse(row.value));
      } else if (row.key === "auth.username") {
        const parsed = safeJsonParse(row.value);
        if (typeof parsed === "string") currentUsername = parsed;
      } else if (row.key === "auth.user_info") {
        const parsed = safeJsonParse(row.value) as
          | { currentDomain?: string }
          | undefined;
        if (parsed?.currentDomain)
          currentHostname = normalizeHostname(parsed.currentDomain);
      } else if (row.key.startsWith(SAVED_KEY_PREFIX)) {
        savedKeyRows.push(row);
      }
    }

    const logins: ElectronSavedLogin[] = [];
    for (const row of savedKeyRows) {
      const rest = row.key.slice(SAVED_KEY_PREFIX.length);
      const sep = rest.indexOf("_");
      if (sep === -1) continue;
      const hostname = rest.slice(0, sep);
      const username = rest.slice(sep + 1);
      const savedKey = safeJsonParse(row.value);
      if (typeof savedKey !== "string" || !savedKey) continue;
      logins.push({
        domain: hostname,
        username,
        savedKey,
        isCurrent:
          hasConfigKey &&
          hostname === currentHostname &&
          username === currentUsername,
      });
    }
    return logins;
  } catch {
    return [];
  } finally {
    db?.close();
  }
}
