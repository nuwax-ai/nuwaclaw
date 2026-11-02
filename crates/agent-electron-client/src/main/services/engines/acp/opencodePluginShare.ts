/**
 * OpenCode / nuwaxcode 插件依赖共享
 *
 * 问题：XDG_CONFIG_HOME 隔离后，每个 project home 会在
 *   .config/opencode/ 下 npm install @opencode-ai/plugin → ~60MB node_modules
 *
 * 方案：
 *   ~/.nuwaclaw/shared/opencode-plugin/{version}/node_modules  全局一份
 *   project/.config/opencode/node_modules → 链接到上述目录
 *
 * 跨平台链接策略（与 windowsMcp junction 一致）：
 *   - Windows：directory junction（无需管理员 / Developer Mode）
 *   - macOS / Linux：symbolic link (type=dir)
 *   - 链接失败：记录警告并跳过（引擎仍可自行安装，不阻断启动）
 */

import { spawn } from "child_process";
import * as fs from "fs";
import * as path from "path";
import log from "electron-log";
import { getAppDataDir, getResourcesPath } from "../../system/appPaths";
import { getAppEnv } from "../../system/appEnv";
import { isWindows } from "../../system/shellEnv";

const PLUGIN_PACKAGE = "@opencode-ai/plugin";
const SHARED_SEGMENT = "shared";
const OPENCODE_PLUGIN_SEGMENT = "opencode-plugin";

export type EnsureOpencodePluginLinkResult = {
  ok: boolean;
  skipped?: boolean;
  reason?: string;
  version?: string;
  sharedDir?: string;
  linkPath?: string;
  linkType?: "junction" | "dir" | "none";
};

/** 解析插件版本：优先 bundled nuwaxcode .version（与引擎插件版本对齐） */
export function resolveOpencodePluginVersion(): string | null {
  const versionFile = path.join(getResourcesPath(), "nuwaxcode", ".version");
  try {
    if (fs.existsSync(versionFile)) {
      const v = fs.readFileSync(versionFile, "utf-8").trim();
      if (v) return sanitizeVersionSegment(v);
    }
  } catch (err) {
    log.warn("[OpencodePluginShare] Failed to read nuwaxcode .version:", err);
  }
  return null;
}

/** 拒绝路径穿越；版本号一般是 1.17.5，非法字符替换为下划线 */
export function sanitizeVersionSegment(version: string): string {
  const trimmed = version.trim();
  if (!trimmed) return "unknown";
  return trimmed.replace(/[/\\]/g, "_").replace(/\.\./g, "_");
}

export function getSharedOpencodePluginRoot(): string {
  return path.join(getAppDataDir(), SHARED_SEGMENT, OPENCODE_PLUGIN_SEGMENT);
}

export function getSharedOpencodePluginDir(version: string): string {
  return path.join(
    getSharedOpencodePluginRoot(),
    sanitizeVersionSegment(version),
  );
}

function pluginPackageJson(version: string): string {
  return JSON.stringify(
    {
      dependencies: {
        [PLUGIN_PACKAGE]: version,
      },
    },
    null,
    2,
  );
}

function sharedNodeModulesReady(sharedDir: string): boolean {
  const nm = path.join(sharedDir, "node_modules", "@opencode-ai", "plugin");
  return fs.existsSync(nm);
}

function runNpmInstallInDir(
  cwd: string,
  version: string,
): Promise<{ success: boolean; error?: string }> {
  return new Promise((resolve) => {
    const npmCmd = isWindows() ? "npm.cmd" : "npm";
    const args = [
      "install",
      "--omit=dev",
      "--no-fund",
      "--no-audit",
      `${PLUGIN_PACKAGE}@${version}`,
    ];
    const env = { ...process.env, ...getAppEnv() };
    log.info(
      `[OpencodePluginShare] Installing ${PLUGIN_PACKAGE}@${version} into ${cwd}`,
    );
    const proc = spawn(npmCmd, args, {
      cwd,
      env,
      stdio: "pipe",
      shell: isWindows(),
    });
    let stderr = "";
    proc.stderr?.on("data", (d) => {
      stderr += d.toString();
    });
    proc.on("error", (error) => {
      resolve({ success: false, error: error.message });
    });
    proc.on("close", (code) => {
      if (code === 0) resolve({ success: true });
      else
        resolve({
          success: false,
          error: stderr.trim() || `npm install exited ${code}`,
        });
    });
  });
}

/**
 * 确保共享目录已安装指定版本插件（幂等）。
 */
export async function ensureSharedOpencodePlugin(
  version: string,
): Promise<{ ok: boolean; sharedDir: string; error?: string }> {
  const sharedDir = getSharedOpencodePluginDir(version);
  fs.mkdirSync(sharedDir, { recursive: true });

  const pkgPath = path.join(sharedDir, "package.json");
  if (!fs.existsSync(pkgPath)) {
    fs.writeFileSync(pkgPath, pluginPackageJson(version) + "\n", "utf-8");
  }

  if (sharedNodeModulesReady(sharedDir)) {
    return { ok: true, sharedDir };
  }

  // 写明依赖后再 install，便于 npm / 排障查看
  fs.writeFileSync(pkgPath, pluginPackageJson(version) + "\n", "utf-8");
  const install = await runNpmInstallInDir(sharedDir, version);
  if (!install.success) {
    return { ok: false, sharedDir, error: install.error };
  }
  if (!sharedNodeModulesReady(sharedDir)) {
    return {
      ok: false,
      sharedDir,
      error: "npm install finished but plugin package missing",
    };
  }
  return { ok: true, sharedDir };
}

