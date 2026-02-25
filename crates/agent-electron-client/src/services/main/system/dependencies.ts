/**
 * 依赖管理服务 - Electron Client 版本
 *
 * 对应 Tauri 版本的 dependencies.ts
 * 管理本地依赖的检测、安装、版本检查
 */

import * as path from 'path';
import * as fs from 'fs';
import { spawn } from 'child_process';
import { app } from 'electron';
import log from 'electron-log';
import {
  NPM_MIRRORS,
  UV_MIRRORS,
  DEFAULT_MIRROR_CONFIG,
  APP_DATA_DIR_NAME,
} from '../constants';
import { APP_NAME_IDENTIFIER } from '../../../commons/constants';
import { isWindows } from './shellEnv';

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
  | "bundled"
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

// ==================== Mirror / Registry ====================

/** 预置镜像源 */
export const MIRROR_PRESETS = {
  npm: {
    official: NPM_MIRRORS.OFFICIAL,
    taobao: NPM_MIRRORS.TAOBAO,
    tencent: NPM_MIRRORS.TENCENT,
  },
  uv: {
    official: UV_MIRRORS.OFFICIAL,
    tuna: UV_MIRRORS.TUNA,
    aliyun: UV_MIRRORS.ALIYUN,
    tencent: UV_MIRRORS.TENCENT,
  },
} as const;

export interface MirrorConfig {
  npmRegistry: string;
  uvIndexUrl: string;
}

/** 默认国内镜像 */
const DEFAULT_MIRROR: MirrorConfig = {
  npmRegistry: DEFAULT_MIRROR_CONFIG.npmRegistry,
  uvIndexUrl: DEFAULT_MIRROR_CONFIG.uvIndexUrl,
};

/** 运行时缓存，避免每次 spawn 都读 SQLite */
let _mirrorConfig: MirrorConfig = { ...DEFAULT_MIRROR };

/** 设置镜像配置（同时更新运行时缓存，持久化由调用方负责写 settings） */
export function setMirrorConfig(config: Partial<MirrorConfig>): void {
  if (config.npmRegistry !== undefined) _mirrorConfig.npmRegistry = config.npmRegistry;
  if (config.uvIndexUrl !== undefined) _mirrorConfig.uvIndexUrl = config.uvIndexUrl;
  log.info('[Dependencies] Mirror config updated:', _mirrorConfig);
}

/** 获取当前镜像配置 */
export function getMirrorConfig(): MirrorConfig {
  return { ..._mirrorConfig };
}

// ==================== App Paths ====================

// 获取应用数据目录 — 统一使用 ~/.nuwax-agent/
function getAppDataDir(): string {
  return path.join(app.getPath('home'), APP_DATA_DIR_NAME);
}

function getAppBinDir(): string {
  return path.join(getAppDataDir(), 'bin');
}

function getAppNodeModules(): string {
  return path.join(getAppDataDir(), 'node_modules');
}

// 获取 Electron extraResources 路径
export function getResourcesPath(): string {
  if (app.isPackaged) {
    return process.resourcesPath;
  }
  // 开发模式：使用 process.cwd() 获取项目根目录，避免脆弱的相对路径
  // process.cwd() 在开发模式下是 crates/agent-electron-client/
  const projectRoot = process.cwd();
  const resourcesFromCwd = path.join(projectRoot, 'resources');
  // 验证 resources 目录是否存在，如果不存在则回退到 __dirname 相对路径
  if (fs.existsSync(resourcesFromCwd)) {
    return resourcesFromCwd;
  }
  // 回退方案：使用相对路径（编译后 __dirname 是 dist/services/main/system/）
  return path.join(__dirname, '../../../../../resources');
}

// 获取 bundled uv 二进制路径
export function getUvBinPath(): string {
  const uvName = isWindows() ? 'uv.exe' : 'uv';
  return path.join(getResourcesPath(), 'uv', 'bin', uvName);
}

