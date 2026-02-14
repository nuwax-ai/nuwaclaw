/**
 * 依赖管理服务
 * 通过 Tauri invoke 调用 Rust 后端执行 node 命令检测/安装依赖
 */

import { invoke } from "@tauri-apps/api/core";
import { setupStorage } from "./store";
import { DEFAULT_MCP_PROXY_CONFIG } from "../constants";

// 依赖状态
export type DependencyStatus =
  | "checking"
  | "installed"
  | "missing"
  | "outdated"
  | "installing"
  | "bundled"
  | "error";

// ========== 初始化向导依赖管理 ==========

/**
 * 依赖类型
 */
export type LocalDependencyType =
  | "system"
  | "npm-local"
  | "npm-global"
  | "shell-installer";

/**
 * 本地依赖配置
 */
export interface LocalDependencyConfig {
  name: string; // 包名
  displayName: string; // 显示名称
  type: LocalDependencyType; // 类型: system=系统依赖, npm-local=本地npm包, shell-installer=shell脚本安装
  description: string; // 描述
  required: boolean; // 是否必需
  minVersion?: string; // 最低版本要求 (仅 system 类型)
  installUrl?: string; // 安装链接 (仅 system 类型)
  binName?: string; // 可执行文件名 (npm-local 和 shell-installer 类型)
  // shell-installer 专用字段
  installerUrl?: string; // shell 安装脚本 URL
  postInstallHint?: string; // 安装后提示信息
}

/**
 * 本地依赖项状态
 */
export interface LocalDependencyItem extends LocalDependencyConfig {
  status: DependencyStatus;
  version?: string; // 已安装版本
  latestVersion?: string; // npm 上的最新版本
  binPath?: string; // 可执行文件完整路径
  errorMessage?: string; // 错误信息
  meetsRequirement?: boolean; // 版本是否满足要求 (仅 system 类型)
}

/**
 * 初始化向导必需依赖配置
 */
const SETUP_REQUIRED_DEPENDENCIES: LocalDependencyConfig[] = [
  {
    name: "nodejs",
    displayName: "Node.js",
    type: "system",
    description: "JavaScript 运行时环境，用于运行 npm 包和服务",
    required: true,
    minVersion: "22.0.0",
    installUrl: "https://nodejs.org",
  },
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
    name: "mcp-stdio-proxy",
    displayName: "MCP 服务",
    type: "npm-local",
    description: "MCP 协议转换工具（应用内安装）",
    required: true,
    minVersion: "0.1.48",
    binName: "mcp-proxy",
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
    name: "claude-code-acp-ts",
    displayName: "ACP 协议",
    type: "npm-local",
    description: "Agent 引擎统一适配服务（应用内安装）",
    required: true,
    binName: "claude-code-acp-ts",
  },
];

/**
 * Node.js 版本检测结果
 */
export interface NodeVersionResult {
  installed: boolean;
  version?: string;
  meetsRequirement: boolean;
}

/**
 * uv 版本检测结果
 */
export interface UvVersionResult {
  installed: boolean;
  version?: string;
  meetsRequirement: boolean;
}

/**
 * Node.js 自动安装结果
 */
export interface NodeInstallResult {
  success: boolean;
  version?: string;
  error?: string;
}

/**
 * uv 自动安装结果
 */
export interface UvInstallResult {
  success: boolean;
  version?: string;
  error?: string;
}

/**
 * npm 包检测结果
 */
export interface NpmPackageResult {
  installed: boolean;
  version?: string;
  binPath?: string;
  /** 是否为应用集成（sidecar），集成包不走动态更新 */
  bundled?: boolean;
}

/**
 * npm 包安装结果
 */
export interface InstallResult {
  success: boolean;
  version?: string;
  binPath?: string;
  error?: string;
}

/**
 * Shell Installer 包检测结果
 */
export interface ShellInstallerResult {
  installed: boolean;
  version?: string;
  binPath?: string;
}

// ========== 本地依赖管理服务 ==========

/**
 * 获取应用数据目录路径
 * @returns 应用数据目录（如 ~/Library/Application Support/com.nuwax.agent）
 */
export async function getAppDataDir(): Promise<string> {
  try {
    return await invoke<string>("app_data_dir_get");
  } catch (error) {
    console.error("[Dependencies] 获取应用数据目录失败:", error);
    throw error;
  }
}

/**
 * 初始化本地 npm 环境
 * 在应用数据目录下创建 package.json
 */
export async function initLocalNpmEnv(): Promise<boolean> {
  try {
    return await invoke<boolean>("dependency_local_env_init");
  } catch (error) {
    console.error("[Dependencies] 初始化 npm 环境失败:", error);
    throw error;
  }
}

/**
 * 检测 Node.js 版本
 * @returns Node.js 版本信息
 */
