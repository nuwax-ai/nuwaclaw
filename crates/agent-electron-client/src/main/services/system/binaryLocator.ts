/**
 * Binary Locator — 各打包二进制文件的路径解析
 *
 * 提供 uv / ripgrep / node / lanproxy / ttyd / nuwaxcode / codex-acp
 * 等预置二进制的路径查找函数，以及 Electron 内置 Node.js 相关辅助。
 */

import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import { execSync } from "child_process";
import log from "electron-log";
import { getAppDataDir, getAppBinDir, getResourcesPath } from "./appPaths";
import { isWindows } from "./shellEnv";

// ==================== Electron 内置 Node.js 路径 ====================

/** 获取 Electron 内置 Node.js 的 bin 目录路径 */
export function getElectronNodeBinDir(): string {
  try {
    const execDir = path.dirname(process.execPath);

    if (isWindows()) {
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
        if (fs.existsSync(p)) return p;
      }
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
      if (fs.existsSync(electronFrameworkPath)) return electronFrameworkPath;
    } else if (process.platform === "darwin") {
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
      if (fs.existsSync(electronFrameworkPath)) return electronFrameworkPath;
    } else {
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
      if (fs.existsSync(electronFrameworkPath)) return electronFrameworkPath;
    }
  } catch (error) {
    log.warn(`[getElectronNodeBinDir] error: ${error}`);
  }
  return "";
}

// ==================== Bundled Node.js ====================

/** 获取 bundled Node.js 24 的 bin 目录 */
export function getBundledNodeBinDir(): string {
  const resourcesPath = getResourcesPath();
  const arch =
    process.arch === "x64" ? "x64" : process.arch === "arm64" ? "arm64" : "x64";
  const nodePlatformKey = `${process.platform}-${arch}`;
  const nodeBinPath = path.join(resourcesPath, "node", nodePlatformKey, "bin");
  if (fs.existsSync(nodeBinPath)) {
    log.info(`[getBundledNodeBinDir] Using bundled Node.js: ${nodeBinPath}`);
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
    log.info(
      `[getBundledNodeBinDir] Dev mode using bundled Node.js: ${devPath}`,
    );
    return devPath;
  }
  return "";
}

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
    log.warn(`[Dependencies] Bundled Node.js not found: ${nodePath}`);
    log.warn(
      '[Dependencies] Run "npm run prepare:node" to download Node.js resources',
    );
    return null;
  }
  return nodePath;
}

export function getNodeBinPathWithFallback(): string | null {
  const bundledPath = getNodeBinPath();
  if (bundledPath) return bundledPath;
  if (!isWindows()) {
    const systemNode = findSystemNode();
    if (systemNode) {
      log.info(`[Dependencies] Using system Node.js fallback: ${systemNode}`);
      return systemNode;
    }
  }
  return null;
}

function findSystemNode(): string | null {
  try {
    const cmd = isWindows() ? "where node" : "which node";
    const result = execSync(cmd, { encoding: "utf-8", timeout: 5000 }).trim();
    const firstLine = result.split("\n")[0].trim();
    if (firstLine && fs.existsSync(firstLine)) return firstLine;
  } catch {
    // node not found in PATH
  }
  return null;
}

// ==================== uv ====================

/** 获取 bundled uv 二进制路径 */
export function getUvBinPath(): string {
  const uvName = isWindows() ? "uv.exe" : "uv";
  return path.join(getResourcesPath(), "uv", "bin", uvName);
}

/**
 * 若 bundled uv 不存在但 resources/uv/bin 有文件，复制到 ~/.nuwaclaw/bin 供子进程使用。
 * 每次 getAppEnv() 调用时触发，幂等。
 */
