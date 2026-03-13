/**
 * 依赖管理服务 - Electron Client 版本
 *
 * 对应 Tauri 版本的 dependencies.ts
 * 管理本地依赖的检测、安装、版本检查
 */

import * as path from "path";
import * as fs from "fs";
import { spawn, execSync } from "child_process";
import { app } from "electron";
import log from "electron-log";
import {
  NPM_MIRRORS,
  UV_MIRRORS,
  DEFAULT_MIRROR_CONFIG,
  APP_DATA_DIR_NAME,
} from "../constants";
import { APP_NAME_IDENTIFIER } from "@shared/constants";
import { isWindows } from "./shellEnv";
import {
  spawnCrossPlatform,
  getNpmCommand,
  getNodeCommand,
  getCommandChecker,
} from "../utils/spawn";

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
  /** 初始化/安装缺失依赖时使用的版本；存在则 npm install <name>@<installVersion> */
  installVersion?: string;
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
  if (config.npmRegistry !== undefined)
    _mirrorConfig.npmRegistry = config.npmRegistry;
  if (config.uvIndexUrl !== undefined)
    _mirrorConfig.uvIndexUrl = config.uvIndexUrl;
  log.info("[Dependencies] Mirror config updated:", _mirrorConfig);
}

/** 获取当前镜像配置 */
export function getMirrorConfig(): MirrorConfig {
  return { ..._mirrorConfig };
}

// ==================== App Paths ====================

// 获取应用数据目录 — 统一使用 ~/.nuwaclaw/
function getAppDataDir(): string {
  return path.join(app.getPath("home"), APP_DATA_DIR_NAME);
}

function getAppBinDir(): string {
  return path.join(getAppDataDir(), "bin");
}

function getAppNodeModules(): string {
  return path.join(getAppDataDir(), "node_modules");
}

/** 初始化依赖同步状态文件名（~/.nuwaclaw/.init-deps-state.json） */
const INIT_DEPS_STATE_FILENAME = ".init-deps-state.json";

export interface InitDepsState {
  appVersion: string;
  packages: Record<string, string>;
}

/**
 * 读取上次初始化依赖同步状态（用于检测客户端升级后是否需要重装）
 */
export function getInitDepsState(): InitDepsState | null {
  const filePath = path.join(getAppDataDir(), INIT_DEPS_STATE_FILENAME);
  if (!fs.existsSync(filePath)) return null;
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    const data = JSON.parse(raw) as InitDepsState;
    if (typeof data.appVersion !== "string" || !data.packages || typeof data.packages !== "object")
      return null;
    return data;
  } catch {
    return null;
  }
}

/**
 * 写入初始化依赖同步状态（安装/同步完成后调用）
 */
export function setInitDepsState(state: InitDepsState): void {
  const dir = getAppDataDir();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, INIT_DEPS_STATE_FILENAME);
  fs.writeFileSync(filePath, JSON.stringify(state, null, 2), "utf-8");
  log.info("[Dependencies] init-deps-state 已更新:", state.appVersion, Object.keys(state.packages).length, "packages");
}

// 获取 Electron extraResources 路径
export function getResourcesPath(): string {
  if (app.isPackaged) {
    return process.resourcesPath;
  }
  // 开发模式：使用 process.cwd() 获取项目根目录，避免脆弱的相对路径
  // process.cwd() 在开发模式下是 crates/agent-electron-client/
  const projectRoot = process.cwd();
  const resourcesFromCwd = path.join(projectRoot, "resources");
  // 验证 resources 目录是否存在，如果不存在则回退到 __dirname 相对路径
  if (fs.existsSync(resourcesFromCwd)) {
    return resourcesFromCwd;
  }
  // 回退方案：使用相对路径（编译后 __dirname 是 dist/main/services/system/）
  return path.join(__dirname, "../../../../../resources");
}

// 获取 Electron 内置 Node.js 的 bin 目录路径
// 优先级最高：优先使用 Electron 内置的 npm/npx/node
function getElectronNodeBinDir(): string {
  try {
    const execDir = path.dirname(process.execPath);

    if (isWindows()) {
      // Windows: 打包后路径
      // Electron Framework/Versions/Current/Resources/app.asar.unpacked/node_modules/electron/dist/
      // 或直接使用 Electron 内置的 node
      const paths = [
        path.join(
          execDir,
          "resources",
          "app.asar.unpacked",
          "node_modules",
          "electron",
          "dist",
          "node_modules",
          "bin",
        ),
        path.join(
          execDir,
          "..",
          "Resources",
          "app.asar.unpacked",
          "node_modules",
          "electron",
          "dist",
          "node_modules",
          "bin",
        ),
      ];

      for (const p of paths) {
        if (fs.existsSync(p)) {
          return p;
        }
      }

      // 回退：尝试使用 Electron 运行时的 node 所在目录的兄弟目录
      // Electron 内置 node 通常在 Electron Framework/Contents/Frameworks/Electron Framework.framework/Versions/Current/node/bin
      const electronFrameworkPath = path.join(
        execDir,
        "Contents",
        "Frameworks",
        "Electron Framework.framework",
        "Versions",
        "Current",
        "node",
        "bin",
      );
      if (fs.existsSync(electronFrameworkPath)) {
        return electronFrameworkPath;
      }
    } else if (process.platform === "darwin") {
      // macOS: Electron Framework/node/bin
      const electronFrameworkPath = path.join(
        execDir,
        "Contents",
        "Frameworks",
        "Electron Framework.framework",
        "Versions",
        "Current",
        "node",
        "bin",
      );
      if (fs.existsSync(electronFrameworkPath)) {
        return electronFrameworkPath;
      }
    } else {
      // Linux: 类似路径
      const electronFrameworkPath = path.join(
        execDir,
        "resources",
        "app.asar.unpacked",
        "node_modules",
        "electron",
        "dist",
        "node_modules",
        "bin",
      );
      if (fs.existsSync(electronFrameworkPath)) {
        return electronFrameworkPath;
      }
    }
  } catch (error) {
    // 测试环境中可能出错，返回空字符串
    log.warn(`[getElectronNodeBinDir] 错误: ${error}`);
  }

  return ""; // 未找到
}

/** 获取 bundled uv 二进制路径（打包后为 process.resourcesPath/uv/bin/uv，开发时为 resources/uv/bin/uv） */
export function getUvBinPath(): string {
  const uvName = isWindows() ? "uv.exe" : "uv";
  return path.join(getResourcesPath(), "uv", "bin", uvName);
}

/**
 * 获取 bundled Node.js 二进制路径
 *
 * 打包后: process.resourcesPath/node/<platform-arch>/bin/node
 * 开发时: resources/node/<platform-arch>/bin/node
 *
 * 若 Node.js 资源不存在，会记录警告并返回 null。
 * 调用方应检查返回值并处理缺失情况。
 */
export function getNodeBinPath(): string | null {
  const platformKey = `${process.platform}-${process.arch}`;
  const nodeName = isWindows() ? "node.exe" : "node";
  const nodePath = path.join(
    getResourcesPath(),
    "node",
    platformKey,
    "bin",
    nodeName,
  );

  if (!fs.existsSync(nodePath)) {
    log.warn(`[Dependencies] 内置 Node.js 未找到: ${nodePath}`);
    log.warn('[Dependencies] 请运行 "npm run prepare:node" 下载 Node.js 资源');
    return null;
  }

  return nodePath;
}

