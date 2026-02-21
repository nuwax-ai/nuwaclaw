/**
 * 依赖管理服务 - Electron Client 版本
 * 
 * 对应 Tauri 版本的 dependencies.ts
 * 管理本地依赖的检测、安装、版本检查
 */

import * as path from 'path';
import * as fs from 'fs';
import { spawn } from 'child_process';
import log from 'electron-log';

// ==================== Types ====================

export type DependencyStatus = 
  | "checking"
  | "installed"
  | "missing"
  | "outdated"
  | "installing"
  | "bundled"
  | "error";

export type LocalDependencyType = 
  | "system"
  | "npm-local"
  | "npm-global"
  | "shell-installer";

export interface LocalDependencyConfig {
  name: string;
  displayName: string;
  type: LocalDependencyType;
  description: string;
  required: boolean;
  minVersion?: string;
  installUrl?: string;
  binName?: string;
  installerUrl?: string;
  postInstallHint?: string;
}

export interface LocalDependencyItem extends LocalDependencyConfig {
  status: DependencyStatus;
  version?: string;
  latestVersion?: string;
  binPath?: string;
  errorMessage?: string;
  meetsRequirement?: boolean;
}

// ==================== App Paths ====================

// 获取应用数据目录
function getAppDataDir(): string {
  // 尝试从环境变量或默认路径获取
  const homeDir = process.env.HOME || process.env.USERPROFILE || '';
  return path.join(homeDir, '.nuwax-agent');
}

function getAppBinDir(): string {
  return path.join(getAppDataDir(), 'bin');
}

function getAppNodeModules(): string {
  return path.join(getAppDataDir(), 'node_modules');
}

// ==================== Required Dependencies ====================

/**
 * 初始化向导必需依赖配置
 * 对应 Tauri 版本的 SETUP_REQUIRED_DEPENDENCIES
 */
export const SETUP_REQUIRED_DEPENDENCIES: LocalDependencyConfig[] = [
  {
    name: "uv",
    displayName: "uv",
    type: "system",
    description: "高性能 Python 包管理器，用于管理 Python 环境和依赖",
    required: true,
    minVersion: "0.5.0",
    installUrl: "https://docs.astral.sh/uv/getting-started/installation/",
  },
  {
    name: "nuwax-file-server",
    displayName: "文件服务",
    type: "npm-local",
    description: "Agent 工作目录文件远程管理服务（应用内安装）",
    required: true,
    binName: "nuwax-file-server",
  },
  {
    name: "nuwaxcode",
    displayName: "Agent 引擎",
    type: "npm-local",
    description: "Agent 执行引擎（应用内安装）",
    required: true,
    binName: "nuwaxcode",
  },
];

// ==================== Detection Functions ====================

/**
 * 检测 Node.js 版本
 */
export async function checkNodeVersion(): Promise<{
  installed: boolean;
  version?: string;
  meetsRequirement: boolean;
}> {
  return new Promise((resolve) => {
    const nodeCmd = process.platform === 'win32' ? 'node.cmd' : 'node';
    const proc = spawn(nodeCmd, ['--version'], {
      stdio: ['ignore', 'pipe', 'ignore'],
    });

    let stdout = '';
    proc.stdout?.on('data', (data) => {
      stdout += data.toString();
    });

    proc.on('close', (code) => {
      if (code === 0) {
        const version = stdout.trim().replace('v', '');
        const meets = compareVersions(version, '22.0.0') >= 0;
        resolve({ installed: true, version, meetsRequirement: meets });
      } else {
        resolve({ installed: false, meetsRequirement: false });
      }
    });

    proc.on('error', () => {
      resolve({ installed: false, meetsRequirement: false });
    });
  });
}

/**
 * 检测 uv 版本
 */