export function ensureUvInAppBin(): void {
  try {
    const uvBinPath = getUvBinPath();
    if (fs.existsSync(uvBinPath)) return;
    const appBin = getAppBinDir();
    const uvName = isWindows() ? "uv.exe" : "uv";
    const appBinUv = path.join(appBin, uvName);
    if (fs.existsSync(appBinUv)) return;
    const srcBin = path.join(getResourcesPath(), "uv", "bin");
    const srcUv = path.join(srcBin, uvName);
    const srcExists = fs.existsSync(srcUv);
    const srcBinIsDir =
      fs.existsSync(srcBin) && fs.statSync(srcBin).isDirectory();
    log.info(
      `[ensureUvInAppBin] resources/uv/bin: ${srcBin}, uvExists=${srcExists}, isDir=${srcBinIsDir}`,
    );
    if (!srcExists || !srcBinIsDir) return;
    if (!fs.existsSync(appBin)) fs.mkdirSync(appBin, { recursive: true });
    for (const name of fs.readdirSync(srcBin)) {
      const src = path.join(srcBin, name);
      if (fs.statSync(src).isFile()) {
        fs.copyFileSync(src, path.join(appBin, name));
        log.info(`[ensureUvInAppBin] Copied bundled uv: ${name} -> ${appBin}`);
      }
    }
    log.info(`[ensureUvInAppBin] Copy complete, appBin=${appBin}`);
  } catch (e) {
    log.warn("[ensureUvInAppBin] Bundled uv check/copy failed:", e);
  }
}

// ==================== ripgrep ====================

export function getRipgrepBinPath(): string {
  const rgName = isWindows() ? "rg.exe" : "rg";
  return path.join(getResourcesPath(), "ripgrep", "bin", rgName);
}

// ==================== Git ====================

/** 与 prepare-git findPortableGitBash 一致的 bash 候选路径 */
function getBundledGitBashCandidates(resourcesPath: string): string[] {
  return [
    path.join(resourcesPath, "git", "bin", "bash.exe"),
    path.join(resourcesPath, "git", "usr", "bin", "bash.exe"),
    path.join(resourcesPath, "git", "mingw64", "bin", "bash.exe"),
    path.join(resourcesPath, "git", "mingw64", "usr", "bin", "bash.exe"),
  ];
}

/** 获取 bundled Git bin 目录（仅 Windows） */
export function getBundledGitBinDir(): string {
  if (!isWindows()) return "";
  const resourcesPath = getResourcesPath();
  const gitBinCandidates = [
    path.join(resourcesPath, "git", "bin"),
    path.join(resourcesPath, "git", "mingw64", "bin"),
  ];
  for (const gitBinPath of gitBinCandidates) {
    if (fs.existsSync(gitBinPath)) {
      log.info(`[getBundledGitBinDir] Using bundled Git: ${gitBinPath}`);
      return gitBinPath;
    }
  }
  const devCandidates = [
    path.join(process.cwd(), "resources", "git", "bin"),
    path.join(process.cwd(), "resources", "git", "mingw64", "bin"),
  ];
  for (const devPath of devCandidates) {
    if (fs.existsSync(devPath)) {
      log.info(`[getBundledGitBinDir] Dev mode using bundled Git: ${devPath}`);
      return devPath;
    }
  }
  return "";
}

/** 获取 bundled git-bash 路径（仅 Windows，不探测系统 Git for Windows） */
export function getBundledGitBashPath(): string {
  if (!isWindows()) return "";
  const resourcesPath = getResourcesPath();
  for (const p of getBundledGitBashCandidates(resourcesPath)) {
    if (fs.existsSync(p)) {
      log.info(`[getBundledGitBashPath] Using bundled git-bash: ${p}`);
      return p;
    }
  }
  for (const p of getBundledGitBashCandidates(
    path.join(process.cwd(), "resources"),
  )) {
    if (fs.existsSync(p)) {
      log.info(`[getBundledGitBashPath] Dev mode using bundled git-bash: ${p}`);
      return p;
    }
  }
  return "";
}

/** @deprecated 使用 getBundledGitBashPath；仅返回应用包内 bundled Git Bash */
export function resolveGitBashExecutable(): string {
  return getBundledGitBashPath();
}

// ==================== lanproxy ====================