/**
 * Get Node.js binary path with fallback to system node.
 *
 * Priority:
 * 1. Bundled Node.js 24 (resources/node/<platform>/bin/node)
 * 2. System node from PATH (macOS/Linux only, for development)
 *
 * On Windows, system node fallback is NOT available - bundled Node.js is required.
 * On macOS/Linux in development, this allows running without prepare:node.
 *
 * @returns Node.js binary path, or null if not found
 */
export function getNodeBinPathWithFallback(): string | null {
  // 1. Try bundled Node.js first
  const bundledPath = getNodeBinPath();
  if (bundledPath) return bundledPath;

  // 2. Fallback to system node (macOS/Linux only)
  if (!isWindows()) {
    const systemNode = findSystemNode();
    if (systemNode) {
      log.info(`[Dependencies] 使用系统 Node.js fallback: ${systemNode}`);
      return systemNode;
    }
  }

  return null;
}

/**
 * Find system node executable from PATH.
 * Used as fallback when bundled Node.js is not available.
 */
function findSystemNode(): string | null {
  try {
    const cmd = isWindows() ? "where node" : "which node";
    const result = execSync(cmd, { encoding: "utf-8", timeout: 5000 }).trim();
    // `where` on Windows may return multiple lines; take the first
    const firstLine = result.split("\n")[0].trim();
    if (firstLine && fs.existsSync(firstLine)) {
      return firstLine;
    }
  } catch {
    // which command failed, node not found in PATH
  }
  return null;
}

/**
 * 应用内集成：确保 uv 在应用内可用。
 * 若 bundled（getUvBinPath）不存在，但 resources/uv/bin 存在（如开发环境已执行 prepare:uv），
 * 则一次性复制到 ~/.nuwaclaw/bin，该目录已在 PATH 中，后续 MCP 等子进程即可找到 uv。
 *
 * 注意：不创建 uvx 硬链接/复制。uv >= 0.10 的 uvx 多调用已失效（调用 uvx 不等于 uv tool run），
 * 所以 resolveUvCommand() 统一将 uvx 命令重写为 `uv tool run`。
 */
function ensureUvInAppBin(): void {
  try {
    const uvBinPath = getUvBinPath();
    if (fs.existsSync(uvBinPath)) {
      log.info(`[ensureUvInAppBin] bundled uv 已存在: ${uvBinPath}`);
      return;
    }
    const appBin = getAppBinDir();
    const uvName = isWindows() ? "uv.exe" : "uv";
    const appBinUv = path.join(appBin, uvName);
    if (fs.existsSync(appBinUv)) {
      log.info(`[ensureUvInAppBin] 应用目录已有 uv: ${appBinUv}`);
      return;
    }
    const srcBin = path.join(getResourcesPath(), "uv", "bin");
    const srcUv = path.join(srcBin, uvName);
    const srcExists = fs.existsSync(srcUv);
    const srcBinIsDir =
      fs.existsSync(srcBin) && fs.statSync(srcBin).isDirectory();
    log.info(
      `[ensureUvInAppBin] resources/uv/bin: ${srcBin}, uv 存在=${srcExists}, 是目录=${srcBinIsDir}`,
    );
    if (!srcExists || !srcBinIsDir) return;
    if (!fs.existsSync(appBin)) fs.mkdirSync(appBin, { recursive: true });
    for (const name of fs.readdirSync(srcBin)) {
      const src = path.join(srcBin, name);
      if (fs.statSync(src).isFile()) {
        fs.copyFileSync(src, path.join(appBin, name));
        log.info(`[ensureUvInAppBin] 已复制应用内 uv: ${name} -> ${appBin}`);
      }
    }
    log.info(`[ensureUvInAppBin] 复制完成，appBin=${appBin}`);
  } catch (e) {
    log.warn("[ensureUvInAppBin] 应用内 uv 检查/复制失败:", e);
  }
}


// 获取 bundled nuwax-lanproxy 二进制路径
// 运行时根据平台选择正确的二进制文件；优先 binaries/<平台名>，其次 bin/nuwax-lanproxy[.exe]
export function getLanproxyBinPath(): string {
  const resourcesPath = getResourcesPath();
  const binariesDir = path.join(resourcesPath, "lanproxy", "binaries");
  const binDir = path.join(resourcesPath, "lanproxy", "bin");

  // 平台映射 (Node → Rust target)
  const platformMap: Record<string, string> = {
    "darwin-arm64": "nuwax-lanproxy-aarch64-apple-darwin",
    "darwin-x64": "nuwax-lanproxy-x86_64-apple-darwin",
    "win32-x64": "nuwax-lanproxy-x86_64-pc-windows-msvc.exe",
    "win32-ia32": "nuwax-lanproxy-i686-pc-windows-msvc.exe",
    "linux-x64": "nuwax-lanproxy-x86_64-unknown-linux-gnu",
    "linux-arm64": "nuwax-lanproxy-aarch64-unknown-linux-gnu",
  };

  const platformKey = `${process.platform}-${process.arch}`;
  const binaryName = platformMap[platformKey];

  // 1. 优先：binaries/ 下平台对应文件名
  if (binaryName) {
    const binaryPath = path.join(binariesDir, binaryName);
    if (fs.existsSync(binaryPath)) {
      return binaryPath;
    }
  }

  // 2. Fallback：旧版 bin/ 目录（prepare:lanproxy 按当前平台复制的单文件）
  const binName = isWindows() ? "nuwax-lanproxy.exe" : "nuwax-lanproxy";
  const binPath = path.join(binDir, binName);
  if (fs.existsSync(binPath)) {
    return binPath;
  }

  // 3. Windows 额外回退：binaries/ 下 nuwax-lanproxy*.exe（跨平台打包时 bin/ 可能是其他平台）
  //    优先选与 process.arch 匹配的（x64→x86_64，ia32→i686）
  if (isWindows() && fs.existsSync(binariesDir)) {
    try {
      const entries = fs.readdirSync(binariesDir, { withFileTypes: true });
      const exes = entries.filter(
        (e) => e.isFile() && e.name.endsWith(".exe") && e.name.toLowerCase().includes("lanproxy")
      );
      if (exes.length > 0) {
        const preferArch = process.arch === "x64" ? "x86_64" : "i686";
        const preferred = exes.find((e) => e.name.includes(preferArch));
        const exe = preferred ?? exes[0];
        const found = path.join(binariesDir, exe.name);
        log.info("[getLanproxyBinPath] 使用 binaries 内发现的 exe:", exe.name);
        return found;
      }
    } catch {
      // 忽略读目录失败，继续返回统一错误路径
    }
  }

  // 都不存在时返回预期路径（让调用者报错）
  return path.join(binDir, binName);
}