function pathIsSymlinkOrJunction(p: string): boolean {
  try {
    return fs.lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
}

function readLinkTarget(p: string): string | null {
  try {
    if (!pathIsSymlinkOrJunction(p)) return null;
    return fs.readlinkSync(p);
  } catch {
    return null;
  }
}

/**
 * 将 shared node_modules 链接到 isolated home 的 .config/opencode/node_modules。
 * Windows 用 junction，Unix 用 dir symlink。
 */
export function linkSharedOpencodePluginNodeModules(
  isolatedHome: string,
  sharedDir: string,
): EnsureOpencodePluginLinkResult {
  const configDir = path.join(isolatedHome, ".config", "opencode");
  const linkPath = path.join(configDir, "node_modules");
  const sharedNm = path.join(sharedDir, "node_modules");
  const version =
    path.basename(sharedDir) === OPENCODE_PLUGIN_SEGMENT
      ? undefined
      : path.basename(sharedDir);

  if (!fs.existsSync(sharedNm)) {
    return {
      ok: false,
      reason: "shared node_modules missing",
      sharedDir,
      linkPath,
      version,
      linkType: "none",
    };
  }

  fs.mkdirSync(configDir, { recursive: true });

  // 对齐 package.json 版本，便于引擎/人工检查
  if (version) {
    const pkgPath = path.join(configDir, "package.json");
    fs.writeFileSync(pkgPath, pluginPackageJson(version) + "\n", "utf-8");
  }

  // 已指向正确目标则跳过
  const existingTarget = readLinkTarget(linkPath);
  if (existingTarget) {
    const resolvedExisting = path.resolve(configDir, existingTarget);
    const resolvedShared = path.resolve(sharedNm);
    if (
      resolvedExisting === resolvedShared ||
      path.normalize(existingTarget) === path.normalize(sharedNm)
    ) {
      return {
        ok: true,
        skipped: true,
        reason: "already linked",
        sharedDir,
        linkPath,
        version,
        linkType: isWindows() ? "junction" : "dir",
      };
    }
  }

  // 去掉错误链接或实体目录（实体为历史每项目安装残留）
  try {
    if (fs.existsSync(linkPath) || pathIsSymlinkOrJunction(linkPath)) {
      fs.rmSync(linkPath, { recursive: true, force: true });
    }
  } catch (err) {
    log.warn(
      `[OpencodePluginShare] Failed to remove existing node_modules at ${linkPath}:`,
      err,
    );
    return {
      ok: false,
      reason: "cannot replace existing node_modules",
      sharedDir,
      linkPath,
      version,
      linkType: "none",
    };
  }

  const linkType = isWindows() ? "junction" : "dir";
  try {
    // Windows: junction 不要求管理员；目标须为绝对路径
    // Unix: dir symlink
    fs.symlinkSync(sharedNm, linkPath, linkType);
    log.info(
      `[OpencodePluginShare] Linked ${linkPath} -> ${sharedNm} (${linkType})`,
    );
    return {
      ok: true,
      sharedDir,
      linkPath,
      version,
      linkType,
    };
  } catch (err) {
    log.warn(
      `[OpencodePluginShare] ${linkType} link failed, engine may install its own copy:`,
      err,
    );
    return {
      ok: false,
      reason: err instanceof Error ? err.message : String(err),
      sharedDir,
      linkPath,
      version,
      linkType: "none",
    };
  }
}

/**
 * nuwaxcode 启动前：确保共享插件已安装，并链接进 isolated HOME。
 * 失败不抛错，避免阻断引擎启动。
 */
export async function prepareOpencodePluginShareForHome(
  isolatedHome: string,
  versionOverride?: string | null,
): Promise<EnsureOpencodePluginLinkResult> {
  const version = versionOverride || resolveOpencodePluginVersion();
  if (!version) {
    return {
      ok: false,
      skipped: true,
      reason: "nuwaxcode version unknown; skip plugin share",
      linkType: "none",
    };
  }

  try {
    const ensured = await ensureSharedOpencodePlugin(version);
    if (!ensured.ok) {
      log.warn(
        `[OpencodePluginShare] ensure shared plugin failed: ${ensured.error}`,
      );
      return {
        ok: false,
        reason: ensured.error,
        version,
        sharedDir: ensured.sharedDir,
        linkType: "none",
      };
    }
    return linkSharedOpencodePluginNodeModules(isolatedHome, ensured.sharedDir);
  } catch (err) {
    log.warn("[OpencodePluginShare] prepare failed:", err);
    return {
      ok: false,
      reason: err instanceof Error ? err.message : String(err),
      version,
      linkType: "none",
    };
  }
}
