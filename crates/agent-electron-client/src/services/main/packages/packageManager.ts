import { app } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { spawn } from 'child_process';
import { getAppEnv } from '../system/dependencies';
import { APP_DATA_DIR_NAME } from '../constants';
import { isWindows } from '../system/shellEnv';

export interface AppPaths {
  appData: string;        // 应用数据目录
  nodeModules: string;   // 本地 node_modules
  temp: string;         // 临时目录
  logs: string;         // 日志目录
  workspaces: string;    // 工作空间
}

// Get application paths
export function getAppPaths(): AppPaths {
  const appData = app?.getPath('userData') || path.join(process.env.HOME || '', APP_DATA_DIR_NAME);
  
  return {
    appData,
    nodeModules: path.join(appData, 'node_modules'),
    temp: path.join(appData, 'temp'),
    logs: path.join(appData, 'logs'),
    workspaces: path.join(appData, 'workspaces'),
  };
}

// Ensure directories exist
export function ensureAppDirs(): AppPaths {
  const dirs = getAppPaths();
  
  for (const [key, dir] of Object.entries(dirs)) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      console.log(`[Paths] Created ${key}: ${dir}`);
    }
  }
  
  return dirs;
}

// Get npm/pnpm executable path (use local if available)
export function getPackageManager(): string {
  // Check for pnpm first, then yarn, then npm
  const appDirs = getAppPaths();
  
  // Check local installation
  const localNpm = path.join(appDirs.nodeModules, '.bin', 'npm');
  const localPnpm = path.join(appDirs.nodeModules, '.bin', 'pnpm');
  const localYarn = path.join(appDirs.nodeModules, '.bin', 'yarn');
  
  if (fs.existsSync(localPnpm)) return localPnpm;
  if (fs.existsSync(localYarn)) return localYarn;
  if (fs.existsSync(localNpm)) return localNpm;
  
  // Fallback to system
  return isWindows() ? 'npm.cmd' : 'npm';
}

// Install package locally (not globally)
export async function installPackage(packageName: string, options?: {
  registry?: string;
  cwd?: string;
}): Promise<{ success: boolean; error?: string }> {
  const dirs = ensureAppDirs();
  const cwd = options?.cwd || dirs.nodeModules;
  const registry = options?.registry;
  
  // Ensure node_modules exists
  if (!fs.existsSync(cwd)) {
    fs.mkdirSync(cwd, { recursive: true });
  }
  
  // Build command
  const npmCmd = isWindows() ? 'npm.cmd' : 'npm';
  const args = ['install', '--save', '--no-save', packageName];
  
  if (registry) {
    args.push(`--registry=${registry}`);
  }
  
  return new Promise((resolve) => {
    console.log(`[Install] Installing ${packageName} in ${cwd}`);

    const proc = spawn(npmCmd, args, {
      cwd,
      env: {
        ...process.env,
        ...getAppEnv(),
      },
      stdio: 'pipe',
      shell: isWindows(),
    });
    
    let stdout = '';
    let stderr = '';
    
    proc.stdout?.on('data', (data) => {
      stdout += data.toString();
    });
    
    proc.stderr?.on('data', (data) => {
      stderr += data.toString();
    });
    
    proc.on('error', (error) => {
      console.error(`[Install] Error:`, error);
      resolve({ success: false, error: error.message });
    });
    
    proc.on('close', (code) => {
      if (code === 0) {
        console.log(`[Install] Success: ${packageName}`);
        resolve({ success: true });
      } else {
        console.error(`[Install] Failed: ${stderr}`);
        resolve({ success: false, error: stderr || 'Install failed' });
      }
    });
  });
}

// Uninstall package
export async function uninstallPackage(packageName: string, options?: {
  cwd?: string;
}): Promise<{ success: boolean; error?: string }> {
  const dirs = getAppPaths();
  const cwd = options?.cwd || dirs.nodeModules;
  
  const npmCmd = isWindows() ? 'npm.cmd' : 'npm';
  const args = ['uninstall', packageName];
  
  return new Promise((resolve) => {
    console.log(`[Uninstall] Uninstalling ${packageName} from ${cwd}`);

    const proc = spawn(npmCmd, args, {
      cwd,
      env: { ...process.env, ...getAppEnv() },
      stdio: 'pipe',
      shell: isWindows(),
    });
    
    let stderr = '';
    
    proc.stderr?.on('data', (data) => {
      stderr += data.toString();
    });
    
    proc.on('error', (error) => {
      resolve({ success: false, error: error.message });
    });
    
    proc.on('close', (code) => {
      if (code === 0) {
        resolve({ success: true });
      } else {
        resolve({ success: false, error: stderr });
      }
    });
  });
}

// Check if package is installed locally
export function isPackageInstalled(packageName: string): boolean {
  const dirs = getAppPaths();
  const packagePath = path.join(dirs.nodeModules, packageName);
  return fs.existsSync(packagePath);
}

// Get installed packages
export function getInstalledPackages(): string[] {
  const dirs = getAppPaths();
  const packageJsonPath = path.join(dirs.nodeModules, 'package.json');
  
  if (!fs.existsSync(packageJsonPath)) {
    return [];
  }
  
  try {
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
    return [
      ...Object.keys(packageJson.dependencies || {}),
      ...Object.keys(packageJson.devDependencies || {}),
    ];
  } catch {
    return [];
  }
}

// Clean up temporary files
export function cleanupTemp(): void {
  const dirs = getAppPaths();
  
  if (fs.existsSync(dirs.temp)) {
    fs.rmSync(dirs.temp, { recursive: true, force: true });
    fs.mkdirSync(dirs.temp, { recursive: true });
    console.log('[Cleanup] Temp directory cleaned');
  }
}

export default {
  getAppPaths,
  ensureAppDirs,
  getPackageManager,
  installPackage,
  uninstallPackage,
  isPackageInstalled,
  getInstalledPackages,
  cleanupTemp,
};