// 获取 bundled nuwax-lanproxy 二进制路径
export function getLanproxyBinPath(): string {
  const binName = isWindows() ? 'nuwax-lanproxy.exe' : 'nuwax-lanproxy';
  return path.join(getResourcesPath(), 'lanproxy', 'bin', binName);
}

/**
 * 构建注入应用内依赖的环境变量（优先应用内，回退系统）
 *
 * 所有 spawned 进程（包括引擎内部再调 npx/npm/uvx/bash 等）都继承此 env，
 * 策略：优先使用应用内依赖，回退到系统工具
 *
 * 隔离策略：
 * 1. PATH: 应用内路径优先，系统 PATH 作为回退
 *    - node/npm/npx → 优先应用内版本
 *    - uv/uvx → 优先应用内 bundled 版本
 *    - bash/git/grep → 使用系统版本
 *
 * 2. Node.js 相关：
 *    - NODE_PATH → 应用内 node_modules
 *    - npm/npx 缓存 → 应用内目录
 *    - npm 镜像源 → 应用配置
 *
 * 3. Python/uv 相关：
 *    - UV_TOOL_DIR → 应用内工具目录
 *    - UV_CACHE_DIR → 应用内缓存
 *    - UV_PYTHON_INSTALL_DIR → 应用内 Python
 *    - uv 镜像源 → 应用配置
 *
 * 4. 用户配置隔离：
 *    - 清除用户 npm 配置文件，避免读取用户全局设置
 *    - 禁用 uv 自动安装到全局目录
 */
export function getAppEnv(): Record<string, string> {
  const appDataDir = getAppDataDir();
  const nodeModulesBin = path.join(appDataDir, 'node_modules', '.bin');
  const appBin = getAppBinDir();
  const uvBin = path.dirname(getUvBinPath());

  const pathSep = isWindows() ? ';' : ':';

  // uv/uvx 数据目录
  const uvDataDir = path.join(appDataDir, 'uv');
  const uvToolBinDir = path.join(uvDataDir, 'tools', 'bin');

  // npm 缓存和全局前缀
  const npmCacheDir = path.join(appDataDir, 'npm-cache');

  // 镜像配置
  const mirror = getMirrorConfig();

  // 构建系统 PATH 的回退路径（仅包含常用系统工具目录）
  // 这样 agent 可以使用 bash/git/grep 等系统工具
  const systemPathPaths = getSystemPaths();

  // PATH 优先级：应用内路径 > 系统 PATH（回退）
  // - node/npm/npx/uv/uvx 会优先使用应用内版本
  // - bash/git/grep 等系统工具通过 systemPathPaths 回退到系统版本
  const priorityPath = [nodeModulesBin, appBin, uvBin, uvToolBinDir, ...systemPathPaths]
    .filter(Boolean)
    .join(pathSep);

  // 构建环境变量对象
  const env: Record<string, string | undefined> = {
    // === PATH：应用内优先，系统回退 ===
    PATH: priorityPath,

    // === Node.js 环境隔离 ===
    NODE_PATH: path.join(appDataDir, 'node_modules'),
    NODE_ENV: process.env.NODE_ENV || 'production',

    // npm/npx: 缓存、全局前缀、镜像源
    NPM_CONFIG_CACHE: npmCacheDir,
    NPM_CONFIG_PREFIX: appDataDir,
    NPM_CONFIG_REGISTRY: mirror.npmRegistry,
    // 使用应用内的 npmrc 配置文件（避免读取用户全局设置）
    // 注意：不要设置为 /dev/null，会导致 npm 配置冲突错误
    NPM_CONFIG_USERCONFIG: path.join(appDataDir, '.npmrc'),
    // 禁用 npm 的更新检查，避免不必要的网络请求
    NO_UPDATE_NOTIFIER: 'true',

    // === Python/uv 环境隔离 ===
    UV_TOOL_DIR: path.join(uvDataDir, 'tools'),
    UV_TOOL_BIN_DIR: uvToolBinDir,
    UV_CACHE_DIR: path.join(uvDataDir, 'cache'),
    UV_PYTHON_INSTALL_DIR: path.join(uvDataDir, 'python'),
    UV_INDEX_URL: mirror.uvIndexUrl,
    // 禁止 uv 自动安装到全局目录
    UV_NO_INSTALL: '1',

    // === 保留必要的环境变量（跨平台兼容）===
    HOME: process.env.HOME || process.env.USERPROFILE,  // Unix: HOME, Windows: USERPROFILE
    USER: process.env.USER || process.env.USERNAME,     // Unix: USER, Windows: USERNAME
    USERNAME: process.env.USERNAME || process.env.USER, // Windows: USERNAME, Unix: USER
    LANG: process.env.LANG || 'en_US.UTF-8',
    TZ: process.env.TZ,
    // Windows 特有：确保正确设置 USERPROFILE
    ...(isWindows() ? { USERPROFILE: process.env.USERPROFILE || process.env.HOME } : {}),
  };

  // 过滤掉 undefined 值并返回
  const cleanEnv: Record<string, string> = {};
  for (const [key, val] of Object.entries(env)) {
    if (val !== undefined) {
      cleanEnv[key] = val;
    }
  }
  return cleanEnv;
}

