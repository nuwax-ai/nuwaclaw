/**
 * Shell profile utilities for isolated ACP Bash environments (Windows Git Bash).
 *
 * Primary use case: make bundled **ripgrep** (`rg` / `rg.exe`) discoverable when the
 * agent Bash tool runs `rg`, `rg --version`, etc. Without this, users see exit 127
 * (`rg: command not found`) even though `resources/ripgrep/bin` is shipped in the app.
 *
 * On Windows, claude.exe env probe (`bash -ilc env`) can merge MSYS2 init noise into
 * PATH; we sanitize PATH then prepend directories such as `CLAUDE_CODE_RIPGREP_DIR`.
 */

import * as fs from "fs";
import * as path from "path";
import { isWindows } from "../system/shellEnv";

/**
 * Convert a Windows path to POSIX format for use in shell scripts.
 *
 * Examples:
 * - `C:\foo\bar` → `/c/foo/bar`
 * - `D:\Program Files\Tool` → `/d/Program Files/Tool`
 *
 * On non-Windows platforms, returns the path unchanged.
 *
 * @param windowsPath - The path to convert
 * @returns The POSIX-formatted path
 */
export function windowsPathToPosix(windowsPath: string): string {
  if (!isWindows()) {
    return windowsPath;
  }
  // Replace backslashes with forward slashes
  // Then convert drive letter (C:) to POSIX mount point (/c)
  return windowsPath
    .replace(/\\/g, "/")
    .replace(/^([A-Za-z]):/, (_, drive) => `/${drive.toLowerCase()}`);
}

/**
 * Generate a shell export line that prepends a directory to PATH.
 *
 * @param dir - The directory to add to PATH (in POSIX format)
 * @returns The shell export line (e.g., `export PATH="/c/tools/bin:$PATH"\n`)
 */
export function generatePathExport(dir: string): string {
  return `export PATH="${dir}:$PATH"\n`;
}

/**
 * Bash snippet that strips MSYS2 init noise from PATH so `which rg` / `rg` work again.
 * Polluted PATH is the root cause of `rg: command not found` in the Bash tool on Windows.
 */
export function generatePathSanitizeScript(): string {
  return `# [NuwaClaw] Sanitize PATH if MSYS2 init noise was merged (env probe pollution)
if [[ "$PATH" == *$'\\n'* || "$PATH" == Creating* ]]; then
  _nuwaclaw_clean_path=""
  _nuwaclaw_IFS=:
  for _nuwaclaw_seg in $PATH; do
    case "$_nuwaclaw_seg" in
      /*|[A-Za-z]:/*) _nuwaclaw_clean_path="\${_nuwaclaw_clean_path:+\$_nuwaclaw_clean_path:}$_nuwaclaw_seg" ;;
    esac
  done
  PATH="$_nuwaclaw_clean_path"
  unset _nuwaclaw_seg _nuwaclaw_clean_path _nuwaclaw_IFS
fi
`;
}

/**
 * Build isolated-home profile: sanitize PATH (Windows), then prepend tool dirs (e.g. ripgrep bin).
 */
export function buildShellProfileContent(pathEntries: string[]): string {
  const posixPaths = pathEntries.filter(Boolean).map(windowsPathToPosix);
  const pathExport = posixPaths.join(":");
  const parts: string[] = [];
  if (isWindows()) {
    parts.push(generatePathSanitizeScript());
  }
  parts.push(`export PATH="${pathExport}:$PATH"\n`);
  return parts.join("");
}

/**
 * Write shell profile files (.bash_profile and .bashrc) to inject bundled tool paths.
 *
 * This is used when spawning shell commands in isolated environments where the parent
 * process PATH may not fully propagate to child shells (e.g., Windows Git Bash).
 *
 * The function writes to both `.bash_profile` (for login shells) and `.bashrc`
 * (for interactive non-login shells) to ensure compatibility across different
 * shell invocation methods.
 *
 * @param homeDir - The home directory where profile files will be written
 * @param pathEntries - Array of directories to add to PATH (will be converted to POSIX on Windows)
 *
 * @example
 * ```typescript
 * writeShellProfiles("/tmp/isolated-home", [
 *   "C:\\tools\\ripgrep\\bin",
 *   "C:\\tools\\node\\bin"
 * ]);
 * ```
 */
export function writeShellProfiles(
  homeDir: string,
  pathEntries: string[],
): void {
  if (pathEntries.length === 0) {
    return;
  }

  const profileLine = buildShellProfileContent(pathEntries);

  // Write to both .bash_profile (login shells) and .bashrc (interactive shells)
  const profileFiles = [".bash_profile", ".bashrc"];

  for (const filename of profileFiles) {
    const filepath = path.join(homeDir, filename);
    try {
      fs.writeFileSync(filepath, profileLine, "utf-8");
    } catch {
      // Best-effort: shell profile write failure is non-fatal
      // The shell will still work, just without the bundled tools in PATH
    }
  }
}
