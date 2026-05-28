/**
 * Shell profile utilities for injecting environment variables into isolated shell environments.
 *
 * When spawning shell commands in isolated environments (e.g., ACP sessions),
 * the parent process PATH may not fully propagate to child shells on all platforms.
 * These utilities write shell profile files (.bash_profile, .bashrc) to inject
 * bundled tool paths into the shell's PATH.
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

  // Convert all paths to POSIX format, filtering out any falsy entries
  const posixPaths = pathEntries.filter(Boolean).map(windowsPathToPosix);

  // Generate PATH export line (prepend all directories to existing PATH)
  const pathExport = posixPaths.join(":");
  const profileLine = `export PATH="${pathExport}:$PATH"\n`;

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
