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
import log from 'electron-log';
import { getAppEnv, getNodeBinPath } from '../system/dependencies';

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
      // 处理相对路径（如 ./dist/bin.js）
      // path.join 不会自动规范化，需要手动处理
      let entryPath: string;
      if (binPath.startsWith('./')) {
        // 相对路径：直接拼接并规范化
        entryPath = path.normalize(path.join(packageDir, binPath));
      } else {
        entryPath = path.join(packageDir, binPath);
      }
      
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

  // 检测是否在 Electron 环境中运行
  // 测试环境中 app.getPath 不可用，需要使用回退方案
  const isElectron = typeof process.versions?.electron === 'string';

  // 与 Tauri 一致：调用方已传入完整 env（如 mcp-proxy 的 getAppEnv）时直接使用，不再二次合并 getAppEnv()，避免 PATH/UV_* 被覆盖或时机不一致
  const callerProvidedFullEnv = env && typeof env === 'object' && 'PATH' in env && Object.keys(env).length > 5;
  if (env && !callerProvidedFullEnv && isElectron) {
    log.info(`[spawnNoWindow] 追踪: 未使用完整 env（PATH=${!!env?.PATH}, 键数=${Object.keys(env || {}).length}），将合并 getAppEnv()`);
  }

  if (isWindows()) {
    node = nodePath || process.execPath;
    if (callerProvidedFullEnv && isElectron) {
      mergedEnv = { ...env, ELECTRON_RUN_AS_NODE: '1' } as Record<string, string | undefined>;
      const pathStr = mergedEnv.PATH || '';
      const pathWithUv = pathStr.split(';').filter((p) => p && (p.includes('uv') || p.includes('nuwaclaw')));
      log.info(`[spawnNoWindow] Windows: 使用调用方传入的完整 env (${Object.keys(env).length} 项)`);
      log.info(`[spawnNoWindow] 追踪: 子进程 PATH 中含 uv 的段数=${pathWithUv.length}, 前5段=${pathWithUv.slice(0, 5).join(';') || '(无)'}`);
    } else {
      const appEnv = isElectron ? getAppEnv() : null;
      mergedEnv = appEnv
        ? { ...appEnv, ...env, ELECTRON_RUN_AS_NODE: '1' }
        : {
            ...process.env,
            ...env,
            ELECTRON_RUN_AS_NODE: '1',
            PATH: getEnhancedPath(),
          };
    }
    log.info(`[spawnNoWindow] Windows 调试信息 (Electron: ${isElectron}):`);
    log.info(`[spawnNoWindow]   - process.execPath: ${process.execPath}`);
    log.info(`[spawnNoWindow]   - 使用 node: ${node}`);
    log.info(`[spawnNoWindow]   - PATH 前5个: ${(mergedEnv.PATH || '').split(';').slice(0, 5).join(';')}`);
  } else {
    // Linux/macOS：必须走应用集成的 Node 24（resources/node/<platform-arch>/bin/node），避免容器内 /usr/bin/node 不存在导致 ENOENT
    // 调用方未传 nodePath 时，Electron 下优先 getNodeBinPath()（应用集成 Node 24），无集成 node 时才回退 findSystemNode()
    const integratedNode = isElectron ? getNodeBinPath() : null;
    node = nodePath || (integratedNode ?? findSystemNode());
    if (integratedNode && node === integratedNode) {
      log.info(`[spawnNoWindow] ${process.platform}: 使用应用集成 Node 24: ${node}`);
    }
    if (callerProvidedFullEnv && isElectron) {
      mergedEnv = { ...env } as Record<string, string | undefined>;
      const pathStr = mergedEnv.PATH || '';
      const pathWithUv = pathStr.split(':').filter((p) => p && (p.includes('uv') || p.includes('nuwaclaw')));
      log.info(`[spawnNoWindow] ${process.platform}: 使用调用方传入的完整 env (${Object.keys(env).length} 项)`);
      log.info(`[spawnNoWindow] 追踪: 子进程 PATH 中含 uv 的段数=${pathWithUv.length}, 前5段=${pathWithUv.slice(0, 5).join(':') || '(无)'}`);
    } else {
      const appEnv = isElectron ? getAppEnv() : null;
      mergedEnv = appEnv
        ? { ...appEnv, ...env }
        : {
            ...process.env,
            ...env,
            PATH: getEnhancedPath(),
          };
    }
    // 使用绝对路径的 node 时，将其所在目录插入 PATH 最前，确保子进程内再 spawn('node') 或 process.execPath 能解析到同一可执行文件（避免容器内 /usr/bin/node 不存在导致 ENOENT）
    if (node && path.isAbsolute(node)) {
      const nodeDir = path.dirname(node);
      const currentPath = mergedEnv.PATH || '';
      if (!currentPath.startsWith(nodeDir + path.delimiter)) {
        mergedEnv.PATH = currentPath ? `${nodeDir}${path.delimiter}${currentPath}` : nodeDir;
        log.info(`[spawnNoWindow] ${process.platform}: 已将 node 目录置于 PATH 最前: ${nodeDir}`);
      }
    }
    log.info(`[spawnNoWindow] ${process.platform} 调试信息 (Electron: ${isElectron}):`);
    log.info(`[spawnNoWindow]   - 使用 node: ${node}`);
    log.info(`[spawnNoWindow]   - PATH 前5个: ${(mergedEnv.PATH || '').split(':').slice(0, 5).join(':')}`);
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
