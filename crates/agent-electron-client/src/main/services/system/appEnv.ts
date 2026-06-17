/**
 * App 环境变量构建 — getAppEnv() 与镜像源配置
 *
 * 所有 spawned 子进程通过此模块获得统一的隔离环境：
 * - 应用内 node/npm/uv 优先于系统 PATH
 * - 镜像源由运行时配置覆盖
 */

import * as path from "path";
import * as fs from "fs";
import log from "electron-log";
import { NPM_MIRRORS, UV_MIRRORS, DEFAULT_MIRROR_CONFIG } from "../constants";
import { isWindows } from "./shellEnv";
import { getAppDataDir, getAppBinDir } from "./appPaths";
import {
  getUvBinPath,
  ensureUvInAppBin,
  getRipgrepBinPath,
  getTtydBinPath,
  getBundledNodeBinDir,
  getBundledGitBinDir,
  getBundledGitBashPath,
  getElectronNodeBinDir,
  getNuwaxcodeBundledBinPath,
  getCodexAcpBundledBinPath,
} from "./binaryLocator";
import { compareVersions } from "./dependencyUtils";

let appEnvBuildCount = 0;

function nextAppEnvLogLevel(): "info" | "debug" {
  appEnvBuildCount += 1;
  return appEnvBuildCount === 1 ? "info" : "debug";
}

