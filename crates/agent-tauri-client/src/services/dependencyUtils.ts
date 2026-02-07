/**
 * 依赖管理共享工具函数
 *
 * 从 DependenciesPage 和 SetupStep3 中提取的共享逻辑
 */

import {
  checkLocalNpmPackage,
  checkShellInstallerPackage,
  installLocalNpmPackage,
  installShellInstallerPackage,
  initLocalNpmEnv,
  autoInstallUv,
  type LocalDependencyItem,
  type InstallResult,
} from "./dependencies";

// ========== 类型定义 ==========

/**
 * 安装单个依赖的结果
 */
export interface InstallSingleResult {
  success: boolean;
  version?: string;
  binPath?: string;
  error?: string;
}

/**
 * 检测单个依赖的结果
 */
export interface CheckResult {
  installed: boolean;
  version?: string;
  binPath?: string;
}

/**
 * 检测并安装的结果
 */
export interface CheckAndInstallResult {
  alreadyInstalled: boolean;
  installed: boolean;
  version?: string;
  binPath?: string;
  error?: string;
}

/**
 * 批量安装的结果
 */
export interface InstallBatchResult {
  success: boolean;
  installed: string[];
  failed?: { name: string; displayName: string; error: string };
}

/**
 * 安装进度回调
 */
export type InstallProgressCallback = (
  current: string,
  index: number,
  total: number
) => void;

// ========== 检测函数 ==========

/**
 * 根据依赖类型检测安装状态
 */
export async function checkDependency(
  dep: LocalDependencyItem
): Promise<CheckResult> {
  const binName = dep.binName || dep.name;

  if (dep.type === "shell-installer") {
    return await checkShellInstallerPackage(binName);
  } else {
    // npm-local (and system dependencies with binaries fall through to npm check)
    return await checkLocalNpmPackage(dep.name);
  }
}

// ========== 安装函数 ==========

/**
 * 安装单个依赖
 *
 * 统一处理 npm-local、npm-global、shell-installer 三种类型
 */
export async function installSingleDependency(
  dep: LocalDependencyItem
): Promise<InstallSingleResult> {
  const { name, type, installerUrl, binName } = dep;

  try {
    let result: InstallResult;

    if (type === "shell-installer") {
      if (name === "uv") {
        // uv 使用专门的安装函数以确保安装到应用本地目录
        result = await autoInstallUv();
      } else {
        if (!installerUrl) {
          return {
            success: false,
            error: `缺少 installerUrl 配置`,
          };
        }
        result = await installShellInstallerPackage(
          installerUrl,
          binName || name
        );
      }
    } else {
      // npm-local
      result = await installLocalNpmPackage(name);
    }

    return {
      success: result.success,
      version: result.version ?? undefined,
      binPath: result.binPath ?? undefined,
      error: result.error ?? undefined,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * 检测后安装依赖
 *
 * 先检测是否已安装，未安装则安装
 */
export async function checkAndInstallDependency(
  dep: LocalDependencyItem
): Promise<CheckAndInstallResult> {
  // 先检测
  const checkResult = await checkDependency(dep);

  if (checkResult.installed) {
    return {
      alreadyInstalled: true,
      installed: true,
      version: checkResult.version,
      binPath: checkResult.binPath,
    };
  }

  // 未安装则安装
  const installResult = await installSingleDependency(dep);

  return {
    alreadyInstalled: false,
    installed: installResult.success,
    version: installResult.version,
    binPath: installResult.binPath,
    error: installResult.error,
  };
}

/**
 * 批量安装依赖
 *
 * @param deps - 要安装的依赖列表
 * @param onProgress - 进度回调
 * @param initNpmEnv - 是否需要初始化 npm 环境（默认 true）
 */
export async function installDependencies(
  deps: LocalDependencyItem[],
  onProgress?: InstallProgressCallback,
  initNpmEnv: boolean = true
): Promise<InstallBatchResult> {
  const installed: string[] = [];

  // 过滤出需要安装的依赖（状态不是 installed）
  const toInstall = deps.filter((d) => d.status !== "installed");

  if (toInstall.length === 0) {
    return { success: true, installed: [] };
  }

  // 初始化 npm 环境（如果有 npm-local 类型的依赖）
  if (initNpmEnv) {
    const hasNpmDeps = toInstall.some((d) => d.type === "npm-local");
    if (hasNpmDeps) {
      try {
        await initLocalNpmEnv();
      } catch (error) {
        return {
          success: false,
          installed: [],
          failed: {
            name: "npm-env",
            displayName: "npm 环境",
            error:
              "初始化 npm 环境失败: " +
              (error instanceof Error ? error.message : String(error)),
          },
        };
      }
    }
  }

  // 依次安装
  for (let i = 0; i < toInstall.length; i++) {
    const dep = toInstall[i];

    // 进度回调
    if (onProgress) {
      onProgress(dep.displayName, i + 1, toInstall.length);
    }

    // 检测后安装
    const result = await checkAndInstallDependency(dep);

    if (result.installed) {
      installed.push(dep.name);
    } else {
      // 安装失败，中断
      return {
        success: false,
        installed,
        failed: {
          name: dep.name,
          displayName: dep.displayName,
          error: result.error || "安装失败",
        },
      };
    }
  }

  return { success: true, installed };
}

// ========== 版本比较 ==========

/**
 * 比较两个 semver 版本号
 *
 * @returns true 表示 latest > current
 */
export function isNewerVersion(current: string, latest: string): boolean {
  const c = current.split(".").map(Number);
  const l = latest.split(".").map(Number);

  for (let i = 0; i < Math.max(c.length, l.length); i++) {
    const cv = c[i] || 0;
    const lv = l[i] || 0;
    if (lv > cv) return true;
    if (lv < cv) return false;
  }

  return false;
}