export async function checkUvVersion(): Promise<{
  installed: boolean;
  version?: string;
  meetsRequirement: boolean;
}> {
  return new Promise((resolve) => {
    const proc = spawn('uv', ['--version'], {
      stdio: ['ignore', 'pipe', 'ignore'],
    });

    let stdout = '';
    proc.stdout?.on('data', (data) => {
      stdout += data.toString();
    });

    proc.on('close', (code) => {
      if (code === 0) {
        const match = stdout.match(/(\d+\.\d+\.\d+)/);
        const version = match ? match[1] : 'unknown';
        const meets = compareVersions(version, '0.5.0') >= 0;
        resolve({ installed: true, version, meetsRequirement: meets });
      } else {
        resolve({ installed: false, meetsRequirement: false });
      }
    });

    proc.on('error', () => {
      resolve({ installed: false, meetsRequirement: false });
    });
  });
}

/**
 * 检测 npm 本地包
 */
export async function detectNpmPackage(
  packageName: string,
  binName?: string
): Promise<{
  installed: boolean;
  version?: string;
  binPath?: string;
}> {
  const nodeModules = getAppNodeModules();
  const packagePath = path.join(nodeModules, packageName, 'package.json');

  // 检查是否安装
  if (!fs.existsSync(packagePath)) {
    return { installed: false };
  }

  // 读取版本
  let version: string | undefined;
  try {
    const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf-8'));
    version = pkg.version;
  } catch {}

  // 查找可执行文件
  let binPath: string | undefined;
  const searchPaths = [
    path.join(nodeModules, '.bin', binName || packageName),
    path.join(nodeModules, packageName, 'bin', binName || packageName),
  ];

  for (const p of searchPaths) {
    if (process.platform === 'win32') {
      if (fs.existsSync(p + '.cmd')) {
        binPath = p + '.cmd';
        break;
      }
      if (fs.existsSync(p + '.exe')) {
        binPath = p + '.exe';
        break;
      }
    } else if (fs.existsSync(p)) {
      binPath = p;
      break;
    }
  }

  return { installed: true, version, binPath };
}

/**
 * 检测 shell 命令是否存在
 */
export async function detectShellCommand(command: string): Promise<{
  installed: boolean;
  version?: string;
  binPath?: string;
}> {
  return new Promise((resolve) => {
    // 先检查 which/where
    const checkCmd = process.platform === 'win32' ? 'where' : 'which';
    const proc = spawn(checkCmd, [command], {
      stdio: ['ignore', 'pipe', 'ignore'],
    });

    proc.on('close', (code) => {
      if (code === 0) {
        // 尝试获取版本
        const versionProc = spawn(command, ['--version'], {
          stdio: ['ignore', 'pipe', 'ignore'],
        });

        let stdout = '';
        versionProc.stdout?.on('data', (data) => {
          stdout += data.toString();
        });

        versionProc.on('close', () => {
          const versionMatch = stdout.match(/(\d+\.\d+\.\d+)/);
          resolve({
            installed: true,
            version: versionMatch ? versionMatch[1] : undefined,
            binPath: command,
          });
        });

        versionProc.on('error', () => {
          resolve({ installed: true, binPath: command });
        });
      } else {
        resolve({ installed: false });
      }
    });

    proc.on('error', () => {
      resolve({ installed: false });
    });
  });
}

// ==================== Install Functions ====================

/**
 * 安装 npm 本地包
 */
export async function installNpmPackage(
  packageName: string,
  options?: {
    registry?: string;
    version?: string;
  }
): Promise<{
  success: boolean;
  version?: string;
  binPath?: string;
  error?: string;
}> {
  const nodeModules = getAppNodeModules();

  // 确保目录存在
  if (!fs.existsSync(nodeModules)) {
    fs.mkdirSync(nodeModules, { recursive: true });
  }

  // 初始化 package.json 如果不存在
  const packageJsonPath = path.join(nodeModules, 'package.json');
  if (!fs.existsSync(packageJsonPath)) {
    fs.writeFileSync(packageJsonPath, JSON.stringify({
      name: 'nuwax-agent',
      version: '1.0.0',
      private: true
    }, null, 2));
  }

  return new Promise((resolve) => {
    const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    const args = ['install', '--save', '--no-save'];
    
    if (options?.version) {
      args.push(`${packageName}@${options.version}`);
    } else {
      args.push(packageName);
    }

    if (options?.registry) {
      args.push(`--registry=${options.registry}`);
    }

    log.info(`[Dependencies] Installing ${packageName}...`);

    const proc = spawn(npmCmd, args, {
      cwd: nodeModules,
      env: { ...process.env },
      stdio: 'pipe',
    });

    let stderr = '';
    proc.stderr?.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('error', (error) => {
      log.error(`[Dependencies] Install error:`, error);
      resolve({ success: false, error: error.message });
    });

    proc.on('close', (code) => {
      if (code === 0) {
        // 检测安装结果
        detectNpmPackage(packageName).then((result) => {
          log.info(`[Dependencies] ${packageName} installed:`, result);
          resolve({
            success: true,
            version: result.version,
            binPath: result.binPath,
          });
        });
      } else {
        log.error(`[Dependencies] Install failed:`, stderr);
        resolve({ success: false, error: stderr || 'Install failed' });
      }
    });
  });
}