export function getLanproxyBinPath(): string {
  const resourcesPath = getResourcesPath();
  const binariesDir = path.join(resourcesPath, "lanproxy", "binaries");
  const binDir = path.join(resourcesPath, "lanproxy", "bin");

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

  if (binaryName) {
    const binaryPath = path.join(binariesDir, binaryName);
    if (fs.existsSync(binaryPath)) return binaryPath;
  }

  const binName = isWindows() ? "nuwax-lanproxy.exe" : "nuwax-lanproxy";
  const binPath = path.join(binDir, binName);
  if (fs.existsSync(binPath)) return binPath;

  if (isWindows() && fs.existsSync(binariesDir)) {
    try {
      const entries = fs.readdirSync(binariesDir, { withFileTypes: true });
      const exes = entries.filter(
        (e) =>
          e.isFile() &&
          e.name.endsWith(".exe") &&
          e.name.toLowerCase().includes("lanproxy"),
      );
      if (exes.length > 0) {
        const preferArch = process.arch === "x64" ? "x86_64" : "i686";
        const preferred = exes.find((e) => e.name.includes(preferArch));
        const exe = preferred ?? exes[0];
        const found = path.join(binariesDir, exe.name);
        log.info("[getLanproxyBinPath] Using exe found in binaries:", exe.name);
        return found;
      }
    } catch {
      // ignore
    }
  }

  return path.join(binDir, binName);
}

// ==================== ttyd ====================

export function getTtydBinPath(): string {
  const resourcesPath = getResourcesPath();
  const binariesDir = path.join(resourcesPath, "ttyd", "binaries");
  const binDir = path.join(resourcesPath, "ttyd", "bin");
  const exeName = isWindows() ? "ttyd.exe" : "ttyd";
  const platformKey = `${process.platform}-${process.arch}`;
  const binaryPath = path.join(binariesDir, platformKey, exeName);
  if (fs.existsSync(binaryPath)) return binaryPath;
  const binPath = path.join(binDir, exeName);
  if (fs.existsSync(binPath)) return binPath;
  return path.join(binDir, exeName);
}

// ==================== nuwaxcode ====================

export function getNuwaxcodeBundledBinPath(): string | null {
  const platformMap: Record<string, string> = {
    darwin: "darwin",
    linux: "linux",
    win32: "windows",
  };
  const archMap: Record<string, string> = {
    x64: "x64",
    arm64: "arm64",
    arm: "arm",
  };
  const platform = platformMap[os.platform()] || os.platform();
  const arch = archMap[os.arch()] || os.arch();
  const binary = platform === "windows" ? "nuwaxcode.exe" : "nuwaxcode";
  const bundledPath = path.join(
    getResourcesPath(),
    "nuwaxcode",
    `${platform}-${arch}`,
    "bin",
    binary,
  );
  return fs.existsSync(bundledPath) ? bundledPath : null;
}

// ==================== codex-acp ====================

export function getCodexAcpBundledBinPath(): string | null {
  const platformMap: Record<string, string> = {
    darwin: "darwin",
    linux: "linux",
    win32: "windows",
  };
  const archMap: Record<string, string> = {
    x64: "x64",
    arm64: "arm64",
    arm: "arm",
  };
  const platform = platformMap[os.platform()] || os.platform();
  const arch = archMap[os.arch()] || os.arch();
  const binary =
    platform === "windows" ? "nuwax-codex-acp.exe" : "nuwax-codex-acp";
  const bundledPath = path.join(
    getResourcesPath(),
    "codex-acp",
    `${platform}-${arch}`,
    "bin",
    binary,
  );
  return fs.existsSync(bundledPath) ? bundledPath : null;
}

export function getCodexAcpBundledDir(): string | null {
  const bundledDir = path.join(getResourcesPath(), "codex-acp");
  return fs.existsSync(path.join(bundledDir, ".version")) ? bundledDir : null;
}

// ==================== windows-mcp ====================

export function getWindowsMcpBinPath(): string | null {
  if (os.platform() !== "win32") return null;
  const bundledPath = path.join(
    getResourcesPath(),
    "windows-mcp",
    "bin",
    "windows-mcp.exe",
  );
  return fs.existsSync(bundledPath) ? bundledPath : null;
}

// ==================== bundled package dirs ====================

export function getNuwaxFileServerBundledDir(): string | null {
  const bundledDir = path.join(getResourcesPath(), "nuwax-file-server");
  return fs.existsSync(path.join(bundledDir, "package.json"))
    ? bundledDir
    : null;
}

export function getClaudeCodeAcpBundledDir(): string | null {
  const bundledDir = path.join(getResourcesPath(), "claude-code-acp-ts");
  return fs.existsSync(path.join(bundledDir, "package.json"))
    ? bundledDir
    : null;
}