// 获取 bundled Node.js 24 路径（集成到 resources/node/）
// prepare-node 输出到 resources/node/<platform>-<arch>/，bin 目录包含 node/npm/npx
function getBundledNodeBinDir(): string {
  const resourcesPath = getResourcesPath();
  const arch =
    process.arch === "x64" ? "x64" : process.arch === "arm64" ? "arm64" : "x64";
  const nodePlatformKey = `${process.platform}-${arch}`;
  const nodeBinPath = path.join(resourcesPath, "node", nodePlatformKey, "bin");
  if (fs.existsSync(nodeBinPath)) {
    log.info(`[getBundledNodeBinDir] 使用内置 Node.js: ${nodeBinPath}`);
    return nodeBinPath;
  }
  const devPath = path.join(
    process.cwd(),
    "resources",
    "node",
    nodePlatformKey,
    "bin",
  );
  if (fs.existsSync(devPath)) {
    log.info(`[getBundledNodeBinDir] 开发模式使用内置 Node.js: ${devPath}`);
    return devPath;
  }
  return "";
}

// 获取 bundled Git 路径（集成到 resources/git/）
// 参考 LobsterAI 方案：https://github.com/netease-youdao/LobsterAI
// Windows 需要 git-bash 执行 shell 命令
function getBundledGitBinDir(): string {
  if (!isWindows()) {
    return ""; // macOS/Linux 不需要
  }

  const resourcesPath = getResourcesPath();
  const gitBinPath = path.join(resourcesPath, "git", "bin");

  if (fs.existsSync(gitBinPath)) {
    log.info(`[getBundledGitBinDir] 使用内置 Git: ${gitBinPath}`);
    return gitBinPath;
  }

  // 开发模式回退
  const devPath = path.join(process.cwd(), "resources", "git", "bin");
  if (fs.existsSync(devPath)) {
    log.info(`[getBundledGitBinDir] 开发模式使用内置 Git: ${devPath}`);
    return devPath;
  }

  return ""; // 未找到
}

