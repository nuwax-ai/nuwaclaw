/**
 * ttyd bundled env export helpers
 *
 * 将 getAppEnv() 的部分关键环境变量导出为可被 shell wrapper 加载的脚本，
 * 以便 ttyd 终端会话默认使用应用内置的 uv/pnpm/node/rg/nuwaxcode 等工具，
 * 同时不改变 ttyd 主进程启动时选择的 env（仍可保持 process.env）。
 *
 * PATH 策略：
 * - Unix ttyd bash：直接 export getAppEnv() 的 PATH（已为 `:` 分隔）
 * - Windows ttyd：使用 PowerShell env 脚本（`;` 分隔）
 * - Windows 隔离 Git Bash profile：omit PATH export，用 POSIX `:` 重建 prepend
 */

import * as path from "path";
import { isWindows } from "./shellEnv";

export type TtydEnvMap = Record<string, string>;

/** Substrings that identify bundled-tool directories inside appEnv.PATH. */
export const BUNDLED_PATH_MARKERS = [
  ".nuwaclaw",
  "/resources/node",
  "/resources/uv",
  "/resources/ripgrep",
  "/resources/git",
  "/resources/nuwaxcode",
  "/resources/codex",
  "/resources/ttyd",
  "/electron/dist/node_modules/bin",
  "electron framework.framework",
] as const;

/**
 * PowerShell 5.x on Windows mis-parses LF-only .ps1 files (dot-source blocks fail).
 */
export function toWindowsPowerShellFileContent(content: string): string {
  return content.replace(/\r?\n/g, "\r\n");
}

/** Explicit env keys exported into ttyd / isolated Bash profiles. */
export const BUNDLED_DEV_ENV_EXPLICIT_KEYS = [
  "PATH",
  "NODE_PATH",
  "MSYS2_PATH_TYPE",
  "ORIGINAL_PATH",
  "NUWACLAW_RUNTIME",
] as const;

/** Prefix env keys exported into ttyd / isolated Bash profiles. */
export const BUNDLED_DEV_ENV_PREFIX_KEYS = [
  "UV_",
  "PNPM_",
  "NPM_CONFIG_",
  "NUWAXCODE_",
  "CLAUDE_CODE_",
] as const;

const EXPLICIT_KEYS = BUNDLED_DEV_ENV_EXPLICIT_KEYS;
const PREFIX_KEYS = BUNDLED_DEV_ENV_PREFIX_KEYS;

export function pickTtydBundledEnv(allEnv: TtydEnvMap): TtydEnvMap {
  const picked: TtydEnvMap = {};

  for (const k of EXPLICIT_KEYS) {
    const v = allEnv[k];
    if (typeof v === "string" && v.length > 0) picked[k] = v;
  }

  for (const [k, v] of Object.entries(allEnv)) {
    if (typeof v !== "string" || v.length === 0) continue;
    if (PREFIX_KEYS.some((p) => k.startsWith(p))) {
      picked[k] = v;
    }
  }

  return picked;
}

export function bashSingleQuote(value: string): string {
  // Bash single-quoted string escape using the canonical '"'"' sequence.
  // Example: abc'def -> 'abc'"'"'def'
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

/** Bash `export KEY='value'` lines for bundled dev env (no shebang). */
export function toBashExportLines(
  env: TtydEnvMap,
  options?: { omitKeys?: readonly string[] },
): string[] {
  const omit = new Set(options?.omitKeys ?? []);
  const lines: string[] = [];
  const keys = Object.keys(env).sort();
  for (const key of keys) {
    if (omit.has(key)) continue;
    if (!/^[A-Z_][A-Z0-9_]*$/.test(key)) continue;
    lines.push(`export ${key}=${bashSingleQuote(env[key] ?? "")}`);
  }
  return lines;
}

export function isBundledPathSegment(segment: string): boolean {
  const lower = segment.toLowerCase().replace(/\\/g, "/");
  return BUNDLED_PATH_MARKERS.some((marker) => lower.includes(marker));
}

function dedupePathEntries(entries: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const entry of entries) {
    if (!entry) continue;
    const key =
      isWindows() || /^[A-Za-z]:[\\/]/.test(entry)
        ? entry.toLowerCase()
        : entry;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(entry);
  }
  return result;
}

