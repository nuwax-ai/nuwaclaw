/**
 * 依赖管理服务 — Barrel 入口 + 顶层服务函数
 *
 * 所有对外 import 路径保持不变（import from '…/system/dependencies'）。
 * 实现细节分布在各子模块：
 *   - appPaths.ts          路径 getter
 *   - binaryLocator.ts     二进制路径查找
 *   - appEnv.ts            getAppEnv + 镜像源配置
 *   - dependencyChecker.ts  check/detect 检测函数 + 依赖类型定义
 *   - dependencyInstaller.ts installNpmPackage 安装队列
 *   - dependencyUtils.ts   compareVersions
 */

import * as path from "path";
import * as fs from "fs";
import { execFileSync } from "child_process";
import { app } from "electron";
import log from "electron-log";
import {
  getSetupRequiredDependencies,
  detectNpmPackage,
  checkNodeVersion,
  checkUvVersion,
  detectShellCommand,
  type LocalDependencyItem,
} from "./dependencyChecker";
import { installNpmPackage } from "./dependencyInstaller";
import {
  setInitDepsState,
  getInitDepsState,
  getAppDataDir,
  getAppBinDir,
  getAppNodeModules,
  getResourcesPath,
} from "./appPaths";
import {
  getNuwaxcodeBundledBinPath,
  getCodexAcpBundledDir,
  getNuwaxFileServerBundledDir,
  getClaudeCodeAcpBundledDir,
  getRipgrepBinPath,
  getUvBinPath,
  getLanproxyBinPath,
  getBundledGitBashPath,
} from "./binaryLocator";
import {
  getAppEnv,
  setMirrorConfig,
  getMirrorConfig,
  MIRROR_PRESETS,
} from "./appEnv";
import { compareVersions } from "./dependencyUtils";

// ==================== Barrel re-exports ====================
// 所有子模块公共 API 经此 barrel 统一对外暴露

export type {
  DependencyStatus,
  LocalDependencyType,
  LocalDependencyConfig,
  LocalDependencyItem,
} from "./dependencyChecker";

export {
  getSetupRequiredDependencies,
  checkNodeVersion,
  checkUvVersion,
  checkMcpProxyBundled,
  checkNuwaxcodeBundled,
  checkNuwaxFileServerBundled,
  checkClaudeCodeAcpBundled,
  checkCodexAcpBundled,
  detectNpmPackage,
  detectShellCommand,
} from "./dependencyChecker";

export { installNpmPackage } from "./dependencyInstaller";

export {
  getInitDepsState,
  setInitDepsState,
  getAppDataDir,
  getAppBinDir,
  getAppNodeModules,
  getResourcesPath,
  type InitDepsState,
} from "./appPaths";

export {
  getUvBinPath,
  getRipgrepBinPath,
  getNodeBinPath,
  getNodeBinPathWithFallback,
  getLanproxyBinPath,
  getTtydBinPath,
  getNuwaxcodeBundledBinPath,
  getCodexAcpBundledBinPath,
  getCodexAcpBundledDir,
  getWindowsMcpBinPath,
  getBundledGitBashPath,
  getNuwaxFileServerBundledDir,
  getClaudeCodeAcpBundledDir,
} from "./binaryLocator";

export {
  MIRROR_PRESETS,
  setMirrorConfig,
  getMirrorConfig,
  getAppEnv,
  type MirrorConfig,
  type GetAppEnvOptions,
} from "./appEnv";

// ==================== Top-level service functions ====================