// ==================== Main Service ====================

/**
 * 检查所有依赖状态
 */
export async function checkAllDependencies(): Promise<LocalDependencyItem[]> {
  const results: LocalDependencyItem[] = [];

  for (const dep of SETUP_REQUIRED_DEPENDENCIES) {
    const item: LocalDependencyItem = {
      ...dep,
      status: 'checking',
    };

    try {
      switch (dep.name) {
        case 'uv': {
          const result = await checkUvVersion();
          item.status = result.installed ? 'installed' : 'missing';
          item.version = result.version;
          item.meetsRequirement = result.meetsRequirement;
          break;
        }
        case 'nuwaxcode':
        case 'nuwax-file-server':
        case 'mcp-stdio-proxy':
        case 'claude-code-acp-ts': {
          const result = await detectNpmPackage(dep.name, dep.binName);
          item.status = result.installed ? 'installed' : 'missing';
          item.version = result.version;
          item.binPath = result.binPath;
          break;
        }
        default: {
          item.status = 'missing';
        }
      }
    } catch (error) {
      item.status = 'error';
      item.errorMessage = String(error);
    }

    results.push(item);
  }

  return results;
}

/**
 * 安装缺失的依赖
 */
export async function installMissingDependencies(): Promise<{
  success: boolean;
  results: Array<{ name: string; success: boolean; error?: string }>;
}> {
  const results: Array<{ name: string; success: boolean; error?: string }> = [];

  // 先检查所有依赖状态
  const deps = await checkAllDependencies();

  for (const dep of deps) {
    if (dep.status === 'missing' && dep.required) {
      log.info(`[Dependencies] Installing missing: ${dep.name}`);

      if (dep.type === 'npm-local') {
        const result = await installNpmPackage(dep.name);
        results.push({
          name: dep.name,
          success: result.success,
          error: result.error,
        });
      } else {
        results.push({
          name: dep.name,
          success: false,
          error: 'System dependency - manual install required',
        });
      }
    }
  }

  const allSuccess = results.every(r => r.success);
  return { success: allSuccess, results };
}

/**
 * 获取依赖摘要
 */
export function getDependenciesSummary(): {
  total: number;
  installed: number;
  missing: number;
  missingRequired: string[];
} {
  // 同步版本 - 需要先调用 checkAllDependencies
  return {
    total: SETUP_REQUIRED_DEPENDENCIES.length,
    installed: 0,
    missing: 0,
    missingRequired: [],
  };
}

// ==================== Utils ====================

/**
 * 简单版本比较
 * 返回: 1 = a > b, 0 = a == b, -1 = a < b
 */
function compareVersions(a: string, b: string): number {
  const aParts = a.split('.').map(Number);
  const bParts = b.split('.').map(Number);

  for (let i = 0; i < Math.max(aParts.length, bParts.length); i++) {
    const aPart = aParts[i] || 0;
    const bPart = bParts[i] || 0;
    if (aPart > bPart) return 1;
    if (aPart < bPart) return -1;
  }
  return 0;
}

export default {
  SETUP_REQUIRED_DEPENDENCIES,
  checkNodeVersion,
  checkUvVersion,
  detectNpmPackage,
  detectShellCommand,
  installNpmPackage,
  checkAllDependencies,
  installMissingDependencies,
  getAppDataDir,
  getAppBinDir,
  getAppNodeModules,
};