/** 获取 bundled git-bash 路径（Windows 下为 prepare-git 集成的 bash.exe，供端口检查等统一走 bash） */
export function getBundledGitBashPath(): string {
  if (!isWindows()) {
    return "";
  }

  const resourcesPath = getResourcesPath();
  const bashPaths = [
    path.join(resourcesPath, "git", "bin", "bash.exe"),
    path.join(resourcesPath, "git", "usr", "bin", "bash.exe"),
  ];

  for (const p of bashPaths) {
    if (fs.existsSync(p)) {
      log.info(`[getBundledGitBashPath] 使用内置 git-bash: ${p}`);
      return p;
    }
  }

  // 开发模式回退
  const devPaths = [
    path.join(process.cwd(), "resources", "git", "bin", "bash.exe"),
    path.join(process.cwd(), "resources", "git", "usr", "bin", "bash.exe"),
  ];

  for (const p of devPaths) {
    if (fs.existsSync(p)) {
      log.info(`[getBundledGitBashPath] 开发模式使用内置 git-bash: ${p}`);
      return p;
    }
  }

  return ""; // 未找到
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
export interface GetAppEnvOptions {
  /**
   * 是否包含系统 PATH 环境变量。
   * - true: 包含系统 PATH（默认行为，适用于需要访问系统工具的进程）
   * - false: 只包含应用内集成的 PATH（适用于 MCP 代理等需要精简环境的进程）
   * @default true
   */
  includeSystemPath?: boolean;
}

export function getAppEnv(opts?: GetAppEnvOptions): Record<string, string> {
  const { includeSystemPath = true } = opts ?? {};

  const appDataDir = getAppDataDir();
  const nodeModulesBin = path.join(appDataDir, "node_modules", ".bin");
  const appBin = getAppBinDir();

  // 应用内集成：优先使用 bundled uv；若无则尝试从 resources 复制到 appBin（一次），保证 uv/uvx 来自应用内
  ensureUvInAppBin();
  const uvBinPath = getUvBinPath();
  const uvBin = fs.existsSync(uvBinPath)
    ? path.dirname(uvBinPath)
    : fs.existsSync(path.join(appBin, isWindows() ? "uv.exe" : "uv"))
      ? appBin
      : "";

  const pathSep = isWindows() ? ";" : ":";

  // uv/uvx 数据目录（仅当应用内 uv 存在时加入，否则依赖系统 PATH 回退）
  const uvDataDir = path.join(appDataDir, "uv");
  const uvToolBinDir = uvBin ? path.join(uvDataDir, "tools", "bin") : "";

  // npm 缓存和全局前缀
  const npmCacheDir = path.join(appDataDir, "npm-cache");

  // pnpm 全局 bin 目录（pnpm global 安装的可执行文件放在 PNPM_HOME 下）
  const pnpmHome = path.join(appDataDir, "pnpm", "global");

  // 镜像配置
  const mirror = getMirrorConfig();

  // 获取内置 Node.js 24、Git 和 Electron Node 路径
  const bundledNodeBinDir = getBundledNodeBinDir();
  const bundledGitBinDir = getBundledGitBinDir();
  const bundledGitBashPath = getBundledGitBashPath();
  const electronNodeBinDir = getElectronNodeBinDir();

  // 构建系统 PATH 的回退路径（仅包含常用系统工具目录）
  // 这样 agent 可以使用 bash/git/grep 等系统工具
  const systemPathPaths = includeSystemPath ? getSystemPaths() : [];

  // PATH 优先级：应用内 uv/uvx 优先，再应用内 node/npm，最后系统回退
  // - bundledNodeBinDir: 内置 Node.js 24（仅 Windows）
  // - bundledGitBinDir: 内置 Git bin（仅 Windows）
  // - electronNodeBinDir: Electron 内置的 npm/npx
  // - uvBin/uvToolBinDir: 应用内 uv/uvx（优先，保证 MCP 等子进程用应用内版本）
  // - pnpmHome: 应用内 pnpm global bin
  // - nodeModulesBin: 应用内 node_modules/.bin
  // - appBin: 应用内 bin
  // - systemPathPaths: 系统工具回退（可选，由 includeSystemPath 控制）
  const priorityPath = [
    bundledNodeBinDir,
    electronNodeBinDir,
    bundledGitBinDir,
    uvBin,
    uvToolBinDir,
    pnpmHome,
    nodeModulesBin,
    appBin,
    ...systemPathPaths,
  ]
    .filter(Boolean)
    .join(pathSep);

  // 调试日志：输出 PATH 优先级（应用内 uv 优先）
  log.info(`[getAppEnv] PATH 优先级 (${process.platform}):`);
  log.info(
    `[getAppEnv]   1. 内置 Node.js 24: ${bundledNodeBinDir || "(未找到)"}`,
  );
  log.info(
    `[getAppEnv]   2. Electron Node: ${electronNodeBinDir || "(未找到)"}`,
  );
  log.info(
    `[getAppEnv]   3. 内置 Git: ${bundledGitBinDir || (isWindows() ? "(未找到)" : "(macOS/Linux 使用系统)")}`,
  );
  log.info(
    `[getAppEnv]   4. uv/uvx(应用内优先): ${uvBin || "(未找到，将使用系统 PATH 回退)"}`,
  );
  log.info(`[getAppEnv]   5. node_modules: ${nodeModulesBin}`);
  log.info(`[getAppEnv]   6. app bin: ${appBin}`);
  log.info(
    `[getAppEnv]   7. 系统回退: ${systemPathPaths.slice(0, 3).join(", ")}...`,
  );
  // 追踪：PATH 中是否包含可能含 uvx 的目录（便于排查 uvx 类 MCP 不生效）
  const pathSegments = priorityPath.split(pathSep);
  const uvRelated = pathSegments.filter(
    (p) => p && (p.includes("uv") || p.includes("nuwaclaw")),
  );
  log.info(
    `[getAppEnv] 追踪 uv/uvx: PATH 中与 uv 相关段数=${uvRelated.length}, 前5段=${uvRelated.slice(0, 5).join(" | ") || "(无)"}`,
  );

  // 构建环境变量对象
  const env: Record<string, string | undefined> = {
    // === PATH：内置 Node.js/Git 优先，应用内，回退系统 ===
    PATH: priorityPath,

    // === Node.js 环境隔离 ===
    NODE_PATH: path.join(appDataDir, "node_modules"),
    NODE_ENV: process.env.NODE_ENV || "production",

    // npm/npx: 缓存、全局前缀、镜像源
    NPM_CONFIG_CACHE: npmCacheDir,
    NPM_CONFIG_PREFIX: appDataDir,
    NPM_CONFIG_REGISTRY: mirror.npmRegistry,
    // 使用应用内的 npmrc 配置文件（避免读取用户全局设置）
    // 注意：不要设置为 /dev/null，会导致 npm 配置冲突错误
    NPM_CONFIG_USERCONFIG: path.join(appDataDir, ".npmrc"),
    // 禁用 npm 的更新检查，避免不必要的网络请求
    NO_UPDATE_NOTIFIER: "true",

    // pnpm: 全局目录、store、缓存、状态目录隔离到应用内
    PNPM_HOME: pnpmHome,
    PNPM_STORE_DIR: path.join(appDataDir, "pnpm", "store"),
    PNPM_CACHE_DIR: path.join(appDataDir, "pnpm", "cache"),
    PNPM_STATE_DIR: path.join(appDataDir, "pnpm", "state"),

    // === Python/uv 环境隔离 ===
    UV_TOOL_DIR: path.join(uvDataDir, "tools"),
    UV_TOOL_BIN_DIR: uvToolBinDir,
    UV_CACHE_DIR: path.join(uvDataDir, "cache"),
    UV_PYTHON_INSTALL_DIR: path.join(uvDataDir, "python"),
    UV_INDEX_URL: mirror.uvIndexUrl,
    // 禁止 uv 自动安装到全局目录
    UV_NO_INSTALL: "1",

    // === 保留必要的环境变量（跨平台兼容）===
    HOME: process.env.HOME || process.env.USERPROFILE, // Unix: HOME, Windows: USERPROFILE
    USER: process.env.USER || process.env.USERNAME, // Unix: USER, Windows: USERNAME
    USERNAME: process.env.USERNAME || process.env.USER, // Windows: USERNAME, Unix: USER
    LANG: process.env.LANG || "en_US.UTF-8",
    TZ: process.env.TZ,
    // Windows 特有：确保正确设置 USERPROFILE
    ...(isWindows()
      ? { USERPROFILE: process.env.USERPROFILE || process.env.HOME }
      : {}),
  };

  // 过滤掉 undefined 值并返回
  const cleanEnv: Record<string, string> = {};
  for (const [key, val] of Object.entries(env)) {
    if (val !== undefined) {
      cleanEnv[key] = val;
    }
  }

  // === 为 Agent 引擎设置环境变量（仅 Windows 需要内置 Node.js/Git）===
  // 参考 LobsterAI 方案：https://github.com/netease-youdao/LobsterAI
  // nuwaxcode-acp (opencode 改造) 使用 NUWAXCODE_* 前缀
  // claude-code-acp-ts (Claude Code) 使用 CLAUDE_CODE_* 前缀

  // 设置内置 Node.js 24 路径（仅 Windows）
  // macOS/Linux 使用系统 npm/node
  if (bundledNodeBinDir) {
    cleanEnv.NUWAXCODE_NODE_DIR = bundledNodeBinDir;
    cleanEnv.CLAUDE_CODE_NODE_DIR = bundledNodeBinDir;
  }

  // 设置内置 Git bash 路径（仅 Windows）
  if (bundledGitBashPath) {
    cleanEnv.NUWAXCODE_GIT_BASH_PATH = bundledGitBashPath;
    cleanEnv.CLAUDE_CODE_GIT_BASH_PATH = bundledGitBashPath;

    // 设置 MSYS2_PATH_TYPE=inherit 确保 git-bash 继承完整 PATH
    cleanEnv.MSYS2_PATH_TYPE = "inherit";
  }

  // 设置内置 Git bin 路径（仅 Windows）
  if (bundledGitBinDir) {
    cleanEnv.NUWAXCODE_GIT_BIN_DIR = bundledGitBinDir;
    cleanEnv.CLAUDE_CODE_GIT_BIN_DIR = bundledGitBinDir;
  }

  // === Windows 特定优化（参考 LobsterAI）===
  if (isWindows()) {
    // 1. 确保 Windows 关键系统环境变量存在
    // 某些系统命令和 DLL 依赖这些变量
    const windowsCriticalEnvVars: Record<string, string> = {
      SystemRoot:
        process.env.SystemRoot || process.env.SYSTEMROOT || "C:\\windows",
      windir:
        process.env.windir ||
        process.env.WINDIR ||
        process.env.SystemRoot ||
        "C:\\windows",
      COMSPEC: process.env.COMSPEC || "C:\\windows\\system32\\cmd.exe",
      SYSTEMDRIVE: process.env.SYSTEMDRIVE || "C:",
    };

    for (const [key, value] of Object.entries(windowsCriticalEnvVars)) {
      if (!cleanEnv[key]) {
        cleanEnv[key] = value;
        log.info(`[getAppEnv] 添加 Windows 系统环境变量: ${key}=${value}`);
      }
    }

    // 2. 确保 Windows 系统目录在 PATH 中（始终添加，这是系统运行必需的）
    const windowsSystemPathEntries = [
      "C:\\Windows\\System32",
      "C:\\Windows\\System32\\Wbem",
      "C:\\Windows\\System32\\WindowsPowerShell\\v1.0",
      "C:\\Windows\\System32\\OpenSSH",
    ];

    let currentPath = cleanEnv.PATH || "";
    const currentPathLower = currentPath.split(";").map((p) => p.toLowerCase());

    for (const sysPath of windowsSystemPathEntries) {
      if (!currentPathLower.includes(sysPath.toLowerCase())) {
        currentPath = currentPath + ";" + sysPath;
        cleanEnv.PATH = currentPath;
      }
    }

    // 3. 设置 ORIGINAL_PATH（POSIX 格式）供 git-bash 使用
    // 注意：当 includeSystemPath 为 false 时，跳过此步骤以精简环境变量
    // 参考 LobsterAI: 确保 git-bash 的 /etc/profile 正确处理 PATH
    // 注意：限制条目数量以避免超过 Windows 环境变量长度限制 (32,767)
    if (includeSystemPath && bundledGitBashPath) {
      const MAX_ORIGINAL_PATH_ENTRIES = 20; // 限制条目数量
      const pathEntries = (cleanEnv.PATH || "").split(";").filter(Boolean);
      const limitedEntries = pathEntries.slice(0, MAX_ORIGINAL_PATH_ENTRIES);
      const posixPath = limitedEntries
        .map((p) => p.replace(/\\/g, "/"))
        .join(":");
      cleanEnv.ORIGINAL_PATH = posixPath;
      log.info(
        `[getAppEnv] 设置 ORIGINAL_PATH (${limitedEntries.length}/${pathEntries.length} entries)`,
      );
    }

    // 4. 从注册表读取最新 PATH（解决用户后安装的工具不在 PATH 中的问题）
    // 注意：当 includeSystemPath 为 false 时，跳过此步骤以精简环境变量
    if (includeSystemPath) {
      try {
        const { execSync } = require("child_process");
        const psScript = [
          '$machinePath = [Environment]::GetEnvironmentVariable("Path", "Machine")',
          '$userPath = [Environment]::GetEnvironmentVariable("Path", "User")',
          '[Console]::Write("$machinePath;$userPath")',
        ].join("; ");
        const encodedCommand = Buffer.from(psScript, "utf16le").toString(
          "base64",
        );
        const result = execSync(
          `powershell -NoProfile -NonInteractive -EncodedCommand ${encodedCommand}`,
          {
            encoding: "utf-8",
            timeout: 10000,
            windowsHide: true,
          },
        );

        const registryPath = result.trim();
        if (registryPath) {
          const registryEntries = registryPath
            .split(";")
            .map((entry: string) => entry.trim())
            .filter(Boolean);

          // 去重并追加到 PATH 末尾
          // 注意：限制追加的条目数量以避免超过 Windows 环境变量长度限制
          const MAX_REGISTRY_PATH_ENTRIES = 10; // 最多从注册表追加10个条目
          const existingPaths = new Set(
            currentPath.split(";").map((p) => p.toLowerCase()),
          );
          const missingEntries: string[] = [];

          for (const entry of registryEntries) {
            if (missingEntries.length >= MAX_REGISTRY_PATH_ENTRIES) {
              log.info(
                `[getAppEnv] 已达到最大注册表 PATH 条目限制 (${MAX_REGISTRY_PATH_ENTRIES})，跳过剩余条目`,
              );
              break;
            }
            if (!existingPaths.has(entry.toLowerCase())) {
              missingEntries.push(entry);
              existingPaths.add(entry.toLowerCase());
            }
          }

          if (missingEntries.length > 0) {
            cleanEnv.PATH = currentPath + ";" + missingEntries.join(";");
            log.info(
              `[getAppEnv] 从注册表追加 ${missingEntries.length} 个 PATH 条目`,
            );
          }
        }
      } catch (error) {
        log.warn(`[getAppEnv] 读取注册表 PATH 失败: ${error}`);
      }
    } else {
      log.info(`[getAppEnv] 跳过注册表 PATH 读取（includeSystemPath=false）`);
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

  const systemPath = process.env.PATH || "";
  const pathSep = isWindows() ? ";" : ":";
  const allPaths = systemPath.split(pathSep).filter(Boolean);

  // 排除模式：只排除项目级别的 node_modules，保留系统级包管理器路径
  // 这样可以找到 npm/node 命令（用户可能通过 Homebrew/NVM/fnm 安装）
  const excludedPatterns = [
    "/node_modules/", // 项目本地依赖（带路径分隔符避免误伤其他路径）
    "\\node_modules\\", // Windows 项目本地依赖
  ];

  cachedSystemPaths = allPaths.filter((p) => {
    // 使用 path.normalize 标准化路径（处理 Windows 路径分隔符和 . / ..）
    // 然后统一转小写进行比较（Windows 文件系统不区分大小写）
    const normalizedPath = path.normalize(p).toLowerCase();

    // 排除包含项目级 node_modules 的目录
    return !excludedPatterns.some((pattern) =>
      normalizedPath.includes(pattern.toLowerCase()),
    );
  });

  // 添加常见系统路径作为回退（macOS GUI 应用可能没有完整 PATH）
  // 以及 Electron 内置 Node.js 路径
  const fallbackPaths: string[] = [];

  // ========== Electron 内置 Node.js 路径 ==========
  if (process.platform === "darwin") {
    // macOS: Electron 内置 Node.js
    const electronPath = process.execPath.replace(
      /\/Contents\/MacOS\/.*/,
      "/Contents/Frameworks/Electron Framework.framework/Versions/Current/node/bin",
    );
    if (fs.existsSync(electronPath)) {
      fallbackPaths.push(electronPath);
    }

    // macOS 常见路径（含 uv/uvx：Homebrew 与官方安装脚本 ~/.local/bin）
    fallbackPaths.push(
      "/usr/local/bin", // Homebrew Intel、部分 uv 安装
      "/opt/homebrew/bin", // Homebrew Apple Silicon
      "/usr/bin",
      "/bin",
    );
    const homeMac = process.env.HOME || "";
    if (homeMac) {
      const localBin = path.join(homeMac, ".local", "bin");
      if (fs.existsSync(localBin)) fallbackPaths.push(localBin);
    }
    // 添加常见 Node.js 版本管理器路径
    const home = process.env.HOME || "";
    if (home) {
      // NVM 默认路径
      const nvmDir = process.env.NVM_DIR || path.join(home, ".nvm");
      if (fs.existsSync(nvmDir)) {
        // 尝试找到当前使用的 Node 版本
        const nvmVersionsDir = path.join(nvmDir, "versions", "node");
        if (fs.existsSync(nvmVersionsDir)) {
          const versions = fs
            .readdirSync(nvmVersionsDir)
            .filter((v) => v.startsWith("v"));
          // 使用语义化版本排序，取最新的版本
          if (versions.length > 0) {
            const latestVersion = versions
              .sort((a, b) =>
                compareVersions(a.replace(/^v/, ""), b.replace(/^v/, "")),
              )
              .pop();
            if (latestVersion) {
              fallbackPaths.push(
                path.join(nvmVersionsDir, latestVersion, "bin"),
              );
            }
          }
        }
      }
      // fnm 默认路径
      const fnmDir = path.join(home, ".fnm");
      if (fs.existsSync(fnmDir)) {
        // fnm 使用 node-versions 目录
        const fnmNodeDir = path.join(fnmDir, "node-installations");
        if (fs.existsSync(fnmNodeDir)) {
          const versions = fs
            .readdirSync(fnmNodeDir)
            .filter((v) => v.startsWith("v"));
          if (versions.length > 0) {
            // 使用语义化版本排序，取最新的版本
            const latestVersion = versions
              .sort((a, b) =>
                compareVersions(a.replace(/^v/, ""), b.replace(/^v/, "")),
              )
              .pop();
            if (latestVersion) {
              fallbackPaths.push(
                path.join(fnmNodeDir, latestVersion, "installation", "bin"),
              );
            }
          }
        }
      }
    }
  } else if (process.platform === "linux") {
    // Linux：常见 uv/uvx 安装路径
    const homeLinux = process.env.HOME || "";
    if (homeLinux) {
      const localBin = path.join(homeLinux, ".local", "bin");
      if (fs.existsSync(localBin)) fallbackPaths.push(localBin);
    }
    fallbackPaths.push("/usr/local/bin", "/usr/bin", "/bin");
  } else if (isWindows()) {
    // Windows: 使用 getElectronNodeBinDir() 获取 Electron 内置 Node.js
    // (在 getSystemPaths 中复用，主要由 getAppEnv 中的优先级控制)

    // Windows 常见路径
    const home = process.env.USERPROFILE || process.env.HOME || "";
    const programFiles = process.env.PROGRAMFILES || "C:\\Program Files";
    const programFilesX86 =
      process.env["PROGRAMFILES(X86)"] || "C:\\Program Files (x86)";

    if (home) {
      fallbackPaths.push(path.join(home, "AppData", "Roaming", "npm"));
    }

    // 添加系统 Node.js 路径
    fallbackPaths.push(
      path.join(programFiles, "nodejs"),
      path.join(programFilesX86, "nodejs"),
      "C:\\Windows\\system32",
      "C:\\Windows",
    );
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
    name: "pnpm",
    displayName: "pnpm 包管理器",
    type: "npm-local",
    description: "高性能 Node.js 包管理器（应用内安装）",
    required: true,
    binName: "pnpm",
    installVersion: "10.30.3",
  },
  {
    name: "nuwax-file-server",
    displayName: "文件服务",
    type: "npm-local",
    description: "Agent 工作目录文件远程管理服务（应用内安装）",
    required: true,
    binName: "nuwax-file-server",
    installVersion: "1.2.3",
  },
  {
    name: "nuwaxcode",
    displayName: "Agent 引擎",
    type: "npm-local",
    description: "Agent 执行引擎（应用内安装）",
    required: true,
    binName: "nuwaxcode",
    installVersion: "1.1.63",
  },
  {
    name: "nuwax-mcp-stdio-proxy",
    displayName: "MCP 服务",
    type: "npm-local",
    description: "MCP 协议聚合代理（应用内安装）",
    required: true,
    minVersion: "1.0.0",
    binName: "nuwax-mcp-stdio-proxy",
    installVersion: "1.4.10",
  },
  {
    name: "claude-code-acp-ts",
    displayName: "ACP 协议",
    type: "npm-local",
    description: "Agent 引擎统一适配服务（应用内安装）",
    required: true,
    binName: "claude-code-acp-ts",
    installVersion: "0.16.1",
  },
];

// ==================== Detection Functions ====================

/**
 * 检测 Node.js 版本
 *
 * 优先检测内置 Node.js 24 (resources/node/<platform>/bin/node)
 * Fallback 到 Electron 内置 Node.js 或系统 Node.js
 */
export async function checkNodeVersion(): Promise<{
  installed: boolean;
  version?: string;
  meetsRequirement: boolean;
  bundled: boolean;
  binPath?: string;
}> {
  // 优先检测内置 Node.js 24
  const bundledPath = getNodeBinPath();
  log.info(`[checkNodeVersion] 检测内置 Node.js: ${bundledPath || "(未找到)"}`);

  if (bundledPath && fs.existsSync(bundledPath)) {
    log.info(
      `[checkNodeVersion] 内置 Node.js 文件存在，尝试执行: ${bundledPath}`,
    );
    const result = await _checkNodeBin(bundledPath);
    log.info(`[checkNodeVersion] 内置 Node.js 检测结果:`, result);
    if (result.installed) {
      return { ...result, bundled: true, binPath: bundledPath };
    }
  }

  // Fallback 1: Electron 内置 Node.js
  if (process.versions && process.versions.node) {
    const version = process.versions.node;
    const meets = compareVersions(version, "22.0.0") >= 0;
    log.info(`[checkNodeVersion] 使用 Electron 内置 Node.js: ${version}`);
    return {
      installed: true,
      version,
      meetsRequirement: meets,
      bundled: true,
    };
  }

  // Fallback 2: 系统 Node.js
  log.info(`[checkNodeVersion] 尝试系统 Node.js...`);
  return new Promise((resolve) => {
    const nodeCmd = isWindows() ? "node.exe" : "node";
    const proc = spawn(nodeCmd, ["--version"], {
      stdio: ["ignore", "pipe", "ignore"],
      shell: isWindows(),
    });

    let stdout = "";
    proc.stdout?.on("data", (data) => {
      stdout += data.toString();
    });

    proc.on("close", (code) => {
      if (code === 0) {
        const version = stdout.trim().replace(/^v/, "");
        const meets = compareVersions(version, "22.0.0") >= 0;
        resolve({
          installed: true,
          version,
          meetsRequirement: meets,
          bundled: false,
          binPath: nodeCmd,
        });
      } else {
        resolve({ installed: false, meetsRequirement: false, bundled: false });
      }
    });

    proc.on("error", () => {
      resolve({ installed: false, meetsRequirement: false, bundled: false });
    });
  });
}

/** 检测指定路径的 node 二进制 */
function _checkNodeBin(binPath: string): Promise<{
  installed: boolean;
  version?: string;
  meetsRequirement: boolean;
}> {
  return new Promise((resolve) => {
    const proc = spawn(binPath, ["--version"], {
      stdio: ["ignore", "pipe", "ignore"],
    });

    let stdout = "";
    proc.stdout?.on("data", (data) => {
      stdout += data.toString();
    });

    proc.on("close", (code) => {
      if (code === 0) {
        const version = stdout.trim().replace(/^v/, "");
        const meets = compareVersions(version, "22.0.0") >= 0;
        resolve({ installed: true, version, meetsRequirement: meets });
      } else {
        resolve({ installed: false, meetsRequirement: false });
      }
    });

    proc.on("error", () => {
      resolve({ installed: false, meetsRequirement: false });
    });
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
  log.info(`[checkUvVersion] 检测 bundled uv: ${bundledPath}`);

  if (fs.existsSync(bundledPath)) {
    log.info(`[checkUvVersion] bundled uv 文件存在，尝试执行: ${bundledPath}`);
    const result = await _checkUvBin(bundledPath);
    log.info(`[checkUvVersion] bundled uv 检测结果:`, result);
    if (result.installed) {
      return { ...result, bundled: true, binPath: bundledPath };
    }
  } else {
    log.warn(`[checkUvVersion] bundled uv 文件不存在: ${bundledPath}`);
  }

  // Fallback 到系统 uv
  log.info(`[checkUvVersion] 尝试系统 uv...`);
  return new Promise((resolve) => {
    const proc = spawn("uv", ["--version"], {
      stdio: ["ignore", "pipe", "ignore"],
    });

    let stdout = "";
    proc.stdout?.on("data", (data) => {
      stdout += data.toString();
    });

    proc.on("close", (code) => {
      if (code === 0) {
        const match = stdout.match(/(\d+\.\d+\.\d+)/);
        const version = match ? match[1] : "unknown";
        const meets = compareVersions(version, "0.5.0") >= 0;
        resolve({
          installed: true,
          version,
          meetsRequirement: meets,
          bundled: false,
          binPath: "uv",
        });
      } else {
        resolve({ installed: false, meetsRequirement: false, bundled: false });
      }
    });

    proc.on("error", () => {
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
    const proc = spawn(binPath, ["--version"], {
      stdio: ["ignore", "pipe", "ignore"],
    });

    let stdout = "";
    proc.stdout?.on("data", (data) => {
      stdout += data.toString();
    });

    proc.on("close", (code) => {
      if (code === 0) {
        const match = stdout.match(/(\d+\.\d+\.\d+)/);
        const version = match ? match[1] : "unknown";
        const meets = compareVersions(version, "0.5.0") >= 0;
        resolve({ installed: true, version, meetsRequirement: meets });
      } else {
        resolve({ installed: false, meetsRequirement: false });
      }
    });

    proc.on("error", () => {
      resolve({ installed: false, meetsRequirement: false });
    });
  });
}

/**
 * 检测 npm 本地包
 */
export async function detectNpmPackage(
  packageName: string,
  binName?: string,
): Promise<{
  installed: boolean;
  version?: string;
  binPath?: string;
}> {
  const nodeModules = getAppNodeModules();
  const packagePath = path.join(nodeModules, packageName, "package.json");

  // 检查是否安装
  if (!fs.existsSync(packagePath)) {
    return { installed: false };
  }

  // 读取版本
  let version: string | undefined;
  try {
    const pkg = JSON.parse(fs.readFileSync(packagePath, "utf-8"));
    version = pkg.version;
  } catch {}

  // 查找可执行文件
  let binPath: string | undefined;
  const searchPaths = [
    path.join(nodeModules, ".bin", binName || packageName),
    path.join(nodeModules, packageName, "bin", binName || packageName),
  ];

  for (const p of searchPaths) {
    if (isWindows()) {
      if (fs.existsSync(p + ".cmd")) {
        binPath = p + ".cmd";
        break;
      }
      if (fs.existsSync(p + ".exe")) {
        binPath = p + ".exe";
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
    const checkCmd = isWindows() ? "where" : "which";
    const proc = spawn(checkCmd, [command], {
      stdio: ["ignore", "pipe", "ignore"],
      shell: isWindows(),
    });

    proc.on("close", (code) => {
      if (code === 0) {
        // 尝试获取版本
        const versionProc = spawn(command, ["--version"], {
          stdio: ["ignore", "pipe", "ignore"],
          shell: isWindows(),
        });

        let stdout = "";
        versionProc.stdout?.on("data", (data) => {
          stdout += data.toString();
        });

        versionProc.on("close", () => {
          const versionMatch = stdout.match(/(\d+\.\d+\.\d+)/);
          resolve({
            installed: true,
            version: versionMatch ? versionMatch[1] : undefined,
            binPath: command,
          });
        });

        versionProc.on("error", () => {
          resolve({ installed: true, binPath: command });
        });
      } else {
        resolve({ installed: false });
      }
    });

    proc.on("error", () => {
      resolve({ installed: false });
    });
  });
}

// ==================== Install Functions ====================

/**
 * 执行一次 npm install
 */
function runNpmInstall(
  packageName: string,
  appDataDir: string,
  options?: { registry?: string; version?: string },
): Promise<{ success: boolean; version?: string; binPath?: string; error?: string }> {
  return new Promise((resolve) => {
    const npmCmd = isWindows() ? "npm.cmd" : "npm";
    const args = ["install", "--save"];

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
      stdio: "pipe",
      shell: isWindows(),
    });

    let stderr = "";
    proc.stderr?.on("data", (data) => {
      stderr += data.toString();
    });

    proc.on("error", (error) => {
      log.error(`[Dependencies] Install error:`, error);
      resolve({ success: false, error: error.message });
    });

    proc.on("close", (code) => {
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
        resolve({ success: false, error: stderr || "Install failed" });
      }
    });
  });
}

/**
 * npm install 串行锁，防止多个并发 npm install 操作互相干扰
 * （syncInitDependencies 和 IPC installPackage 可能同时触发）
 */
let _npmInstallQueue: Promise<unknown> = Promise.resolve();

/**
 * 安装 npm 本地包
 *
 * 所有调用自动排队串行执行，避免并发 npm install 导致 ENOENT/ENOTEMPTY 等竞态错误。
 *
 * ENOTEMPTY 处理：Linux 上 npm install 偶发 rmdir 竞态错误，
 * 遇到时删除该包的 node_modules 子目录后重试一次。
 */
export function installNpmPackage(
  packageName: string,
  options?: {
    registry?: string;
    version?: string;
  },
): Promise<{
  success: boolean;
  version?: string;
  binPath?: string;
  error?: string;
}> {
  const task = _npmInstallQueue.then(() => _installNpmPackageImpl(packageName, options));
  // 无论成功失败都推进队列，防止一个失败阻塞后续
  _npmInstallQueue = task.catch(() => {});
  return task;
}

async function _installNpmPackageImpl(
  packageName: string,
  options?: {
    registry?: string;
    version?: string;
  },
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
  const packageJsonPath = path.join(appDataDir, "package.json");
  if (!fs.existsSync(packageJsonPath)) {
    fs.writeFileSync(
      packageJsonPath,
      JSON.stringify(
        {
          name: APP_NAME_IDENTIFIER,
          version: "1.0.0",
          private: true,
        },
        null,
        2,
      ),
    );
  }

  const result = await runNpmInstall(packageName, appDataDir, options);
  if (result.success) return result;

  // ENOTEMPTY: 删除残留目录后重试一次
  if (result.error && result.error.includes("ENOTEMPTY")) {
    log.warn(`[Dependencies] ${packageName} 遇到 ENOTEMPTY，清理后重试...`);

    // 从错误信息中提取冲突路径并删除（仅限 node_modules 内）
    const match = result.error.match(/ENOTEMPTY[^']*'([^']+)'/);
    const nodeModulesDir = path.join(appDataDir, "node_modules");
    if (match && match[1].startsWith(nodeModulesDir + path.sep)) {
      const conflictDir = match[1];
      try {
        fs.rmSync(conflictDir, { recursive: true, force: true });
        log.info(`[Dependencies] 已清理冲突目录: ${conflictDir}`);
      } catch (e) {
        log.warn(`[Dependencies] 清理冲突目录失败: ${conflictDir}`, e);
      }
    }

    // 同时清理该包自身的 node_modules 残留
    const pkgDir = path.join(appDataDir, "node_modules", packageName);
    try {
      if (fs.existsSync(pkgDir)) {
        fs.rmSync(pkgDir, { recursive: true, force: true });
        log.info(`[Dependencies] 已清理包目录: ${pkgDir}`);
      }
    } catch (e) {
      log.warn(`[Dependencies] 清理包目录失败: ${pkgDir}`, e);
    }

    return runNpmInstall(packageName, appDataDir, options);
  }

  return result;
}

// ==================== Main Service ====================

/**
 * 从 npm registry 查询包的 latest 版本号。
 * 使用 abbreviated metadata（Accept header）减少响应体积。
 * 超时或失败静默返回 null，不影响主流程。
 * scoped 包（@scope/pkg）路径会编码为 @scope%2Fpkg 以符合 registry API。
 */
async function fetchNpmLatestVersion(
  packageName: string,
  timeoutMs = 8_000,
): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const registry = _mirrorConfig.npmRegistry.replace(/\/$/, "");
    // scoped 包需编码：@scope/pkg → @scope%2Fpkg（保留 @，编码 /）
    const pathSegment = packageName.startsWith("@")
      ? "@" + encodeURIComponent(packageName.slice(1))
      : encodeURIComponent(packageName);
    const url = `${registry}/${pathSegment}`;
    const resp = await fetch(url, {
      headers: { Accept: "application/vnd.npm.install-v1+json" },
      signal: controller.signal,
    });
    if (!resp.ok) return null;
    const data = (await resp.json()) as { "dist-tags"?: Record<string, string> };
    return data?.["dist-tags"]?.latest ?? null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 检查所有依赖状态
 * @param options.checkLatest 是否并行查询 npm registry 最新版本（默认 false，仅依赖管理页需要）
 */
export async function checkAllDependencies(
  options?: { checkLatest?: boolean },
): Promise<LocalDependencyItem[]> {
  const results: LocalDependencyItem[] = [];

  for (const dep of SETUP_REQUIRED_DEPENDENCIES) {
    const item: LocalDependencyItem = {
      ...dep,
      status: "checking",
    };

    try {
      switch (dep.name) {
        case "uv": {
          const result = await checkUvVersion();
          item.status = result.installed
            ? result.bundled
              ? "bundled"
              : "installed"
            : "missing";
          item.version = result.version;
          item.meetsRequirement = result.meetsRequirement;
          item.binPath = result.binPath;
          break;
        }
        case "pnpm":
        case "nuwaxcode":
        case "nuwax-file-server":
        case "nuwax-mcp-stdio-proxy":
        case "claude-code-acp-ts": {
          const result = await detectNpmPackage(dep.name, dep.binName);
          item.version = result.version;
          item.binPath = result.binPath;
          if (!result.installed) {
            item.status = "missing";
          } else if (dep.installVersion) {
            // 用户可在依赖 Tab 下手动升级，故以当前已安装的实际版本为准：仅当已装版本低于配置版本时才视为需升级，不降级
            const installed = (result.version ?? "0").replace(/^v/, "");
            const target = dep.installVersion.replace(/^v/, "");
            if (installed === "0" || compareVersions(installed, target) < 0) {
              item.status = "outdated";
            } else {
              item.status = "installed";
            }
          } else {
            item.status = "installed";
          }
          break;
        }
        default: {
          item.status = "missing";
        }
      }
    } catch (error) {
      item.status = "error";
      item.errorMessage = String(error);
    }

    results.push(item);
  }

  // 并行查询已安装的 npm 包的 latest 版本（仅在 checkLatest 时执行）
  // 仅当 registry 返回的 latest 严格大于当前已装版本时才设置 latestVersion，避免展示「更新到更旧版本」
  if (options?.checkLatest) {
    const npmInstalled = results.filter(
      (r) => r.type === "npm-local" && (r.status === "installed" || r.status === "outdated"),
    );
    if (npmInstalled.length > 0) {
      const latestResults = await Promise.all(
        npmInstalled.map((r) => fetchNpmLatestVersion(r.name)),
      );
      for (let i = 0; i < npmInstalled.length; i++) {
        const latest = latestResults[i];
        if (latest == null) continue;
        const installed = (npmInstalled[i].version ?? "").replace(/^v/, "");
        const latestNorm = latest.replace(/^v/, "");
        if (compareVersions(latestNorm, installed) > 0) {
          npmInstalled[i].latestVersion = latest;
        }
      }
    }
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
    const needInstall =
      (dep.status === "missing" && dep.required) ||
      (dep.status === "outdated" && dep.installVersion && dep.type === "npm-local");

    if (!needInstall) continue;

    if (dep.status === "outdated") {
      log.info(`[Dependencies] 按配置版本升级: ${dep.name}@${dep.installVersion}`);
    } else {
      log.info(`[Dependencies] Installing missing: ${dep.name}`);
    }

    if (dep.type === "npm-local") {
      const result = await installNpmPackage(dep.name, dep.installVersion ? { version: dep.installVersion } : undefined);
      results.push({
        name: dep.name,
        success: result.success,
        error: result.error,
      });
    } else {
      results.push({
        name: dep.name,
        success: false,
        error: "System dependency - manual install required",
      });
    }
  }

  // 若有成功安装/升级，更新 .init-deps-state.json，与升级后同步共用同一份状态
  if (results.some((r) => r.success)) {
    const packages: Record<string, string> = {};
    for (const d of SETUP_REQUIRED_DEPENDENCIES) {
      if (d.installVersion) packages[d.name] = d.installVersion;
    }
    setInitDepsState({ appVersion: app.getVersion(), packages });
  }

  const allSuccess = results.every((r) => r.success);
  return { success: allSuccess, results };
}

/**
 * 同步初始化依赖：对带 installVersion 的包，若未安装或已装版本与配置不一致则安装到指定版本，并写回 .init-deps-state.json。
 * 用于客户端升级后按新 installVersion 重新安装已变化的依赖。
 */
export async function syncInitDependencies(): Promise<{ updated: string[] }> {
  const updated: string[] = [];
  const packages: Record<string, string> = {};

  for (const dep of SETUP_REQUIRED_DEPENDENCIES) {
    if (!dep.installVersion || dep.type !== "npm-local") continue;

    const detected = await detectNpmPackage(dep.name, dep.binName);
    // 用户可在依赖 Tab 下手动升级，故以实际已装版本为准：仅当未安装或已装版本低于配置版本时才安装/升级，不降级
    const installedVer = (detected.version ?? "").replace(/^v/, "");
    const targetVer = dep.installVersion.replace(/^v/, "");
    const needInstall =
      !detected.installed ||
      !installedVer ||
      compareVersions(installedVer, targetVer) < 0;

    if (needInstall) {
      log.info(`[Dependencies] syncInitDependencies: 安装/升级 ${dep.name}@${dep.installVersion}`);
      const result = await installNpmPackage(dep.name, { version: dep.installVersion });
      if (result.success) updated.push(dep.name);
      else log.warn(`[Dependencies] syncInitDependencies: ${dep.name} 安装失败`, result.error);
    }
    packages[dep.name] = dep.installVersion;
  }

  setInitDepsState({
    appVersion: app.getVersion(),
    packages,
  });
  if (updated.length > 0) log.info("[Dependencies] syncInitDependencies 已更新:", updated);
  return { updated };
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
 * 简单版本比较（仅支持纯数字 semver，如 1.2.3；不处理 pre-release 标签）
 * 返回: 1 = a > b, 0 = a == b, -1 = a < b
 */
function compareVersions(a: string, b: string): number {
  const aParts = a.split(".").map(Number);
  const bParts = b.split(".").map(Number);

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
  getInitDepsState,
  setInitDepsState,
  syncInitDependencies,
  getAppDataDir,
  getAppBinDir,
  getAppNodeModules,
  getResourcesPath,
  getUvBinPath,
  getLanproxyBinPath,
  getBundledGitBashPath,
  getAppEnv,
  setMirrorConfig,
  getMirrorConfig,
  MIRROR_PRESETS,
};
