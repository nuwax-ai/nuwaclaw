/**
 * Shell profile utilities for isolated ACP Bash environments (Windows Git Bash).
 *
 * Isolated HOME profiles must expose the same bundled dev toolchain as ttyd
 * (node / pnpm / uv / ripgrep). Without this, `bash -ilc` on Windows rebuilds
 * PATH and agents fall back to system `Program Files\nodejs` instead of bundled tools.
 *
 * On Windows, claude.exe env probe (`bash -ilc env`) can merge MSYS2 init noise into
 * PATH; we sanitize PATH then prepend bundled directories and export PNPM_/UV_/etc.
 */

import * as fs from "fs";
import * as path from "path";
import { isWindows } from "../system/shellEnv";
import {
  buildBundledBashExportBlock,
  collectBundledDevPathEntries,
  isBundledPathSegment,
} from "../system/ttydBundledEnvExport";

export type AppEnvMap = Record<string, string>;

export { collectBundledDevPathEntries, isBundledPathSegment };

/**
 * Convert a Windows path to POSIX format for use in shell scripts.
 */
export function windowsPathToPosix(windowsPath: string): string {
  if (!/^[A-Za-z]:[\\/]/.test(windowsPath)) {
    return windowsPath;
  }
  return windowsPath
    .replace(/\\/g, "/")
    .replace(/^([A-Za-z]):/, (_, drive) => `/${drive.toLowerCase()}`);
}

/**
 * Generate a shell export line that prepends a directory to PATH.
 */
export function generatePathExport(dir: string): string {
  return `export PATH="${dir}:$PATH"\n`;
}

/**
 * Bash snippet that strips MSYS2 init noise from PATH so bundled tools resolve.
 */
export function generatePathSanitizeScript(): string {
  return `# [NuwaClaw] Sanitize PATH if MSYS2 init noise was merged (env probe pollution)
if [[ "$PATH" == *$'\\n'* || "$PATH" == Creating* ]]; then
  _nuwaclaw_clean_path=""
  _nuwaclaw_IFS=:
  for _nuwaclaw_seg in $PATH; do
    case "$_nuwaclaw_seg" in
      /*|[A-Za-z]:/*) _nuwaclaw_clean_path="\${_nuwaclaw_clean_path:+$_nuwaclaw_clean_path:}$_nuwaclaw_seg" ;;
    esac
  done
  PATH="$_nuwaclaw_clean_path"
  unset _nuwaclaw_seg _nuwaclaw_clean_path _nuwaclaw_IFS
fi
`;
}

/**
 * Build isolated-home profile: sanitize PATH (Windows), then prepend tool dirs.
 */
export function buildShellProfileContent(pathEntries: string[]): string {
  const posixPaths = pathEntries.filter(Boolean).map(windowsPathToPosix);
  const pathExport = posixPaths.join(":");
  const parts: string[] = [];
  if (isWindows()) {
    parts.push(generatePathSanitizeScript());
  }
  if (pathExport) {
    parts.push(`export PATH="${pathExport}:$PATH"\n`);
  }
  return parts.join("");
}

/**
 * Full isolated Bash profile: bundled env exports + PATH prepend (matches ttyd bundled env).
 */
export function buildBundledDevShellProfileContent(appEnv: AppEnvMap): string {
  const parts: string[] = [];
  if (isWindows()) {
    parts.push(generatePathSanitizeScript());
  }

  parts.push(
    buildBundledBashExportBlock(appEnv, {
      rebuildPath: true,
      toPosixPath: windowsPathToPosix,
    }),
  );

  return parts.join("");
}

/**
 * Write shell profile files (.bash_profile and .bashrc) to inject bundled tool paths.
 */
export function writeShellProfiles(
  homeDir: string,
  pathEntries: string[],
): void {
  if (pathEntries.length === 0) {
    return;
  }
  const profileLine = buildShellProfileContent(pathEntries);
  if (!profileLine.trim()) {
    return;
  }
  writeProfileFiles(homeDir, profileLine);
}

/**
 * Write isolated HOME profiles with full bundled dev env (node/pnpm/uv/rg + PNPM_/UV_ exports).
 */
export function writeBundledDevShellProfiles(
  homeDir: string,
  appEnv: AppEnvMap,
): void {
  const profileLine = buildBundledDevShellProfileContent(appEnv);
  if (!profileLine.trim()) {
    return;
  }
  writeProfileFiles(homeDir, profileLine);
}

function writeProfileFiles(homeDir: string, profileLine: string): void {
  const profileFiles = [".bash_profile", ".bashrc"];
  for (const filename of profileFiles) {
    const filepath = path.join(homeDir, filename);
    try {
      fs.writeFileSync(filepath, profileLine, "utf-8");
    } catch {
      // Best-effort: shell profile write failure is non-fatal
    }
  }
}