export async function checkNodeVersion(): Promise<NodeVersionResult> {
  try {
    const result = await invoke<NodeVersionResult>("dependency_node_detect");
    console.log("[Dependencies] Node.js 检测结果:", result);
    return result;
  } catch (error) {
    console.error("[Dependencies] 检测 Node.js 失败:", error);
    return {
      installed: false,
      meetsRequirement: false,
    };
  }
}

/**
 * 自动安装 Node.js（从打包资源复制到应用数据目录）
 * @returns 安装结果
 */
export async function autoInstallNode(): Promise<NodeInstallResult> {
  try {
    console.log("[Dependencies] 开始自动安装 Node.js...");
    const result = await invoke<NodeInstallResult>("node_install_auto");

    if (result.success) {
      console.log("[Dependencies] Node.js 自动安装成功:", result.version);
    } else {
      console.error("[Dependencies] Node.js 自动安装失败:", result.error);
    }

    return result;
  } catch (error) {
    console.error("[Dependencies] 自动安装 Node.js 异常:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * 自动安装 uv（从打包资源复制到本地）
 */
export async function autoInstallUv(): Promise<UvInstallResult> {
  try {
    console.log("[Dependencies] 开始自动安装 uv...");
    const result = await invoke<UvInstallResult>("uv_install_auto");

    if (result.success) {
      console.log("[Dependencies] uv 自动安装成功:", result.version);
    } else {
      console.error("[Dependencies] uv 自动安装失败:", result.error);
    }

    return result;
  } catch (error) {
    console.error("[Dependencies] 自动安装 uv 异常:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * 检测 uv 版本
 * @returns uv 版本信息
 */
export async function checkUvVersion(): Promise<UvVersionResult> {
  try {
    const result = await invoke<UvVersionResult>("dependency_uv_detect");
    console.log("[Dependencies] uv 检测结果:", result);
    return result;
  } catch (error) {
    console.error("[Dependencies] 检测 uv 失败:", error);
    return {
      installed: false,
      meetsRequirement: false,
    };
  }
}

/**
 * 检测本地 npm 包是否已安装
 * @param packageName - 包名
 * @returns 安装状态和版本信息
 */
export async function checkLocalNpmPackage(
  packageName: string,
): Promise<NpmPackageResult> {
  try {
    const result = await invoke<NpmPackageResult>("dependency_local_check", {
      packageName,
    });
    console.log(`[Dependencies] ${packageName} 检测结果:`, result);
    return result;
  } catch (error) {
    console.error(`[Dependencies] 检测 ${packageName} 失败:`, error);
    return {
      installed: false,
    };
  }
}

/**
 * 安装 npm 包到本地目录
 * @param packageName - 包名
 * @returns 安装结果
 */
export async function installLocalNpmPackage(
  packageName: string,
): Promise<InstallResult> {
  try {
    console.log(`[Dependencies] 开始安装 ${packageName}...`);
    const result = await invoke<InstallResult>("dependency_local_install", {
      packageName,
    });

    if (result.success) {
      console.log(`[Dependencies] ${packageName} 安装成功:`, result);
    } else {
      console.error(`[Dependencies] ${packageName} 安装失败:`, result.error);
    }

    return result;
  } catch (error) {
    console.error(`[Dependencies] 安装 ${packageName} 失败:`, error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * 检测 Shell Installer 安装的包是否已安装
 * @param binName - 可执行文件名
 * @returns 安装状态和版本信息
 */
export async function checkShellInstallerPackage(
  binName: string,
): Promise<ShellInstallerResult> {
  try {
    const result = await invoke<ShellInstallerResult>(
      "dependency_shell_installer_check",
      { binName },
    );
    console.log(`[Dependencies] ${binName} (shell) 检测结果:`, result);
    return result;
  } catch (error) {
    console.error(`[Dependencies] 检测 ${binName} (shell) 失败:`, error);
    return {
      installed: false,
    };
  }
}

/**
 * 使用 Shell 脚本安装包
 * @param installerUrl - 安装脚本 URL
 * @param binName - 可执行文件名（用于验证安装）
 * @returns 安装结果
 */
export async function installShellInstallerPackage(
  installerUrl: string,
  binName: string,
): Promise<InstallResult> {
  try {
    console.log(`[Dependencies] 开始通过 shell 脚本安装 ${binName}...`);
    const result = await invoke<InstallResult>(
      "dependency_shell_installer_install",
      { installerUrl, binName },
    );

    if (result.success) {
      console.log(`[Dependencies] ${binName} 安装成功:`, result);
    } else {
      console.error(`[Dependencies] ${binName} 安装失败:`, result.error);
    }

    return result;
  } catch (error) {
    console.error(`[Dependencies] 安装 ${binName} 失败:`, error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * 检测全局 npm 包是否已安装
 * @param binName - 可执行文件名
 * @returns 安装状态和版本信息
 */
export async function checkGlobalNpmPackage(
  binName: string,
): Promise<NpmPackageResult> {
  try {
    const result = await invoke<NpmPackageResult>(
      "dependency_npm_global_check",
      { binName },
    );
    console.log(`[Dependencies] ${binName} (npm global) 检测结果:`, result);
    return result;
  } catch (error) {
    console.error(`[Dependencies] 检测 ${binName} (npm global) 失败:`, error);
    return {
      installed: false,
    };
  }
}

/**
 * 全局安装 npm 包
 * @param packageName - 包名
 * @param binName - 可执行文件名（用于验证安装）
 * @returns 安装结果
 */
export async function installGlobalNpmPackage(
  packageName: string,
  binName: string,
): Promise<InstallResult> {
  try {
    console.log(`[Dependencies] 开始全局安装 npm 包 ${packageName}...`);
    const result = await invoke<InstallResult>(
      "dependency_npm_global_install",
      { packageName, binName },
    );

    if (result.success) {
      console.log(`[Dependencies] ${packageName} 全局安装成功:`, result);
    } else {
      console.error(
        `[Dependencies] ${packageName} 全局安装失败:`,
        result.error,
      );
    }

    return result;
  } catch (error) {
    console.error(`[Dependencies] 全局安装 ${packageName} 失败:`, error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * 检测所有必需依赖状态
 * @returns 依赖状态列表
 */
export async function checkAllSetupDependencies(): Promise<
  LocalDependencyItem[]
> {
  const results: LocalDependencyItem[] = [];

  for (const config of SETUP_REQUIRED_DEPENDENCIES) {
    console.log(
      `[Dependencies] 开始检测: ${config.name} (type: ${config.type})`,
    );
    const item: LocalDependencyItem = {
      ...config,
      status: "checking",
    };

    try {
      if (config.type === "system") {
        // 系统依赖
        if (config.name === "nodejs") {
          // Node.js 检测
          const nodeResult = await checkNodeVersion();
          item.status = nodeResult.installed
            ? nodeResult.meetsRequirement
              ? "installed"
              : "outdated"
            : "missing";
          item.version = nodeResult.version;
          item.meetsRequirement = nodeResult.meetsRequirement;

          if (!nodeResult.meetsRequirement && nodeResult.installed) {
            item.errorMessage = `版本 ${nodeResult.version} 低于要求的 ${config.minVersion}`;
          }
        } else if (config.name === "uv") {
          // uv 检测
          const uvResult = await checkUvVersion();
          item.status = uvResult.installed
            ? uvResult.meetsRequirement
              ? "installed"
              : "outdated"
            : "missing";
          item.version = uvResult.version;
          item.meetsRequirement = uvResult.meetsRequirement;

          if (!uvResult.meetsRequirement && uvResult.installed) {
            item.errorMessage = `版本 ${uvResult.version} 低于要求的 ${config.minVersion}`;
          }
        }
      } else if (config.type === "npm-local") {
        // npm-local 包
        const pkgResult = await checkLocalNpmPackage(config.name);
        item.status = pkgResult.bundled
          ? "bundled"
          : pkgResult.installed
            ? "installed"
            : "missing";
        item.version = pkgResult.version;
        item.binPath = pkgResult.binPath;
      } else if (config.type === "npm-global") {
        // 兼容旧配置：npm-global 也按应用内 npm-local 处理
        const pkgResult = await checkLocalNpmPackage(config.name);
        item.status = pkgResult.bundled
          ? "bundled"
          : pkgResult.installed
            ? "installed"
            : "missing";
        item.version = pkgResult.version;
        item.binPath = pkgResult.binPath;
      } else if (config.type === "shell-installer") {
        // shell-installer 包
        const binName = config.binName || config.name;
        const shellResult = await checkShellInstallerPackage(binName);
        item.status = shellResult.installed ? "installed" : "missing";
        item.version = shellResult.version;
        item.binPath = shellResult.binPath;
      }
    } catch (error) {
      item.status = "error";
      item.errorMessage = error instanceof Error ? error.message : "检测失败";
    }

    results.push(item);
    console.log(
      `[Dependencies] 检测完成: ${config.name} -> ${item.status}`,
      item.version || "",
    );
  }

  console.log(
    `[Dependencies] 全部检测完成, 共 ${results.length} 项:`,
    results.map((r) => `${r.name}:${r.status}`).join(", "),
  );
  return results;
}

/**
 * 检查所有必需依赖是否已安装
 * @returns 未安装的依赖列表
 */
async function checkRequiredDependencies(): Promise<{
  allInstalled: boolean;
  missingDeps: LocalDependencyItem[];
}> {
  const deps = await checkAllSetupDependencies();
  const missingDeps = deps.filter(
    (d) => d.required && d.status !== "installed" && d.status !== "bundled",
  );
  return {
    allInstalled: missingDeps.length === 0,
    missingDeps,
  };
}

/**
 * 重启所有服务
 * 在启动前会检查必需依赖是否已安装，缺失时仅警告不阻塞
 */
export async function restartAllServices(): Promise<void> {
  console.log("[Dependencies] restartAllServices: 开始");
  // 检查必需依赖（仅作为预检警告，不阻塞服务启动）
  try {
    console.log(
      "[Dependencies] restartAllServices: 调用 checkRequiredDependencies",
    );
    const { allInstalled, missingDeps } = await checkRequiredDependencies();
    console.log(
      "[Dependencies] restartAllServices: checkRequiredDependencies 已返回",
    );
    if (!allInstalled) {
      const missingNames = missingDeps.map((d) => d.displayName).join(", ");
      console.warn(
        `[Dependencies] 依赖预检: 缺少 ${missingNames}，仍尝试启动服务`,
      );
    }
  } catch (checkError) {
    console.warn("[Dependencies] 依赖预检失败，仍尝试启动服务:", checkError);
  }

  try {
    // 获取 MCP Proxy 配置，如果没有则使用默认配置
    // 配置只在前端定义一次（constants.ts），避免前后端重复维护
    console.log("[Dependencies] restartAllServices: 获取 MCP Proxy 配置");
    const mcpProxyConfig =
      (await setupStorage.getMcpProxyConfig()) || DEFAULT_MCP_PROXY_CONFIG;
    console.log("[Dependencies] MCP Proxy 配置: 已获取");

    console.log(
      "[Dependencies] restartAllServices: 即将 invoke services_restart_all（若卡住则多半卡在 Rust 侧）",
    );
    await invoke("services_restart_all", {
      mcpProxyConfig: mcpProxyConfig,
    });
    console.log("[Dependencies] 服务启动命令已发送");
  } catch (error) {
    console.error("[Dependencies] 重启服务失败:", error);
    throw error;
  }
  console.log("[Dependencies] restartAllServices: 结束");
}

// ========== 服务状态管理 ==========

/**
 * 服务类型枚举
 */
export type ServiceType =
  | "NuwaxFileServer"
  | "NuwaxLanproxy"
  | "Rcoder"
  | "McpProxy";

/**
 * 服务状态枚举
 */
export type ServiceState =
  | "Stopped"
  | "Running"
  | "Starting"
  | "Stopping"
  | "Error";

/**
 * 服务信息接口
 */
export interface ServiceInfo {
  serviceType: ServiceType;
  state: ServiceState;
  pid?: number;
}

/**
 * 服务显示名称映射
 */
export const SERVICE_DISPLAY_NAMES: Record<ServiceType, string> = {
  NuwaxFileServer: "文件服务",
  NuwaxLanproxy: "代理服务",
  Rcoder: "Agent 服务",
  McpProxy: "MCP 服务",
};

/**
 * 获取所有服务状态
 */
export async function getServicesStatus(): Promise<ServiceInfo[]> {
  try {
    const result = await invoke<
      Array<{ service_type: string; state: string; pid?: number }>
    >("services_status_all");
    console.log("[Services] ========== 获取到服务状态 ==========");

    // 转换后端返回的数据格式
    const services = result.map((item, index) => {
      const service: ServiceInfo = {
        serviceType: item.service_type as ServiceType,
        state: item.state as ServiceState,
        pid: item.pid,
      };
      console.log(
        `[Services] ${index + 1}. ${SERVICE_DISPLAY_NAMES[service.serviceType]}: ${service.state}${service.pid ? ` (PID: ${service.pid})` : ""}`,
      );
      return service;
    });

    const runningCount = services.filter((s) => s.state === "Running").length;
    console.log(`[Services] 运行中: ${runningCount}/${services.length}`);
    console.log("[Services] ======================================");

    return services;
  } catch (error) {
    console.error("[Services] 获取服务状态失败:", error);
    return [];
  }
}

/**
 * 停止所有服务
 */
export async function stopAllServices(): Promise<void> {
  try {
    await invoke("services_stop_all");
    console.log("[Services] 所有服务已停止");
  } catch (error) {
    console.error("[Services] 停止服务失败:", error);
    throw error;
  }
}

/**
 * 查询 npm 包的最新版本号
 */
export async function checkLatestNpmVersion(
  packageName: string,
): Promise<string | null> {
  try {
    const version = await invoke<string | null>(
      "dependency_local_check_latest",
      { packageName },
    );
    return version;
  } catch (error) {
    console.warn(`[Dependencies] 查询 ${packageName} 最新版本失败:`, error);
    return null;
  }
}

/**
 * 比较两个 semver 版本号，返回 true 表示 latest > current
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