async function fetchNpmLatestVersion(
  packageName: string,
  timeoutMs = 8_000,
): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const registry = getMirrorConfig().npmRegistry.replace(/\/$/, "");
    const pathSegment = packageName.startsWith("@")
      ? "@" + encodeURIComponent(packageName.slice(1))
      : encodeURIComponent(packageName);
    const url = `${registry}/${pathSegment}`;
    const resp = await fetch(url, {
      headers: { Accept: "application/vnd.npm.install-v1+json" },
      signal: controller.signal,
    });
    if (!resp.ok) return null;
    const data = (await resp.json()) as {
      "dist-tags"?: Record<string, string>;
    };
    return data?.["dist-tags"]?.latest ?? null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function checkAllDependencies(options?: {
  checkLatest?: boolean;
}): Promise<LocalDependencyItem[]> {
  const results: LocalDependencyItem[] = [];

  for (const dep of getSetupRequiredDependencies()) {
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
        case "nuwaxcode": {
          const bundledPath = getNuwaxcodeBundledBinPath();
          if (bundledPath) {
            item.status = "installed";
            item.binPath = bundledPath;
            item.version = dep.installVersion;
            log.info(
              "[checkAllDependencies] nuwaxcode: using bundled binary:",
              bundledPath,
            );
          } else {
            item.status = "missing";
            log.warn(
              "[checkAllDependencies] nuwaxcode: bundled binary not found",
            );
          }
          break;
        }
        case "pnpm": {
          const result = await detectNpmPackage(dep.name, dep.binName);
          item.version = result.version;
          item.binPath = result.binPath;
          if (!result.installed) {
            item.status = "missing";
          } else if (dep.installVersion) {
            const installed = (result.version ?? "0").replace(/^v/, "");
            const target = dep.installVersion.replace(/^v/, "");
            item.status =
              installed === "0" || compareVersions(installed, target) < 0
                ? "outdated"
                : "installed";
          } else {
            item.status = "installed";
          }
          break;
        }
        case "nuwax-file-server": {
          const bundledDir = getNuwaxFileServerBundledDir();
          if (bundledDir) {
            const pkgPath = path.join(bundledDir, "package.json");
            try {
              const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
              item.status = "bundled";
              item.version = pkg.version;
              item.binPath = bundledDir;
            } catch {
              item.status = "missing";
            }
          } else {
            item.status = "missing";
          }
          break;
        }
        case "claude-code-acp-ts": {
          const bundledDir = getClaudeCodeAcpBundledDir();
          if (bundledDir) {
            const pkgPath = path.join(bundledDir, "package.json");
            try {
              const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
              item.status = "bundled";
              item.version = pkg.version;
              item.binPath = bundledDir;
            } catch {
              item.status = "missing";
            }
          } else {
            item.status = "missing";
          }
          break;
        }
        case "codex-acp": {
          const bundledDir = getCodexAcpBundledDir();
          if (bundledDir) {
            const versionFile = path.join(bundledDir, ".version");
            try {
              const version = fs.readFileSync(versionFile, "utf-8").trim();
              item.status = "bundled";
              item.version = version;
              item.binPath = bundledDir;
            } catch {
              item.status = "bundled";
            }
          } else {
            item.status = "missing";
          }
          break;
        }
        case "ripgrep": {
          const rgPath = getRipgrepBinPath();
          if (fs.existsSync(rgPath)) {
            item.status = "bundled";
            item.binPath = rgPath;
            try {
              const ver = execFileSync(rgPath, ["--version"], {
                encoding: "utf-8",
                timeout: 5000,
              }).trim();
              item.version =
                ver.split("\n")[0].replace(/^ripgrep\s+/, "") || "unknown";
            } catch {
              item.version = "unknown";
            }
          } else {
            item.status = "missing";
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

  if (options?.checkLatest) {
    const npmInstalled = results.filter(
      (r) =>
        r.type === "npm-local" &&
        (r.status === "installed" || r.status === "outdated"),
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

export async function installMissingDependencies(): Promise<{
  success: boolean;
  results: Array<{ name: string; success: boolean; error?: string }>;
}> {
  const results: Array<{ name: string; success: boolean; error?: string }> = [];
  const deps = await checkAllDependencies();

  for (const dep of deps) {
    const needInstall =
      (dep.status === "missing" && dep.required) ||
      (dep.status === "outdated" &&
        dep.installVersion &&
        dep.type === "npm-local");

    if (!needInstall) continue;

    if (dep.status === "outdated") {
      log.info(
        `[Dependencies] Upgrading to configured version: ${dep.name}@${dep.installVersion}`,
      );
    } else {
      log.info(`[Dependencies] Installing missing: ${dep.name}`);
    }

    if (dep.type === "npm-local") {
      const result = await installNpmPackage(
        dep.name,
        dep.installVersion ? { version: dep.installVersion } : undefined,
      );
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

  if (results.some((r) => r.success)) {
    const packages: Record<string, string> = {};
    for (const d of getSetupRequiredDependencies()) {
      if (d.installVersion) packages[d.name] = d.installVersion;
    }
    setInitDepsState({ appVersion: app.getVersion(), packages });
  }

  return { success: results.every((r) => r.success), results };
}

export async function syncInitDependencies(): Promise<{ updated: string[] }> {
  const updated: string[] = [];
  const packages: Record<string, string> = {};

  for (const dep of getSetupRequiredDependencies()) {
    if (!dep.installVersion || dep.type !== "npm-local") continue;

    const detected = await detectNpmPackage(dep.name, dep.binName);
    const installedVer = (detected.version ?? "").replace(/^v/, "");
    const targetVer = dep.installVersion.replace(/^v/, "");
    const needInstall =
      !detected.installed ||
      !installedVer ||
      compareVersions(installedVer, targetVer) < 0;

    if (needInstall) {
      log.info(
        `[Dependencies] syncInitDependencies: installing/upgrading ${dep.name}@${dep.installVersion}`,
      );
      const result = await installNpmPackage(dep.name, {
        version: dep.installVersion,
      });
      if (result.success) updated.push(dep.name);
      else
        log.warn(
          `[Dependencies] syncInitDependencies: ${dep.name} install failed`,
          result.error,
        );
    }
    packages[dep.name] = dep.installVersion;
  }

  setInitDepsState({ appVersion: app.getVersion(), packages });
  if (updated.length > 0)
    log.info("[Dependencies] syncInitDependencies updated:", updated);
  return { updated };
}

export function getDependenciesSummary(): {
  total: number;
  installed: number;
  missing: number;
  missingRequired: string[];
} {
  return {
    total: getSetupRequiredDependencies().length,
    installed: 0,
    missing: 0,
    missingRequired: [],
  };
}

// ==================== default export (backwards compat) ====================

export default {
  getSetupRequiredDependencies,
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
  getNuwaxFileServerBundledDir,
  getClaudeCodeAcpBundledDir,
  getCodexAcpBundledDir,
};
