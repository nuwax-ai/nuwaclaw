import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { spawn } from 'child_process';
import { getAppEnv } from '../system/dependencies';
import { APP_DATA_DIR_NAME } from '../constants';
import { isWindows } from '../system/shellEnv';

// ==================== App Paths ====================

export interface AppPaths {
  appData: string;
  nodeModules: string;
  mcpModules: string;
  temp: string;
  logs: string;
  workspaces: string;
}

let appPaths: AppPaths | null = null;

export function getAppPaths(basePath?: string): AppPaths {
  if (appPaths) return appPaths;

  const base = basePath || os.homedir();

  appPaths = {
    appData: path.join(base, APP_DATA_DIR_NAME),
    nodeModules: path.join(base, APP_DATA_DIR_NAME, 'node_modules'),
    mcpModules: path.join(base, APP_DATA_DIR_NAME, 'node_modules', 'mcp-servers'),
    temp: path.join(base, APP_DATA_DIR_NAME, 'temp'),
    logs: path.join(base, APP_DATA_DIR_NAME, 'logs'),
    workspaces: path.join(base, APP_DATA_DIR_NAME, 'workspaces'),
  };

  // Ensure directories exist
  for (const [, dir] of Object.entries(appPaths)) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  return appPaths;
}

// ==================== Package Detection ====================

export interface PackageInfo {
  name: string;
  version?: string;
  path: string;
  isLocal: boolean;
  isGlobal: boolean;
}

/**
 * Get executable path - check local first, then global
 * This ensures we use the app's own installation
 */
export function getExecutablePath(packageName: string): string | null {
  const dirs = getAppPaths();

  // 1. Check local MCP modules
  const localBin = path.join(dirs.mcpModules, '.bin', packageName);
  if (isWindows()) {
    if (fs.existsSync(localBin + '.cmd')) return localBin + '.cmd';
    if (fs.existsSync(localBin + '.exe')) return localBin + '.exe';
  }
  if (fs.existsSync(localBin)) return localBin;

  // 2. Check local node_modules
  const localNodeBin = path.join(dirs.nodeModules, '.bin', packageName);
  if (isWindows()) {
    if (fs.existsSync(localNodeBin + '.cmd')) return localNodeBin + '.cmd';
    if (fs.existsSync(localNodeBin + '.exe')) return localNodeBin + '.exe';
  }
  if (fs.existsSync(localNodeBin)) return localNodeBin;

  // 3. Return null - package not found locally
  return null;
}

/**
 * Get package JS entry file path from package.json bin field.
 *
 * This resolves the actual JS entry file instead of using .cmd wrappers,
 * which avoids CMD window popup on Windows.
 *
 * @param packageName - The npm package name
 * @param binName - Optional bin name (defaults to packageName)
 * @returns The absolute path to the JS entry file, or null if not found
 */
export function getPackageJsEntryPath(packageName: string, binName?: string): string | null {
  const dirs = getAppPaths();

  // Check in main node_modules
  const packageDir = path.join(dirs.nodeModules, packageName);
  if (fs.existsSync(packageDir)) {
    const entry = resolveBinEntry(packageDir, binName || packageName);
    if (entry) return entry;
  }

  // Check in mcp-servers
  const mcpPackageDir = path.join(dirs.mcpModules, packageName);
  if (fs.existsSync(mcpPackageDir)) {
    const entry = resolveBinEntry(mcpPackageDir, binName || packageName);
    if (entry) return entry;
  }

  return null;
}

/**
 * Resolve bin entry from package.json
 */
function resolveBinEntry(packageDir: string, binName: string): string | null {
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
      // bin: { "command-name": "./path/to/file.js" }
      const binValue = pkg.bin[binName] ?? Object.values(pkg.bin)[0];
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
      path.join(packageDir, 'bin', binName),
      path.join(packageDir, 'bin', `${binName}.js`),
    ];

    for (const p of fallbacks) {
      if (fs.existsSync(p)) return p;
    }

  } catch (e) {
    // Failed to parse package.json - this is expected for malformed packages
    // Silent fail as we have fallback mechanisms
  }

  return null;
}