/** Collect bundled tool directories from getAppEnv() for Bash PATH prepend. */
export function collectBundledDevPathEntries(appEnv: TtydEnvMap): string[] {
  const candidates: string[] = [];
  const push = (dir?: string) => {
    if (dir) candidates.push(dir);
  };

  push(appEnv.NUWAXCODE_NODE_DIR || appEnv.CLAUDE_CODE_NODE_DIR);
  push(appEnv.NUWAXCODE_GIT_BIN_DIR || appEnv.CLAUDE_CODE_GIT_BIN_DIR);
  push(appEnv.NUWAXCODE_RIPGREP_DIR || appEnv.CLAUDE_CODE_RIPGREP_DIR);
  push(appEnv.UV_TOOL_BIN_DIR);
  push(appEnv.PNPM_HOME);
  if (appEnv.NODE_PATH) {
    const pathApi = /^[A-Za-z]:[\\/]/.test(appEnv.NODE_PATH)
      ? path.win32
      : path;
    push(pathApi.join(appEnv.NODE_PATH, ".bin"));
  }

  const rawPath = appEnv.PATH || "";
  const pathSep =
    isWindows() || /(?:^|;)[A-Za-z]:[\\/]/.test(rawPath) ? ";" : ":";
  for (const segment of rawPath.split(pathSep)) {
    if (!segment || !isBundledPathSegment(segment)) continue;
    candidates.push(segment);
  }

  return dedupePathEntries(candidates);
}

export interface BuildBundledBashExportBlockOptions {
  /** Omit PATH export and prepend bundled dirs with POSIX `:` (Git Bash on Windows). */
  rebuildPath?: boolean;
  toPosixPath?: (windowsPath: string) => string;
}

/**
 * Bash export block for bundled dev env (no shebang / sanitize).
 * Used by isolated ACP profiles and can be composed into ttyd bash scripts.
 */
export function buildBundledBashExportBlock(
  appEnv: TtydEnvMap,
  options?: BuildBundledBashExportBlockOptions,
): string {
  const bundledEnv = pickTtydBundledEnv({
    ...appEnv,
    NUWACLAW_RUNTIME: appEnv.NUWACLAW_RUNTIME || "1",
  });
  const parts: string[] = [];
  const exportLines = toBashExportLines(bundledEnv, {
    omitKeys: options?.rebuildPath ? ["PATH"] : [],
  });
  if (exportLines.length > 0) {
    parts.push(exportLines.join("\n"));
  }

  if (options?.rebuildPath) {
    const toPosix = options.toPosixPath ?? ((p: string) => p);
    const pathEntries = collectBundledDevPathEntries(appEnv);
    const posixPaths = pathEntries.map(toPosix);
    if (posixPaths.length > 0) {
      parts.push(`export PATH="${posixPaths.join(":")}:$PATH"`);
    }
  }

  return parts.length > 0 ? `${parts.join("\n")}\n` : "";
}

export function toBashEnvScript(env: TtydEnvMap): string {
  const lines: string[] = [];
  lines.push("#!/bin/bash");
  lines.push("# Nuwax Agent – ttyd bundled env (auto-generated; do not edit)");
  lines.push("");
  lines.push(...toBashExportLines(env));
  lines.push("");
  return lines.join("\n");
}

function psSingleQuote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

export function toPowerShellEnvScript(env: TtydEnvMap): string {
  const lines: string[] = [];
  lines.push("# Nuwax Agent – ttyd bundled env (auto-generated; do not edit)");
  lines.push("$ErrorActionPreference = 'Continue'");
  lines.push("");

  const keys = Object.keys(env).sort();
  for (const key of keys) {
    if (!/^[A-Z_][A-Z0-9_]*$/.test(key)) continue;
    lines.push(`$env:${key} = ${psSingleQuote(env[key] ?? "")}`);
  }

  lines.push("");
  return lines.join("\n");
}
