import * as fs from "node:fs";
import * as path from "node:path";
import { ensureDir, logsDir } from "../util/paths.js";

const SECRET_KEYS = [
  "apiKey",
  "api_key",
  "authorization",
  "configKey",
  "password",
  "savedKey",
  "secret",
  "token",
];

const TTL_MS_DEV = 30 * 24 * 60 * 60 * 1000;
const TTL_MS_PROD = 7 * 24 * 60 * 60 * 1000;
const LATEST_LOG_FILENAME = "latest.log";
const LEGACY_UP_DEBUG_FILENAME = "up-debug.log";

let initialized = false;
let cleanupTimer: NodeJS.Timeout | undefined;
let lastLinkedDate = "";

function isDev(): boolean {
  return (
    process.env.NODE_ENV === "development" || process.env.NUWACLAW_DEV === "1"
  );
}

function todayDateStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function activeMainLogPath(): string {
  return path.join(logsDir(), `main.${todayDateStr()}.log`);
}

function linkOrCopy(targetPath: string, linkPath: string): void {
  try {
    try {
      fs.lstatSync(linkPath);
      fs.unlinkSync(linkPath);
    } catch {
      // Missing link is fine.
    }
    if (process.platform === "win32") {
      fs.linkSync(targetPath, linkPath);
    } else {
      fs.symlinkSync(path.basename(targetPath), linkPath, "file");
    }
  } catch {
    try {
      fs.copyFileSync(targetPath, linkPath);
    } catch {
      // Best-effort compatibility entry.
    }
  }
}

function updateLogLinks(): void {
  if (process.env.NUWACLAW_DEBUG_LOG_PATH) return;
  const date = todayDateStr();
  if (date === lastLinkedDate) return;
  const dir = logsDir();
  const target = activeMainLogPath();
  ensureDir(dir);
  if (!fs.existsSync(target)) fs.closeSync(fs.openSync(target, "a"));
  linkOrCopy(target, path.join(dir, LATEST_LOG_FILENAME));
  linkOrCopy(target, path.join(dir, LEGACY_UP_DEBUG_FILENAME));
  lastLinkedDate = date;
}

function isArchiveLogName(name: string): boolean {
  const lower = name.toLowerCase();
  if (!lower.endsWith(".log")) return false;
  if (lower === LATEST_LOG_FILENAME || lower === LEGACY_UP_DEBUG_FILENAME) {
    return false;
  }
  if (lower === `main.${todayDateStr()}.log`) return false;
  return lower === "main.log" || lower.startsWith("main.");
}

function cleanupOldLogs(): void {
  const dir = logsDir();
  if (!fs.existsSync(dir)) return;
  const ttl = isDev() ? TTL_MS_DEV : TTL_MS_PROD;
  const now = Date.now();
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    if (!isArchiveLogName(entry.name)) continue;
    const fullPath = path.join(dir, entry.name);
    try {
      const stat = fs.statSync(fullPath);
      if (now - stat.mtimeMs > ttl) fs.unlinkSync(fullPath);
    } catch {
      // Ignore cleanup failures.
    }
  }
}

export function initDebugLogging(): void {
  if (initialized) return;
  initialized = true;
  ensureDir(logsDir());
  updateLogLinks();
  cleanupOldLogs();
  cleanupTimer = setInterval(cleanupOldLogs, 60 * 60 * 1000);
  cleanupTimer.unref?.();
  process.once("exit", () => {
    if (cleanupTimer) clearInterval(cleanupTimer);
  });
}

function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (!value || typeof value !== "object") return value;
  const redacted: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (
      SECRET_KEYS.some((needle) =>
        key.toLowerCase().includes(needle.toLowerCase()),
      )
    ) {
      redacted[key] =
        typeof item === "string" || (item && typeof item === "object")
          ? "(redacted)"
          : item;
    } else {
      redacted[key] = redact(item);
    }
  }
  return redacted;
}

export function debugLogPath(): string {
  return process.env.NUWACLAW_DEBUG_LOG_PATH ?? activeMainLogPath();
}

export function debugLog(
  scope: string,
  message: string,
  meta?: Record<string, unknown>,
): void {
  try {
    initDebugLogging();
    updateLogLinks();
    const filePath = debugLogPath();
    ensureDir(path.dirname(filePath));
    const line =
      JSON.stringify({
        ts: new Date().toISOString(),
        pid: process.pid,
        scope,
        message,
        ...(meta ? { meta: redact(meta) } : {}),
      }) + "\n";
    fs.appendFileSync(filePath, line, "utf8");
  } catch {
    // Debug logging must never break CLI control flow.
  }
}