/**
 * Check if a package is installed locally (in app directory)
 */
export function isInstalledLocally(packageName: string): boolean {
  const dirs = getAppPaths();
  
  // Check in mcp-servers
  const mcpPath = path.join(dirs.mcpModules, packageName);
  if (fs.existsSync(mcpPath)) return true;
  
  // Check in main node_modules
  const nodePath = path.join(dirs.nodeModules, packageName);
  if (fs.existsSync(nodePath)) return true;
  
  return false;
}

/**
 * Check if a package is installed globally (system-wide)
 */
export async function isInstalledGlobally(packageName: string): Promise<boolean> {
  return new Promise((resolve) => {
    const npmCmd = isWindows() ? 'npm.cmd' : 'npm';
    const args = ['list', '-g', '--depth=0', packageName];

    const proc = spawn(npmCmd, args, {
      stdio: ['ignore', 'pipe', 'ignore'],
      shell: isWindows(),
    });
    
    let stdout = '';
    proc.stdout?.on('data', (data) => {
      stdout += data.toString();
    });
    
    proc.on('close', (code) => {
      resolve(code === 0 && stdout.includes(packageName));
    });
    
    proc.on('error', () => {
      resolve(false);
    });
  });
}

/**
 * Get detailed package info - local vs global
 */
export async function getPackageInfo(packageName: string): Promise<PackageInfo> {
  const dirs = getAppPaths();
  
  // Check local first
  const localPath = path.join(dirs.mcpModules, packageName);
  const localNodePath = path.join(dirs.nodeModules, packageName);
  
  let localVersion: string | undefined;
  
  if (fs.existsSync(localPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(localPath, 'package.json'), 'utf-8'));
      localVersion = pkg.version;
    } catch {}
  } else if (fs.existsSync(localNodePath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(localNodePath, 'package.json'), 'utf-8'));
      localVersion = pkg.version;
    } catch {}
  }
  
  const isLocal = fs.existsSync(localPath) || fs.existsSync(localNodePath);
  const isGlobal = await isInstalledGlobally(packageName);
  
  return {
    name: packageName,
    version: localVersion,
    path: isLocal ? (fs.existsSync(localPath) ? localPath : localNodePath) : '',
    isLocal,
    isGlobal,
  };
}

/**
 * Get version of locally installed package
 */
export function getLocalVersion(packageName: string): string | null {
  const dirs = getAppPaths();
  
  // Check mcp-modules first
  const mcpPath = path.join(dirs.mcpModules, packageName, 'package.json');
  if (fs.existsSync(mcpPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(mcpPath, 'utf-8'));
      return pkg.version || null;
    } catch {}
  }
  
  // Check node_modules
  const nodePath = path.join(dirs.nodeModules, packageName, 'package.json');
  if (fs.existsSync(nodePath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(nodePath, 'utf-8'));
      return pkg.version || null;
    } catch {}
  }
  
  return null;
}

/**
 * Get version of globally installed package
 */
export async function getGlobalVersion(packageName: string): Promise<string | null> {
  return new Promise((resolve) => {
    const npmCmd = isWindows() ? 'npm.cmd' : 'npm';
    const args = ['view', packageName, 'version', '--json'];

    const proc = spawn(npmCmd, args, {
      stdio: ['ignore', 'pipe', 'ignore'],
      shell: isWindows(),
    });
    
    let stdout = '';
    
    proc.stdout?.on('data', (data) => {
      stdout += data.toString();
    });
    
    proc.on('close', () => {
      try {
        const version = JSON.parse(stdout.trim());
        resolve(version || null);
      } catch {
        resolve(null);
      }
    });
    
    proc.on('error', () => {
      resolve(null);
    });
  });
}

/**
 * Compare versions and return update info
 */
