/**
 * 依赖检测 — 各依赖的安装状态与版本检测
 */

import * as path from "path";
import * as fs from "fs";
import { spawn } from "child_process";
import log from "electron-log";
import { I18N_KEYS } from "@shared/constants";
import { isWindows } from "./shellEnv";
import { getAppNodeModules, getResourcesPath } from "./appPaths";
import {
  getNodeBinPath,
  getUvBinPath,
  getNuwaxcodeBundledBinPath,
  getCodexAcpBundledDir,
  getNuwaxFileServerBundledDir,
  getClaudeCodeAcpBundledDir,
  getRipgrepBinPath,
} from "./binaryLocator";
import { compareVersions } from "./dependencyUtils";
import { t } from "../i18n";

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

// ==================== Required Dependencies ====================

export function getSetupRequiredDependencies(): LocalDependencyConfig[] {
  return [
    {
      name: "uv",
      displayName: t(I18N_KEYS.Pages.Dependencies.DEP_UV),
      type: "bundled",
      description: t(I18N_KEYS.Pages.Dependencies.DESC_UV),
      required: true,
      minVersion: "0.5.0",
      installUrl: "https://docs.astral.sh/uv/getting-started/installation/",
    },
    {
      name: "pnpm",
      displayName: t(I18N_KEYS.Pages.Dependencies.DEP_PNPM),
      type: "npm-local",
      description: t(I18N_KEYS.Pages.Dependencies.DESC_PNPM),
      required: true,
      binName: "pnpm",
      installVersion: "10.30.3",
    },
    {
      name: "nuwax-file-server",
      displayName: t(I18N_KEYS.Pages.Dependencies.DEP_FILE_SERVER),
      type: "bundled",
      description: t(I18N_KEYS.Pages.Dependencies.DESC_FILE_SERVER),
      required: true,
      binName: "nuwax-file-server",
      installVersion: "1.2.4",
    },
    {
      name: "nuwaxcode",
      displayName: t(I18N_KEYS.Pages.Dependencies.DEP_NUWAXCODE),
      type: "bundled",
      description: t(I18N_KEYS.Pages.Dependencies.DESC_NUWAXCODE),
      required: true,
      binName: "nuwaxcode",
      installVersion: "1.3.0-beta.11",
    },
    {
      name: "claude-code-acp-ts",
      displayName: t(I18N_KEYS.Pages.Dependencies.DEP_CLAUDE_CODE_ACP),
      type: "bundled",
      description: t(I18N_KEYS.Pages.Dependencies.DESC_CLAUDE_CODE_ACP),
      required: true,
      binName: "claude-code-acp-ts",
      installVersion: "0.44.0",
    },
    {
      name: "ripgrep",
      displayName: t(I18N_KEYS.Pages.Dependencies.DEP_RIPGREP),
      type: "bundled",
      description: t(I18N_KEYS.Pages.Dependencies.DESC_RIPGREP),
      required: false,
      binName: "rg",
    },
    {
      name: "codex-acp",
      displayName: t(I18N_KEYS.Pages.Dependencies.DEP_CODEX_ACP),
      type: "bundled",
      description: t(I18N_KEYS.Pages.Dependencies.DESC_CODEX_ACP),
      required: true,
      binName: "nuwax-codex-acp",
      installVersion: "0.15.11",
    },
  ];
}

// ==================== Node.js ====================

export async function checkNodeVersion(): Promise<{
  installed: boolean;
  version?: string;
  meetsRequirement: boolean;
  bundled: boolean;
  binPath?: string;
}> {
  const bundledPath = getNodeBinPath();
  log.info(
    `[checkNodeVersion] Checking bundled Node.js: ${bundledPath || "(not found)"}`,
  );

  if (bundledPath && fs.existsSync(bundledPath)) {
    log.info(
      `[checkNodeVersion] Bundled Node.js binary exists, attempting to run: ${bundledPath}`,
    );
    const result = await _checkNodeBin(bundledPath);
    log.info(`[checkNodeVersion] Bundled Node.js check result:`, result);
    if (result.installed)
      return { ...result, bundled: true, binPath: bundledPath };
  }

  if (process.versions && process.versions.node) {
    const version = process.versions.node;
    const meets = compareVersions(version, "22.0.0") >= 0;
    log.info(`[checkNodeVersion] Using Electron bundled Node.js: ${version}`);
    return { installed: true, version, meetsRequirement: meets, bundled: true };
  }

  log.info(`[checkNodeVersion] Trying system Node.js...`);
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
    proc.on("error", () =>
      resolve({ installed: false, meetsRequirement: false, bundled: false }),
    );
  });
}

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
    proc.on("error", () =>
      resolve({ installed: false, meetsRequirement: false }),
    );
  });
}

// ==================== uv ====================

export async function checkUvVersion(): Promise<{
  installed: boolean;
  version?: string;
  meetsRequirement: boolean;
  bundled: boolean;
  binPath?: string;
}> {
  const bundledPath = getUvBinPath();
  log.info(`[checkUvVersion] Checking bundled uv: ${bundledPath}`);

  if (fs.existsSync(bundledPath)) {
    log.info(
      `[checkUvVersion] Bundled uv file exists, attempting to run: ${bundledPath}`,
    );
    const result = await _checkUvBin(bundledPath);
    log.info(`[checkUvVersion] Bundled uv check result:`, result);
    if (result.installed)
      return { ...result, bundled: true, binPath: bundledPath };
  } else {
    log.warn(`[checkUvVersion] Bundled uv file not found: ${bundledPath}`);
  }

  log.info(`[checkUvVersion] Trying system uv...`);
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
    proc.on("error", () =>
      resolve({ installed: false, meetsRequirement: false, bundled: false }),
    );
  });
}

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
    proc.on("error", () =>
      resolve({ installed: false, meetsRequirement: false }),
    );
  });
}