// ==================== System PATH Utilities ====================

/**
 * 缓存的系统路径，避免重复计算
 * PATH 在进程生命周期内基本不会变化
 */
let cachedSystemPaths: string[] | null = null;

/**
 * 获取系统常用工具路径（用于 PATH 回退）
 * 确保可以使用 bash/git/grep/npm 等系统工具
 *
 * 使用 path 模块保证跨平台兼容性：
 * - macOS/Linux: /usr/bin, /bin, /usr/sbin, /sbin, /usr/local/bin, /opt/homebrew/bin
 * - Windows: C:\Windows\System32, C:\Windows, C:\Program Files\Git\bin, etc.
 *
 * @returns 过滤后的系统路径列表（排除用户 node_modules 相关路径，但保留 npm/node 路径）
 */
function getSystemPaths(): string[] {
  // 返回缓存结果（PATH 在进程生命周期内基本不会变化）
  if (cachedSystemPaths) {
    return cachedSystemPaths;
  }

  const systemPath = process.env.PATH || '';
  const pathSep = isWindows() ? ';' : ':';
  const allPaths = systemPath.split(pathSep).filter(Boolean);

  // 排除模式：只排除项目级别的 node_modules，保留系统级包管理器路径
  // 这样可以找到 npm/node 命令（用户可能通过 Homebrew/NVM/fnm 安装）
  const excludedPatterns = [
    '/node_modules/',         // 项目本地依赖（带路径分隔符避免误伤其他路径）
    '\\node_modules\\',       // Windows 项目本地依赖
  ];

  cachedSystemPaths = allPaths.filter(p => {
    // 使用 path.normalize 标准化路径（处理 Windows 路径分隔符和 . / ..）
    // 然后统一转小写进行比较（Windows 文件系统不区分大小写）
    const normalizedPath = path.normalize(p).toLowerCase();

    // 排除包含项目级 node_modules 的目录
    return !excludedPatterns.some(pattern => normalizedPath.includes(pattern.toLowerCase()));
  });

  // 添加常见系统路径作为回退（macOS GUI 应用可能没有完整 PATH）
  const fallbackPaths: string[] = [];
  if (process.platform === 'darwin') {
    // macOS 常见路径
    fallbackPaths.push(
      '/usr/local/bin',      // Homebrew Intel
      '/opt/homebrew/bin',   // Homebrew Apple Silicon
      '/usr/bin',
      '/bin',
    );
    // 添加常见 Node.js 版本管理器路径
    const home = process.env.HOME || '';
    if (home) {
      // NVM 默认路径
      const nvmDir = process.env.NVM_DIR || path.join(home, '.nvm');
      if (fs.existsSync(nvmDir)) {
        // 尝试找到当前使用的 Node 版本
        const nvmVersionsDir = path.join(nvmDir, 'versions', 'node');
        if (fs.existsSync(nvmVersionsDir)) {
          const versions = fs.readdirSync(nvmVersionsDir).filter(v => v.startsWith('v'));
          // 使用语义化版本排序，取最新的版本
          if (versions.length > 0) {
            const latestVersion = versions
              .sort((a, b) => compareVersions(a.replace('v', ''), b.replace('v', '')))
              .pop();
            if (latestVersion) {
              fallbackPaths.push(path.join(nvmVersionsDir, latestVersion, 'bin'));
            }
          }
        }
      }
      // fnm 默认路径
      const fnmDir = path.join(home, '.fnm');
      if (fs.existsSync(fnmDir)) {
        // fnm 使用 node-versions 目录
        const fnmNodeDir = path.join(fnmDir, 'node-installations');
        if (fs.existsSync(fnmNodeDir)) {
          const versions = fs.readdirSync(fnmNodeDir).filter(v => v.startsWith('v'));
          if (versions.length > 0) {
            // 使用语义化版本排序，取最新的版本
            const latestVersion = versions
              .sort((a, b) => compareVersions(a.replace('v', ''), b.replace('v', '')))
              .pop();
            if (latestVersion) {
              fallbackPaths.push(path.join(fnmNodeDir, latestVersion, 'installation', 'bin'));
            }
          }
        }
      }
    }
  } else if (isWindows()) {
    // Windows 常见路径
    const home = process.env.USERPROFILE || process.env.HOME || '';
    if (home) {
      fallbackPaths.push(
        path.join(home, 'AppData', 'Roaming', 'npm'),
      );
    }
  }

  // 合并并去重
  const allSystemPaths = [...cachedSystemPaths];
  for (const fp of fallbackPaths) {
    if (fs.existsSync(fp) && !allSystemPaths.includes(fp)) {
      allSystemPaths.push(fp);
    }
  }

  cachedSystemPaths = allSystemPaths;
  return cachedSystemPaths;
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
    type: "bundled",
    description: "高性能 Python 包管理器，用于管理 Python 环境和依赖（已集成）",
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
  {
    name: "mcp-stdio-proxy",
    displayName: "MCP 服务",
    type: "npm-local",
    description: "MCP 协议转换工具（应用内安装）",
    required: true,
    minVersion: "0.1.48",
    binName: "mcp-proxy",
  },
  {
    name: "claude-code-acp-ts",
    displayName: "ACP 协议",
    type: "npm-local",
    description: "Agent 引擎统一适配服务（应用内安装）",
    required: true,
    binName: "claude-code-acp-ts",
  },
];

