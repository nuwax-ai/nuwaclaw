/**
 * 依赖安装 — npm 本地包的安装与串行队列管理
 */

import * as path from "path";
import * as fs from "fs";
import { spawn } from "child_process";
import log from "electron-log";
import { APP_NAME_IDENTIFIER } from "@shared/constants";
import { isWindows } from "./shellEnv";
import { getAppDataDir } from "./appPaths";
import { getAppEnv } from "./appEnv";
import { detectNpmPackage } from "./dependencyChecker";

function runNpmInstall(
  packageName: string,
  appDataDir: string,
  options?: { registry?: string; version?: string },
): Promise<{
  success: boolean;
  version?: string;
  binPath?: string;
  error?: string;
}> {
  return new Promise((resolve) => {
    const npmCmd = isWindows() ? "npm.cmd" : "npm";
    const args = ["install", "--save"];

    if (options?.version) {
      args.push(`${packageName}@${options.version}`);
    } else {
      args.push(packageName);
    }
    if (options?.registry) args.push(`--registry=${options.registry}`);

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
        detectNpmPackage(packageName)
          .then((result) => {
            log.info(`[Dependencies] ${packageName} installed:`, result);
            resolve({
              success: true,
              version: result.version,
              binPath: result.binPath,
            });
          })
          .catch((err) => {
            log.warn(
              `[Dependencies] ${packageName} post-install detect failed:`,
              err,
            );
            resolve({ success: true });
          });
      } else {
        log.error(`[Dependencies] Install failed:`, stderr);
        resolve({ success: false, error: stderr || "Install failed" });
      }
    });
  });
}

/**
 * npm install 串行锁，防止并发 npm install 互相干扰
 * （syncInitDependencies 和 IPC installPackage 可能同时触发）
 */
let _npmInstallQueue: Promise<unknown> = Promise.resolve();

/**
 * 安装 npm 本地包，所有调用自动排队串行执行。
 *
 * ENOTEMPTY 处理：Linux 上 npm install 偶发 rmdir 竞态错误，
 * 遇到时删除该包的 node_modules 子目录后重试一次。
 */
export function installNpmPackage(
  packageName: string,
  options?: { registry?: string; version?: string },
): Promise<{
  success: boolean;
  version?: string;
  binPath?: string;
  error?: string;
}> {
  const task = _npmInstallQueue.then(() =>
    _installNpmPackageImpl(packageName, options),
  );
  _npmInstallQueue = task.catch(() => {});
  return task;
}

async function _installNpmPackageImpl(
  packageName: string,
  options?: { registry?: string; version?: string },
): Promise<{
  success: boolean;
  version?: string;
  binPath?: string;
  error?: string;
}> {
  const appDataDir = getAppDataDir();

  if (!fs.existsSync(appDataDir)) fs.mkdirSync(appDataDir, { recursive: true });

  const packageJsonPath = path.join(appDataDir, "package.json");
  if (!fs.existsSync(packageJsonPath)) {
    fs.writeFileSync(
      packageJsonPath,
      JSON.stringify(
        { name: APP_NAME_IDENTIFIER, version: "1.0.0", private: true },
        null,
        2,
      ),
    );
  }

  const result = await runNpmInstall(packageName, appDataDir, options);
  if (result.success) return result;

  if (result.error && result.error.includes("ENOTEMPTY")) {
    log.warn(
      `[Dependencies] ${packageName} encountered ENOTEMPTY, cleaning up and retrying...`,
    );
    const match = result.error.match(/ENOTEMPTY[^']*'([^']+)'/);
    const nodeModulesDir = path.join(appDataDir, "node_modules");
    // Normalize both paths to forward slashes for comparison — npm error messages
    // on Windows may use forward slashes regardless of path.sep.
    const normalizedNodeModulesDir = nodeModulesDir.replace(/\\/g, "/");
    if (
      match &&
      match[1].replace(/\\/g, "/").startsWith(normalizedNodeModulesDir + "/")
    ) {
      const conflictDir = match[1];
      try {
        fs.rmSync(conflictDir, { recursive: true, force: true });
        log.info(
          `[Dependencies] Cleaned conflicting directory: ${conflictDir}`,
        );
      } catch (e) {
        log.warn(
          `[Dependencies] Failed to clean conflicting directory: ${conflictDir}`,
          e,
        );
      }
    }
    const pkgDir = path.join(appDataDir, "node_modules", packageName);
    try {
      if (fs.existsSync(pkgDir)) {
        fs.rmSync(pkgDir, { recursive: true, force: true });
        log.info(`[Dependencies] Cleaned package directory: ${pkgDir}`);
      }
    } catch (e) {
      log.warn(
        `[Dependencies] Failed to clean package directory: ${pkgDir}`,
        e,
      );
    }
    return runNpmInstall(packageName, appDataDir, options);
  }

  return result;
}
