/**
 * Spawn utility for cross-platform console-free execution
 *
 * This module provides solutions for spawning Node.js-based npm packages
 * without console popups (Windows) or Dock icons (macOS).
 *
 * ## Problems Solved
 *
 * 1. **Windows CMD Popup**: When spawning `.cmd` files (npm bin entries),
 *    a console window may flash/popup even with `windowsHide: true`.
 *
 * 2. **macOS Dock Icon**: When using `ELECTRON_RUN_AS_NODE=1` with Electron's
 *    executable, it appears as a new app in the Dock and bounces.
 *
 * ## Solutions (Platform-Specific)
 *
 * - **Windows**: Use Electron's bundled Node.js with `ELECTRON_RUN_AS_NODE=1`
 *   + `windowsHide: true` to bypass `.cmd` files.
 *
 * - **macOS/Linux**: Resolve and use the system `node` executable from user's
 *   shell PATH. This avoids creating a new Dock icon.
 *
 * ## Usage
 * ```typescript
 * import { spawnNpmPackage, spawnJsFile } from './spawnNoWindow';
 *
 * // Spawn an npm package by name
 * const child = spawnNpmPackage('mcp-proxy', ['proxy', '--port', '8080']);
 *
 * // Spawn a JS file directly
 * const child = spawnJsFile('/path/to/script.js', ['--arg']);
 * ```
 *
 * ## Reference
 * This approach is inspired by LobsterAI's coworkUtil.ts implementation.
 */