// ==================== Detection Functions ====================

/**
 * 检测 Node.js 版本
 *
 * 在 Electron 环境中，直接使用 process.version 获取内置 Node.js 版本
 * Electron 会绑定特定版本的 Node.js，无需单独安装
 */
export async function checkNodeVersion(): Promise<{
  installed: boolean;
  version?: string;
  meetsRequirement: boolean;
  electronBundled: boolean;
}> {
  return new Promise((resolve) => {
    try {
      // Electron 内置 Node.js，直接使用 process.version
      if (process.versions && process.versions.node) {
        const version = process.versions.node;
        const meets = compareVersions(version, '22.0.0') >= 0;
        resolve({
          installed: true,
          version,
          meetsRequirement: meets,
          electronBundled: true
        });
      } else {
        // 降级方案：尝试 spawn node 命令
        const nodeCmd = isWindows() ? 'node.cmd' : 'node';
        const proc = spawn(nodeCmd, ['--version'], {
          stdio: ['ignore', 'pipe', 'ignore'],
          shell: isWindows(),
        });

        let stdout = '';
        proc.stdout?.on('data', (data) => {
          stdout += data.toString();
        });

        proc.on('close', (code) => {
          if (code === 0) {
            const version = stdout.trim().replace('v', '');
            const meets = compareVersions(version, '22.0.0') >= 0;
            resolve({ installed: true, version, meetsRequirement: meets, electronBundled: false });
          } else {
            resolve({ installed: false, meetsRequirement: false, electronBundled: false });
          }
        });

        proc.on('error', () => {
          resolve({ installed: false, meetsRequirement: false, electronBundled: false });
        });
      }
    } catch {
      resolve({ installed: false, meetsRequirement: false, electronBundled: false });
    }
  });
}