function logAppEnv(
  level: "info" | "debug",
  message: string,
  ...args: unknown[]
): void {
  if (level === "info") {
    log.info(message, ...args);
  } else {
    log.debug(message, ...args);
  }
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

const DEFAULT_MIRROR: MirrorConfig = {
  npmRegistry: DEFAULT_MIRROR_CONFIG.npmRegistry,
  uvIndexUrl: DEFAULT_MIRROR_CONFIG.uvIndexUrl,
};

/** 运行时缓存，避免每次 spawn 都读 SQLite */
let _mirrorConfig: MirrorConfig = { ...DEFAULT_MIRROR };

/** 设置镜像配置（持久化由调用方负责写 settings） */
export function setMirrorConfig(config: Partial<MirrorConfig>): void {
  if (config.npmRegistry !== undefined)
    _mirrorConfig.npmRegistry = config.npmRegistry;
  if (config.uvIndexUrl !== undefined)
    _mirrorConfig.uvIndexUrl = config.uvIndexUrl;
  log.info("[Dependencies] Mirror config updated:", _mirrorConfig);
}

export function getMirrorConfig(): MirrorConfig {
  return { ..._mirrorConfig };
}

// ==================== System PATH ====================

let cachedSystemPaths: string[] | null = null;

function getSystemPaths(): string[] {
  if (cachedSystemPaths) return cachedSystemPaths;

  const systemPath = process.env.PATH || "";
  const pathSep = isWindows() ? ";" : ":";
  const allPaths = systemPath.split(pathSep).filter(Boolean);

  const excludedPatterns = ["/node_modules/", "\\node_modules\\"];

  cachedSystemPaths = allPaths.filter((p) => {
    const normalizedPath = path.normalize(p).toLowerCase();
    return !excludedPatterns.some((pattern) =>
      normalizedPath.includes(pattern.toLowerCase()),
    );
  });

  const fallbackPaths: string[] = [];

  if (process.platform === "darwin") {
    const electronPath = process.execPath.replace(
      /\/Contents\/MacOS\/.*/,
      "/Contents/Frameworks/Electron Framework.framework/Versions/Current/node/bin",
    );
    if (fs.existsSync(electronPath)) fallbackPaths.push(electronPath);

    fallbackPaths.push(
      "/usr/local/bin",
      "/opt/homebrew/bin",
      "/usr/bin",
      "/bin",
    );

    const homeMac = process.env.HOME || "";
    if (homeMac) {
      const localBin = path.join(homeMac, ".local", "bin");
      if (fs.existsSync(localBin)) fallbackPaths.push(localBin);
    }

    const home = process.env.HOME || "";
    if (home) {
      const nvmDir = process.env.NVM_DIR || path.join(home, ".nvm");
      if (fs.existsSync(nvmDir)) {
        const nvmVersionsDir = path.join(nvmDir, "versions", "node");
        if (fs.existsSync(nvmVersionsDir)) {
          const versions = fs
            .readdirSync(nvmVersionsDir)
            .filter((v) => v.startsWith("v"));
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

      const fnmDir = path.join(home, ".fnm");
      if (fs.existsSync(fnmDir)) {
        const fnmNodeDir = path.join(fnmDir, "node-installations");
        if (fs.existsSync(fnmNodeDir)) {
          const versions = fs
            .readdirSync(fnmNodeDir)
            .filter((v) => v.startsWith("v"));
          if (versions.length > 0) {
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
    const homeLinux = process.env.HOME || "";
    if (homeLinux) {
      const localBin = path.join(homeLinux, ".local", "bin");
      if (fs.existsSync(localBin)) fallbackPaths.push(localBin);
    }
    fallbackPaths.push("/usr/local/bin", "/usr/bin", "/bin");
  } else if (isWindows()) {
    const home = process.env.USERPROFILE || process.env.HOME || "";
    const programFiles = process.env.PROGRAMFILES || "C:\\Program Files";
    const programFilesX86 =
      process.env["PROGRAMFILES(X86)"] || "C:\\Program Files (x86)";

    if (home) {
      fallbackPaths.push(path.join(home, "AppData", "Roaming", "npm"));
    }
    fallbackPaths.push(
      path.join(programFiles, "nodejs"),
      path.join(programFilesX86, "nodejs"),
      "C:\\Windows\\system32",
      "C:\\Windows",
    );
  }

  const allSystemPaths = [...cachedSystemPaths];
  for (const fp of fallbackPaths) {
    if (fs.existsSync(fp) && !allSystemPaths.includes(fp)) {
      allSystemPaths.push(fp);
    }
  }

  cachedSystemPaths = allSystemPaths;
  return cachedSystemPaths;
}

// ==================== getAppEnv ====================

export interface GetAppEnvOptions {
  /**
   * 是否包含系统 PATH。
   * - true: 包含（默认，适用于需要访问系统工具的进程）
   * - false: 仅应用内集成路径（适用于 MCP 代理等需要精简环境的进程）
   * @default true
   */
  includeSystemPath?: boolean;
}

export function getAppEnv(opts?: GetAppEnvOptions): Record<string, string> {
  const { includeSystemPath = true } = opts ?? {};

  const appDataDir = getAppDataDir();
  const nodeModulesBin = path.join(appDataDir, "node_modules", ".bin");
  const appBin = getAppBinDir();

  ensureUvInAppBin();
  const uvBinPath = getUvBinPath();
  const uvBin = fs.existsSync(uvBinPath)
    ? path.dirname(uvBinPath)
    : fs.existsSync(path.join(appBin, isWindows() ? "uv.exe" : "uv"))
      ? appBin
      : "";

  const pathSep = isWindows() ? ";" : ":";

  const uvDataDir = path.join(appDataDir, "uv");
  const uvToolBinDir = uvBin ? path.join(uvDataDir, "tools", "bin") : "";

  const npmCacheDir = path.join(appDataDir, "npm-cache");
  const pnpmHome = path.join(appDataDir, "pnpm", "global");

  const mirror = getMirrorConfig();

  const bundledNodeBinDir = getBundledNodeBinDir();
  const bundledGitBinDir = getBundledGitBinDir();
  const bundledGitBashPath = getBundledGitBashPath();
  const electronNodeBinDir = getElectronNodeBinDir();

  const ripgrepBinPath = getRipgrepBinPath();
  const ripgrepBinDir = fs.existsSync(ripgrepBinPath)
    ? path.dirname(ripgrepBinPath)
    : "";

  const ttydBinPath = getTtydBinPath();
  const ttydBinDir = fs.existsSync(ttydBinPath)
    ? path.dirname(ttydBinPath)
    : "";

  const nuwaxcodeBinPath = getNuwaxcodeBundledBinPath();
  const nuwaxcodeBinDir = nuwaxcodeBinPath
    ? path.dirname(nuwaxcodeBinPath)
    : "";

  const codexAcpBinPath = getCodexAcpBundledBinPath();
  const codexAcpBinDir = codexAcpBinPath ? path.dirname(codexAcpBinPath) : "";

  const systemPathPaths = includeSystemPath ? getSystemPaths() : [];

  const priorityPathParts = [
    bundledNodeBinDir,
    electronNodeBinDir,
    bundledGitBinDir,
    ttydBinDir,
    uvBin,
    ripgrepBinDir,
    nuwaxcodeBinDir,
    codexAcpBinDir,
    uvToolBinDir,
    pnpmHome,
    nodeModulesBin,
    appBin,
    ...systemPathPaths,
  ].filter(Boolean);

  const seen = new Set<string>();
  const dedupedParts: string[] = [];
  for (const p of priorityPathParts) {
    const key = isWindows() ? p.toLowerCase() : p;
    if (seen.has(key)) continue;
    seen.add(key);
    dedupedParts.push(p);
  }
  const priorityPath = dedupedParts.join(pathSep);

  const detailLevel = nextAppEnvLogLevel();
  if (detailLevel === "debug") {
    logAppEnv(
      "debug",
      `[getAppEnv] PATH rebuilt (${process.platform}, segments=${dedupedParts.length}, includeSystemPath=${includeSystemPath})`,
    );
  } else {
    logAppEnv("info", `[getAppEnv] PATH priority (${process.platform}):`);
    logAppEnv(
      "info",
      `[getAppEnv]   1. Bundled Node.js 24: ${bundledNodeBinDir || "(not found)"}`,
    );
    logAppEnv(
      "info",
      `[getAppEnv]   2. Electron Node: ${electronNodeBinDir || "(not found)"}`,
    );
    logAppEnv(
      "info",
      `[getAppEnv]   3. Bundled Git: ${bundledGitBinDir || (isWindows() ? "(not found)" : "(macOS/Linux using system)")}`,
    );
    logAppEnv(
      "info",
      `[getAppEnv]   4. uv/uvx (bundled preferred): ${uvBin || "(not found, falling back to system PATH)"}`,
    );
    logAppEnv(
      "info",
      `[getAppEnv]   4.5 ripgrep (bundled): ${ripgrepBinDir || "(not found)"}`,
    );
    logAppEnv("info", `[getAppEnv]   5. node_modules: ${nodeModulesBin}`);
    logAppEnv("info", `[getAppEnv]   6. app bin: ${appBin}`);
    logAppEnv(
      "info",
      `[getAppEnv]   7. System PATH fallback: ${systemPathPaths.slice(0, 3).join(", ")}...`,
    );
    const pathSegments = priorityPath.split(pathSep);
    const uvRelated = pathSegments.filter(
      (p) => p && (p.includes("uv") || p.includes("nuwaclaw")),
    );
    logAppEnv(
      "info",
      `[getAppEnv] uv/uvx trace: uv-related segments in PATH=${uvRelated.length}, top 5=${uvRelated.slice(0, 5).join(" | ") || "(none)"}`,
    );
  }

  const env: Record<string, string | undefined> = {
    PATH: priorityPath,
    NODE_PATH: path.join(appDataDir, "node_modules"),
    NODE_ENV: process.env.NODE_ENV || "production",
    NPM_CONFIG_CACHE: npmCacheDir,
    NPM_CONFIG_PREFIX: appDataDir,
    NPM_CONFIG_REGISTRY: mirror.npmRegistry,
    NPM_CONFIG_USERCONFIG: path.join(appDataDir, ".npmrc"),
    NO_UPDATE_NOTIFIER: "true",
    PNPM_HOME: pnpmHome,
    PNPM_STORE_DIR: path.join(appDataDir, "pnpm", "store"),
    PNPM_CACHE_DIR: path.join(appDataDir, "pnpm", "cache"),
    PNPM_STATE_DIR: path.join(appDataDir, "pnpm", "state"),
    UV_TOOL_DIR: path.join(uvDataDir, "tools"),
    UV_TOOL_BIN_DIR: uvToolBinDir,
    UV_CACHE_DIR: path.join(uvDataDir, "cache"),
    UV_PYTHON_INSTALL_DIR: path.join(uvDataDir, "python"),
    UV_INDEX_URL: mirror.uvIndexUrl,
    UV_NO_INSTALL: "1",
    HOME: process.env.HOME || process.env.USERPROFILE,
    USER: process.env.USER || process.env.USERNAME,
    USERNAME: process.env.USERNAME || process.env.USER,
    LANG: process.env.LANG || "en_US.UTF-8",
    TZ: process.env.TZ,
    ...(isWindows()
      ? { USERPROFILE: process.env.USERPROFILE || process.env.HOME }
      : {}),
  };

  const cleanEnv: Record<string, string> = {};
  for (const [key, val] of Object.entries(env)) {
    if (val !== undefined) cleanEnv[key] = val;
  }

  if (bundledNodeBinDir) {
    cleanEnv.NUWAXCODE_NODE_DIR = bundledNodeBinDir;
    cleanEnv.CLAUDE_CODE_NODE_DIR = bundledNodeBinDir;
  }

  if (bundledGitBashPath) {
    cleanEnv.NUWAXCODE_GIT_BASH_PATH = bundledGitBashPath;
    cleanEnv.CLAUDE_CODE_GIT_BASH_PATH = bundledGitBashPath;
    cleanEnv.MSYS2_PATH_TYPE = "inherit";
  }

  if (bundledGitBinDir) {
    cleanEnv.NUWAXCODE_GIT_BIN_DIR = bundledGitBinDir;
    cleanEnv.CLAUDE_CODE_GIT_BIN_DIR = bundledGitBinDir;
  }

  if (ripgrepBinDir) {
    cleanEnv.NUWAXCODE_RIPGREP_DIR = ripgrepBinDir;
    cleanEnv.CLAUDE_CODE_RIPGREP_DIR = ripgrepBinDir;
  }

  if (isWindows()) {
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
      PATHEXT:
        process.env.PATHEXT ||
        ".COM;.EXE;.BAT;.CMD;.VBS;.VBE;.JS;.JSE;.WSF;.WSH;.MSC",
    };
    for (const [key, value] of Object.entries(windowsCriticalEnvVars)) {
      if (!cleanEnv[key]) {
        cleanEnv[key] = value;
        logAppEnv(
          detailLevel,
          `[getAppEnv] Adding Windows system env var: ${key}=${value}`,
        );
      }
    }

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

    if (includeSystemPath && bundledGitBashPath) {
      const MAX_ORIGINAL_PATH_ENTRIES = 20;
      const pathEntries = (cleanEnv.PATH || "").split(";").filter(Boolean);
      const limitedEntries = pathEntries.slice(0, MAX_ORIGINAL_PATH_ENTRIES);
      const posixPath = limitedEntries
        .map((p) => p.replace(/\\/g, "/"))
        .join(":");
      cleanEnv.ORIGINAL_PATH = posixPath;
      logAppEnv(
        detailLevel,
        `[getAppEnv] Set ORIGINAL_PATH (${limitedEntries.length}/${pathEntries.length} entries)`,
      );
    }

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
          { encoding: "utf-8", timeout: 10000, windowsHide: true },
        );
        const registryPath = result.trim();
        if (registryPath) {
          const registryEntries = registryPath
            .split(";")
            .map((entry: string) => entry.trim())
            .filter(Boolean);
          const MAX_REGISTRY_PATH_ENTRIES = 10;
          const existingPaths = new Set(
            currentPath.split(";").map((p) => p.toLowerCase()),
          );
          const missingEntries: string[] = [];
          for (const entry of registryEntries) {
            if (missingEntries.length >= MAX_REGISTRY_PATH_ENTRIES) {
              logAppEnv(
                detailLevel,
                `[getAppEnv] Registry PATH entry limit reached (${MAX_REGISTRY_PATH_ENTRIES}), skipping remaining entries`,
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
            logAppEnv(
              detailLevel,
              `[getAppEnv] Appended ${missingEntries.length} PATH entries from registry`,
            );
          }
        }
      } catch (error) {
        log.warn(`[getAppEnv] Failed to read registry PATH: ${error}`);
      }
    } else {
      logAppEnv(
        detailLevel,
        `[getAppEnv] Skipping registry PATH read (includeSystemPath=false)`,
      );
    }
  }

  return cleanEnv;
}