// ==================== Bundled packages ====================

export async function checkMcpProxyBundled(): Promise<{
  available: boolean;
  version?: string;
}> {
  const bundledDir = path.join(getResourcesPath(), "nuwax-mcp-stdio-proxy");
  const pkgPath = path.join(bundledDir, "package.json");
  if (!fs.existsSync(pkgPath)) {
    log.info(
      `[checkMcpProxyBundled] Bundled integration not found: ${pkgPath}`,
    );
    return { available: false };
  }
  try {
    const raw = fs.readFileSync(pkgPath, "utf-8");
    const pkg = JSON.parse(raw) as { version?: string };
    const version = pkg?.version;
    log.info(
      `[checkMcpProxyBundled] Bundled available: ${bundledDir}, version=${version ?? "unknown"}`,
    );
    return { available: true, version };
  } catch (e) {
    log.warn("[checkMcpProxyBundled] Failed to read package.json:", e);
    return { available: true };
  }
}

export async function checkNuwaxcodeBundled(): Promise<{
  available: boolean;
  version?: string;
  binPath?: string;
}> {
  const bundledPath = getNuwaxcodeBundledBinPath();
  if (!bundledPath) {
    log.info("[checkNuwaxcodeBundled] Bundled integration binary not found");
    return { available: false };
  }
  const versionFile = path.join(getResourcesPath(), "nuwaxcode", ".version");
  let version: string | undefined;
  try {
    if (fs.existsSync(versionFile))
      version = fs.readFileSync(versionFile, "utf-8").trim();
  } catch {}
  log.info(
    `[checkNuwaxcodeBundled] Bundled available: ${bundledPath}, version=${version ?? "unknown"}`,
  );
  return { available: true, version, binPath: bundledPath };
}

export async function checkNuwaxFileServerBundled(): Promise<{
  available: boolean;
  version?: string;
}> {
  const bundledDir = getNuwaxFileServerBundledDir();
  if (!bundledDir) {
    log.info("[checkNuwaxFileServerBundled] Bundled not found");
    return { available: false };
  }
  const pkgPath = path.join(bundledDir, "package.json");
  try {
    const raw = fs.readFileSync(pkgPath, "utf-8");
    const pkg = JSON.parse(raw) as { version?: string };
    const version = pkg?.version;
    log.info(
      `[checkNuwaxFileServerBundled] Bundled available: ${bundledDir}, version=${version ?? "unknown"}`,
    );
    return { available: true, version };
  } catch (e) {
    log.warn("[checkNuwaxFileServerBundled] Failed to read package.json:", e);
    return { available: true };
  }
}

export async function checkClaudeCodeAcpBundled(): Promise<{
  available: boolean;
  version?: string;
}> {
  const bundledDir = getClaudeCodeAcpBundledDir();
  if (!bundledDir) {
    log.info("[checkClaudeCodeAcpBundled] Bundled not found");
    return { available: false };
  }
  const pkgPath = path.join(bundledDir, "package.json");
  try {
    const raw = fs.readFileSync(pkgPath, "utf-8");
    const pkg = JSON.parse(raw) as { version?: string };
    const version = pkg?.version;
    log.info(
      `[checkClaudeCodeAcpBundled] Bundled available: ${bundledDir}, version=${version ?? "unknown"}`,
    );
    return { available: true, version };
  } catch (e) {
    log.warn("[checkClaudeCodeAcpBundled] Failed to read package.json:", e);
    return { available: true };
  }
}

export async function checkCodexAcpBundled(): Promise<{
  available: boolean;
  version?: string;
}> {
  const bundledDir = getCodexAcpBundledDir();
  if (!bundledDir) {
    log.info("[checkCodexAcpBundled] Bundled not found");
    return { available: false };
  }
  const versionFile = path.join(bundledDir, ".version");
  try {
    const version = fs.readFileSync(versionFile, "utf-8").trim();
    log.info(
      `[checkCodexAcpBundled] Bundled available: ${bundledDir}, version=${version ?? "unknown"}`,
    );
    return { available: true, version };
  } catch (e) {
    log.warn("[checkCodexAcpBundled] Failed to read .version:", e);
    return { available: true };
  }
}

// ==================== detectNpmPackage / detectShellCommand ====================

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
  if (!fs.existsSync(packagePath)) return { installed: false };

  let version: string | undefined;
  try {
    const pkg = JSON.parse(fs.readFileSync(packagePath, "utf-8"));
    version = pkg.version;
  } catch {}

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

export async function detectShellCommand(command: string): Promise<{
  installed: boolean;
  version?: string;
  binPath?: string;
}> {
  return new Promise((resolve) => {
    const checkCmd = isWindows() ? "where" : "which";
    const proc = spawn(checkCmd, [command], {
      stdio: ["ignore", "pipe", "ignore"],
      shell: isWindows(),
    });
    proc.on("close", (code) => {
      if (code === 0) {
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
        versionProc.on("error", () =>
          resolve({ installed: true, binPath: command }),
        );
      } else {
        resolve({ installed: false });
      }
    });
    proc.on("error", () => resolve({ installed: false }));
  });
}

// Re-export compareVersions so dependencyInstaller/dependencies can import it
// from a single shared location without depending on each other
export { compareVersions } from "./dependencyUtils";