/**
 * 检测 uv 版本
 * 优先使用 bundled 路径，fallback 到系统 uv
 */
export async function checkUvVersion(): Promise<{
  installed: boolean;
  version?: string;
  meetsRequirement: boolean;
  bundled: boolean;
  binPath?: string;
}> {
  // 优先检测 bundled uv
  const bundledPath = getUvBinPath();
  if (fs.existsSync(bundledPath)) {
    const result = await _checkUvBin(bundledPath);
    if (result.installed) {
      return { ...result, bundled: true, binPath: bundledPath };
    }
  }

  // Fallback 到系统 uv
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
        resolve({ installed: true, version, meetsRequirement: meets, bundled: false, binPath: 'uv' });
      } else {
        resolve({ installed: false, meetsRequirement: false, bundled: false });
      }
    });

    proc.on('error', () => {
      resolve({ installed: false, meetsRequirement: false, bundled: false });
    });
  });
}

/** 检测指定路径的 uv 二进制 */
function _checkUvBin(binPath: string): Promise<{
  installed: boolean;
  version?: string;
  meetsRequirement: boolean;
}> {
  return new Promise((resolve) => {
    const proc = spawn(binPath, ['--version'], {
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
    if (isWindows()) {
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
    const checkCmd = isWindows() ? 'where' : 'which';
    const proc = spawn(checkCmd, [command], {
      stdio: ['ignore', 'pipe', 'ignore'],
      shell: isWindows(),
    });

    proc.on('close', (code) => {
      if (code === 0) {
        // 尝试获取版本
        const versionProc = spawn(command, ['--version'], {
          stdio: ['ignore', 'pipe', 'ignore'],
          shell: isWindows(),
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
  const appDataDir = getAppDataDir();

  // 确保目录存在
  if (!fs.existsSync(appDataDir)) {
    fs.mkdirSync(appDataDir, { recursive: true });
  }

  // 初始化 package.json 如果不存在（放在 appDataDir，npm 会自动创建 node_modules/）
  const packageJsonPath = path.join(appDataDir, 'package.json');
  if (!fs.existsSync(packageJsonPath)) {
    fs.writeFileSync(packageJsonPath, JSON.stringify({
      name: APP_NAME_IDENTIFIER,
      version: '1.0.0',
      private: true
    }, null, 2));
  }

  return new Promise((resolve) => {
    const npmCmd = isWindows() ? 'npm.cmd' : 'npm';
    const args = ['install', '--save'];

    if (options?.version) {
      args.push(`${packageName}@${options.version}`);
    } else {
      args.push(packageName);
    }

    if (options?.registry) {
      args.push(`--registry=${options.registry}`);
    }

    log.info(`[Dependencies] Installing ${packageName} in ${appDataDir}...`);

    const proc = spawn(npmCmd, args, {
      cwd: appDataDir,
      env: { ...process.env, ...getAppEnv() },
      stdio: 'pipe',
      shell: isWindows(),
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
          item.status = result.installed
            ? (result.bundled ? 'bundled' : 'installed')
            : 'missing';
          item.version = result.version;
          item.meetsRequirement = result.meetsRequirement;
          item.binPath = result.binPath;
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
  getResourcesPath,
  getUvBinPath,
  getLanproxyBinPath,
  getAppEnv,
  setMirrorConfig,
  getMirrorConfig,
  MIRROR_PRESETS,
};