export async function checkForUpdate(packageName: string): Promise<{
  hasUpdate: boolean;
  localVersion: string | null;
  latestVersion: string | null;
}> {
  const localVersion = getLocalVersion(packageName);
  const latestVersion = await getGlobalVersion(packageName);
  
  if (!localVersion || !latestVersion) {
    return { hasUpdate: false, localVersion, latestVersion };
  }
  
  // Simple version compare (would use semver in production)
  const hasUpdate = localVersion !== latestVersion;
  
  return { hasUpdate, localVersion, latestVersion };
}

/**
 * Get detailed version info for all MCP packages
 */
export async function getAllMCPVersions(): Promise<Record<string, {
  local: string | null;
  global: string | null;
  latest: string | null;
  hasUpdate: boolean;
}>> {
  const mcpPackages = [
    '@modelcontextprotocol/server-filesystem',
    '@modelcontextprotocol/server-brave-search',
    '@modelcontextprotocol/server-github',
    '@modelcontextprotocol/server-sqlite',
    '@modelcontextprotocol/server-puppeteer',
    '@modelcontextprotocol/server-fetch',
  ];
  
  const results: Record<string, any> = {};
  
  for (const pkg of mcpPackages) {
    const localVersion = getLocalVersion(pkg);
    const latestVersion = await getGlobalVersion(pkg);
    
    results[pkg] = {
      local: localVersion,
      global: null, // Would need separate check
      latest: latestVersion,
      hasUpdate: localVersion !== latestVersion && latestVersion !== null,
    };
  }
  
  return results;
}

/**
 * Get list of locally installed packages
 */
export function getLocalPackages(): string[] {
  const dirs = getAppPaths();
  const packages: string[] = [];
  
  // Check mcp-modules
  if (fs.existsSync(dirs.mcpModules)) {
    const entries = fs.readdirSync(dirs.mcpModules);
    for (const entry of entries) {
      if (!entry.startsWith('.')) {
        const stat = fs.statSync(path.join(dirs.mcpModules, entry));
        if (stat.isDirectory()) {
          packages.push(entry);
        }
      }
    }
  }
  
  return packages;
}

/**
 * Spawn a command using LOCAL executable only
 * Throws error if package not found locally
 */
export function spawnLocal(
  packageName: string,
  args: string[],
  options?: {
    cwd?: string;
    env?: Record<string, string>;
    registry?: string;
  }
): ReturnType<typeof spawn> {
  const dirs = getAppPaths();
  
  // Find local executable
  let exePath: string;
  let useArgs: string[];
  
  if (packageName === 'npx' || packageName === 'npm' || packageName === 'yarn' || packageName === 'pnpm') {
    // For package managers, use local installation
    const localBin = path.join(dirs.nodeModules, '.bin', packageName);
    if (isWindows()) {
      exePath = localBin + '.cmd';
    } else {
      exePath = localBin;
    }
    
    // Check if exists
    if (!fs.existsSync(exePath)) {
      // Fallback to system, but warn
      console.warn(`[Warning] Local ${packageName} not found, using system`);
      exePath = packageName;
    }
    useArgs = args;
  } else {
    // For other packages, use npx
    exePath = path.join(dirs.nodeModules, '.bin', 'npx');
    if (isWindows()) {
      exePath += '.cmd';
    }
    
    if (!fs.existsSync(exePath)) {
      exePath = 'npx';
    }
    
    useArgs = ['-y', packageName, ...args];
  }
  
  // Build environment — getAppEnv() 提供完整的应用内隔离环境
  const env: Record<string, string | undefined> = {
    ...process.env,
    ...getAppEnv(),
    ...options?.env,
  };

  // Set npm registry if specified
  if (options?.registry) {
    env.NPM_CONFIG_REGISTRY = options.registry;
  }
  
  return spawn(exePath, useArgs, {
    cwd: options?.cwd || dirs.mcpModules,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: isWindows(),
  });
}

export default {
  getAppPaths,
  getExecutablePath,
  isInstalledLocally,
  isInstalledGlobally,
  getPackageInfo,
  getLocalPackages,
  spawnLocal,
};