import { spawn, ChildProcess, SpawnOptions, execSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

/**
 * Options for spawnNoWindow functions
 */
export interface SpawnNoWindowOptions extends Omit<SpawnOptions, 'shell'> {
  /**
   * Custom Node.js executable path (defaults to process.execPath)
   */
  nodePath?: string;
  /**
   * Extra environment variables
   */
  env?: NodeJS.ProcessEnv;
}

/**
 * Resolve the JS entry file path from an npm package's package.json
 *
 * @param packageDir - The package directory (containing package.json)
 * @param binName - The bin name to resolve (defaults to package name)
 * @returns The absolute path to the JS entry file, or null if not found
 */
export function resolveNpmPackageEntry(packageDir: string, binName?: string): string | null {
  const pkgJsonPath = path.join(packageDir, 'package.json');

  if (!fs.existsSync(pkgJsonPath)) {
    return null;
  }

  try {
    const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf-8'));

    // Get bin path from package.json
    let binPath: string | undefined;
    if (typeof pkg.bin === 'string') {
      binPath = pkg.bin;
    } else if (pkg.bin && typeof pkg.bin === 'object') {
      const name = binName || pkg.name;
      const binValue = name ? pkg.bin[name] : Object.values(pkg.bin)[0];
      if (typeof binValue === 'string') {
        binPath = binValue;
      }
    }

    if (binPath) {
      const entryPath = path.join(packageDir, binPath);
      if (fs.existsSync(entryPath)) {
        return entryPath;
      }
    }

    // Fallback: try common entry file locations
    const fallbacks = [
      path.join(packageDir, 'index.js'),
      path.join(packageDir, 'cli.js'),
      path.join(packageDir, 'dist', 'index.js'),
    ];

    for (const p of fallbacks) {
      if (fs.existsSync(p)) return p;
    }

  } catch {
    // Failed to parse package.json
  }

  return null;
}

/**
 * Spawn a JS file using Node.js without console window on Windows
 * or without creating a new Dock icon on macOS.
 *
 * Platform-Specific Behavior:
 *
 * - **Windows**: Uses Electron's bundled Node.js with `ELECTRON_RUN_AS_NODE=1`
 *   to bypass `.cmd` files that cause console popups.
 *
 * - **macOS/Linux**: Uses the system `node` executable (resolved from user's
 *   shell PATH) to avoid creating a new Dock icon.
 *
 * @param jsFile - Absolute path to the JS file to execute
 * @param args - Arguments to pass to the JS file
 * @param options - Spawn options
 * @returns ChildProcess instance
 */
export function spawnJsFile(
  jsFile: string,
  args: string[] = [],
  options: SpawnNoWindowOptions = {},
): ChildProcess {
  const { nodePath, env, ...spawnOptions } = options;

  // Platform-specific node executable selection
  let node: string;
  let mergedEnv: Record<string, string | undefined>;

  if (isWindows()) {
    // Windows: Use Electron's bundled Node with ELECTRON_RUN_AS_NODE
    // This bypasses .cmd files and prevents console popup
    node = nodePath || process.execPath;
    mergedEnv = {
      ...process.env,
      ...env,
      // Critical: Tell Electron to run in Node.js mode (Windows only)
      ELECTRON_RUN_AS_NODE: '1',
    };
    
    // DEBUG: 记录平台调试信息
    console.log(`[spawnNoWindow] 平台: ${process.platform}, 调试信息:`);
    console.log('  - process.execPath:', process.execPath);
    console.log('  - 使用 node:', node);
    console.log('  - ELECTRON_RUN_AS_NODE:', mergedEnv.ELECTRON_RUN_AS_NODE);
    console.log('  - PATH:', mergedEnv.PATH?.split(':').slice(0, 5).join(':'));
  } else {
    // macOS/Linux: Use system node to avoid Dock icon issue
    node = nodePath || findSystemNode();
    mergedEnv = {
      ...process.env,
      ...env,
      // Ensure subprocess can find node and other tools
      PATH: getEnhancedPath(),
    };

    // Log which node is being used
    console.log(`[spawnNoWindow] 平台: ${process.platform}, 使用 node: ${node}`);
    console.log(`[spawnNoWindow] PATH 前5个: ${mergedEnv.PATH?.split(':').slice(0, 5).join(':')}`);
  }

  return spawn(node, [jsFile, ...args], {
    ...spawnOptions,
    env: mergedEnv,
    windowsHide: true,
    // Don't use shell - we're executing node directly
  });
}

/**
 * Spawn an npm package by resolving its entry file
 *
 * This is the recommended way to spawn npm packages on Windows
 * to avoid console popup windows.
 *
 * @param packageDir - The npm package directory
 * @param args - Arguments to pass to the package
 * @param options - Spawn options
 * @param binName - Optional bin name (if different from package name)
 * @returns ChildProcess instance, or null if entry file not found
 */
export function spawnNpmPackage(
  packageDir: string,
  args: string[] = [],
  options: SpawnNoWindowOptions = {},
  binName?: string,
): ChildProcess | null {
  const entryFile = resolveNpmPackageEntry(packageDir, binName);

  if (!entryFile) {
    return null;
  }

  return spawnJsFile(entryFile, args, options);
}

/**
 * Check if we're running on Windows
 */
export function isWindows(): boolean {
  return process.platform === 'win32';
}

/**
 * Check if we're running on macOS
 */
export function isMacOS(): boolean {
  return process.platform === 'darwin';
}

/**
 * Helper to get the node executable path
 * On Electron, this returns the bundled Node.js path
 */
export function getNodePath(): string {
  return process.execPath;
}

// ==================== System Node Resolution (macOS/Linux) ====================

/**
 * Cached user shell PATH. Resolved once and reused across calls.
 * On packaged Electron apps (macOS), the user's shell profile is not inherited,
 * so node/npm won't be in PATH unless we resolve it.
 */
let cachedUserShellPath: string | null | undefined;

/**
 * Cached system node path. Resolved once and reused across calls.
 */
let cachedSystemNodePath: string | undefined;

/**
 * Reset all internal caches.
 * Useful for testing or when PATH may have changed.
 */
export function resetCache(): void {
  cachedUserShellPath = undefined;
  cachedSystemNodePath = undefined;
}

/**
 * Resolve the user's login shell PATH on macOS/Linux.
 *
 * Packaged Electron apps on macOS don't inherit the user's shell profile,
 * so node/npm and other tools won't be in PATH unless we resolve it.
 *
 * @returns The user's shell PATH, or null if not resolvable
 */
function resolveUserShellPath(): string | null {
  if (cachedUserShellPath !== undefined) return cachedUserShellPath;

  if (isWindows()) {
    cachedUserShellPath = null;
    return null;
  }

  try {
    const shell = process.env.SHELL || '/bin/bash';
    // Use login shell (-il) to source user's profile files
    const result = execSync(`${shell} -ilc 'echo __PATH__=$PATH'`, {
      encoding: 'utf-8',
      timeout: 5000,
      env: { ...process.env },
    });
    const match = result.match(/__PATH__=(.+)/);
    cachedUserShellPath = match ? match[1].trim() : null;
  } catch (error) {
    console.warn('[spawnNoWindow] Failed to resolve user shell PATH:', error);
    cachedUserShellPath = null;
  }

  return cachedUserShellPath;
}

/**
 * Find the system `node` executable path on macOS/Linux.
 *
 * Uses the user's shell PATH to find node, which works with:
 * - Homebrew installed node (`/opt/homebrew/bin/node` or `/usr/local/bin/node`)
 * - nvm (`~/.nvm/versions/node/...`)
 * - volta (`~/.volta/bin/node`)
 * - fnm (`~/.fnm/...`)
 *
 * @returns The path to system node, or 'node' as fallback
 */
export function findSystemNode(): string {
  if (isWindows()) {
    // On Windows, we use Electron's bundled node with ELECTRON_RUN_AS_NODE
    return process.execPath;
  }

  // Return cached result if available
  if (cachedSystemNodePath !== undefined) {
    return cachedSystemNodePath;
  }

  // Try to get user's shell PATH
  const userPath = resolveUserShellPath();

  if (userPath) {
    // Search for node in user's PATH
    const pathDirs = userPath.split(path.delimiter);
    for (const dir of pathDirs) {
      const nodePath = path.join(dir, 'node');
      if (fs.existsSync(nodePath)) {
        cachedSystemNodePath = nodePath;
        return nodePath;
      }
    }
  }

  // Fallback: try common node installation paths
  const home = process.env.HOME || process.env.USERPROFILE || '';
  const commonPaths = [
    '/usr/local/bin/node',
    '/opt/homebrew/bin/node',
    '/usr/bin/node',
    path.join(home, '.nvm/versions/node/current/bin/node'),
    path.join(home, '.volta/bin/node'),
    path.join(home, '.fnm/current/bin/node'),
  ];

  for (const p of commonPaths) {
    if (fs.existsSync(p)) {
      cachedSystemNodePath = p;
      return p;
    }
  }

  // Final fallback: assume 'node' is in PATH
  // Log warning in development mode
  if (process.env.NODE_ENV === 'development' || !process.env.NODE_ENV) {
    console.warn('[spawnNoWindow] Could not find system node, using "node" from PATH');
  }

  cachedSystemNodePath = 'node';
  return 'node';
}

/**
 * Get the PATH environment value with user's shell PATH prepended.
 * Used for macOS/Linux to ensure subprocesses can find node and other tools.
 */
function getEnhancedPath(): string {
  const currentPath = process.env.PATH || '';
  const userPath = resolveUserShellPath();

  if (userPath) {
    // Prepend user's shell PATH to get node, npm, etc.
    return `${userPath}${path.delimiter}${currentPath}`;
  }

  return currentPath;
}
