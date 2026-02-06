/**
 * 依赖管理服务
 * 通过 Tauri invoke 调用 Rust 后端执行 node 命令检测/安装依赖
 */

import { message } from "antd";
import { invoke } from "@tauri-apps/api/core";

// 依赖状态
export type DependencyStatus =
  | "checking"
  | "installed"
  | "missing"
  | "outdated"
  | "installing"
  | "error";

// 依赖项
export interface DependencyItem {
  name: string;
  displayName: string;
  version?: string;
  source?: string;
  status: DependencyStatus;
  required: boolean;
  description: string;
  installUrl?: string;
}

// 依赖统计
export interface DependencySummary {
  total: number;
  installed: number;
  missing: number;
}

// 模拟数据（后端 API 未就绪时使用）
const mockDependencies: DependencyItem[] = [
  {
    name: "nodejs",
    displayName: "Node.js",
    version: "v18.19.0",
    source: "系统全局",
    status: "installed",
    required: true,
    description: "JavaScript 运行时环境",
  },
  {
    name: "git",
    displayName: "Git",
    version: "v2.39.1",
    source: "Xcode",
    status: "installed",
    required: true,
    description: "版本控制工具",
  },
  {
    name: "npm",
    displayName: "npm",
    version: "v10.2.4",
    source: "系统全局",
    status: "installed",
    required: true,
    description: "Node.js 包管理器",
  },
  {
    name: "python",
    displayName: "Python",
    version: "v3.11.0",
    source: "系统全局",
    status: "installed",
    required: false,
    description: "Python 运行时环境",
  },
  {
    name: "docker",
    displayName: "Docker",
    version: "v24.0.0",
    status: "missing",
    required: false,
    description: "容器运行时",
  },
  {
    name: "rust",
    displayName: "Rust/Cargo",
    version: "v1.72.0",
    status: "installed",
    required: false,
    description: "Rust 工具链",
  },
  {
    name: "curl",
    displayName: "cURL",
    version: "v8.5.0",
    status: "installed",
    required: false,
    description: "HTTP 客户端工具",
  },
  {
    name: "jq",
    displayName: "jq",
    version: "v1.7",
    status: "installed",
    required: false,
    description: "JSON 处理工具",
  },
  {
    name: "pandoc",
    displayName: "Pandoc",
    version: "v3.1.0",
    status: "missing",
    required: false,
    description: "文档转换工具",
  },
  {
    name: "ffmpeg",
    displayName: "FFmpeg",
    version: "v6.0",
    status: "missing",
    required: false,
    description: "多媒体处理工具",
  },
  {
    name: "opencode",
    displayName: "OpenCode",
    status: "installed",
    required: false,
    description: "AI 编程助手",
  },
  {
    name: "@anthropic-ai/claude-code",
    displayName: "Claude Code",
    status: "installed",
    required: false,
    description: "Claude AI 编程助手",
  },
];

// 是否使用后端 API
const USE_BACKEND_API = true;

/**
 * 依赖服务类
 */
class DependencyService {
  private useMockData = !USE_BACKEND_API;

  /**
   * 获取所有依赖
   */
  async getDependencies(): Promise<DependencyItem[]> {
    if (this.useMockData) {
      return this.getMockDependencies();
    }

    try {
      // 调用 Rust 后端
      const deps = await invoke<any[]>("dependency_list");
      return deps.map(this.mapDependencyDto);
    } catch (error) {
      console.error("获取依赖列表失败，使用模拟数据:", error);
      this.useMockData = true;
      return this.getMockDependencies();
    }
  }

  /**
   * 获取依赖统计
   */
  async getSummary(): Promise<DependencySummary> {
    if (this.useMockData) {
      return this.getMockSummary();
    }

    try {
      const summary = await invoke<any>("dependency_summary");
      return {
        total: summary.total,
        installed: summary.installed,
        missing: summary.missing,
      };
    } catch (error) {
      console.error("获取依赖统计失败，使用模拟数据:", error);
      return this.getMockSummary();
    }
  }

  /**
   * 安装依赖
   */
  async installDependency(name: string): Promise<boolean> {
    message.loading(`正在安装 ${name}...`, 0);

    try {
      if (!this.useMockData) {
        await invoke("dependency_install", { name });
      } else {
        // 模拟安装
        await this.delay(2000);
      }

      message.success(`${name} 安装成功！`);
      return true;
    } catch (error: any) {
      message.error(error.message || `${name} 安装失败`);
      return false;
    }
  }

  /**
   * 安装所有缺失依赖
   */
  async installAll(): Promise<boolean> {
    const missing = (await this.getSummary()).missing;
    if (missing === 0) {
      message.info("没有需要安装的依赖");
      return true;
    }

    message.loading(`正在安装 ${missing} 个依赖...`, 0);

    try {
      if (!this.useMockData) {
        await invoke("dependency_install_all");
      } else {
        await this.delay(3000);
      }

      message.success("所有依赖安装完成！");
      return true;
    } catch (error: any) {
      message.error(error.message || "安装失败");
      return false;
    }
  }

  /**
   * 卸载依赖
   */
  async uninstallDependency(name: string): Promise<boolean> {
    message.loading(`正在卸载 ${name}...`, 0);

    try {
      if (!this.useMockData) {
        await invoke("dependency_uninstall", { name });
      } else {
        await this.delay(1500);
      }

      message.success(`${name} 已卸载！`);
      return true;
    } catch (error: any) {
      message.error(error.message || `${name} 卸载失败`);
      return false;
    }
  }

  /**
   * 检查单个依赖
   */
  async checkDependency(name: string): Promise<DependencyItem | null> {
    if (this.useMockData) {
      const deps = await this.getMockDependencies();
      return deps.find((d) => d.name === name) || null;
    }

    try {
      const result = await invoke<any>("dependency_check", { name });
      return result ? this.mapDependencyDto(result) : null;
    } catch (error) {
      console.error("检查依赖失败:", error);
      return null;
    }
  }

  /**
   * 刷新依赖状态
   */
  async refresh(): Promise<DependencyItem[]> {
    message.loading("正在刷新依赖状态...", 0);
    await this.delay(500);
    message.success("依赖状态已刷新");
    return this.getDependencies();
  }

  // ========== Mock 数据方法 ==========

  private async getMockDependencies(): Promise<DependencyItem[]> {
    await this.delay(300);
    return [...mockDependencies];
  }

  private async getMockSummary(): Promise<DependencySummary> {
    const deps = await this.getMockDependencies();
    return {
      total: deps.length,
      installed: deps.filter((d) => d.status === "installed").length,
      missing: deps.filter((d) => d.status === "missing").length,
    };
  }

  private mapDependencyDto(dto: any): DependencyItem {
    const statusMap: Record<string, DependencyStatus> = {
      Ok: "installed",
      Missing: "missing",
      Outdated: "outdated",
      Checking: "checking",
      Installing: "installing",
    };

    return {
      name: dto.name,
      displayName: dto.display_name || dto.name,
      version: dto.version,
      status: statusMap[dto.status] || "installed",
      required: dto.required,
      description: dto.description,
    };
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// 单例导出
export const dependencyService = new DependencyService();

// 便捷函数
export const getDependencies = () => dependencyService.getDependencies();
export const getDependencySummary = () => dependencyService.getSummary();
export const installDependency = (name: string) =>
  dependencyService.installDependency(name);
export const refreshDependencies = () => dependencyService.refresh();
export const installAllDependencies = () => dependencyService.installAll();
export const uninstallDependency = (name: string) =>
  dependencyService.uninstallDependency(name);

// ========== 初始化向导依赖管理 ==========

/**
 * npm 镜像源（国内加速）
 */
export const NPM_REGISTRY = "https://registry.npmmirror.com/";

/**
 * 依赖类型
 */
export type LocalDependencyType = "system" | "npm-local" | "shell-installer";

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
export const SETUP_REQUIRED_DEPENDENCIES: LocalDependencyConfig[] = [
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
    type: "shell-installer",
    description: "高性能 Python 包管理器，用于管理 Python 环境和依赖",
    required: true,
    binName: "uv",
    minVersion: "0.5.0",
    installerUrl: "https://astral.sh/uv/install.sh",
    postInstallHint:
      "可选: 配置 shell 自动补全，详见 https://docs.astral.sh/uv/getting-started/installation/#shell-autocompletion",
  },
  {
    name: "mcp-stdio-proxy",
    displayName: "MCP Proxy",
    type: "npm-local",
    description: "MCP 协议转换代理工具，用于 AI Agent 通信",
    required: true,
    binName: "mcp-proxy",
  },
  {
    name: "nuwax-file-server",
    displayName: "Nuwax File Server",
    type: "npm-local",
    description: "NuWax 文件服务 - AI Agent 文件传输服务",
    required: true,
    binName: "nuwax-file-server",
  },
  {
    name: "nuwaxcode",
    displayName: "NuwaxCode",
    type: "npm-local",
    description: "NuWax VSCode 扩展 - AI 编程助手集成",
    required: true,
    binName: "nuwaxcode",
  },
  {
    name: "claude-code-acp",
    displayName: "Claude Code (ACP)",
    type: "npm-local",
    description: "Claude Code AI 编程助手 (ACP 版本)",
    required: true,
    binName: "claude-code-acp",
  },
];

/**
 * Node.js 版本检测结果
 */
export interface NodeVersionResult {
  installed: boolean;
  version?: string;
  meetsRequirement: boolean;
  nodePath?: string;
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
 * npm 包检测结果
 */
export interface NpmPackageResult {
  installed: boolean;
  version?: string;
  binPath?: string;
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
 * 获取 node_modules 目录路径
 * @returns $APP_DATA_DIR/node_modules
 */
export async function getNodeModulesDir(): Promise<string> {
  const appDir = await getAppDataDir();
  return `${appDir}/node_modules`;
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
 * 自动安装 uv 到应用本地目录
 * @returns 安装结果
 */
export async function autoInstallUv(): Promise<InstallResult> {
  try {
    console.log("[Dependencies] 开始自动安装 uv...");
    const result = await invoke<InstallResult>("uv_auto_install");
    if (result.success) {
      console.log("[Dependencies] uv 自动安装成功:", result);
    } else {
      console.error("[Dependencies] uv 自动安装失败:", result.error);
    }
    return result;
  } catch (error) {
    console.error("[Dependencies] uv 自动安装异常:", error);
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
 * 获取本地安装的包的可执行文件路径
 * @param binName - 可执行文件名
 * @returns 完整路径
 */
export async function getLocalBinPath(binName: string): Promise<string> {
  const appDir = await getAppDataDir();
  return `${appDir}/node_modules/.bin/${binName}`;
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
        }
      } else if (config.type === "npm-local") {
        // npm-local 包
        const pkgResult = await checkLocalNpmPackage(config.name);
        item.status = pkgResult.installed ? "installed" : "missing";
        item.version = pkgResult.version;
        item.binPath = pkgResult.binPath;
      } else if (config.type === "shell-installer") {
        // shell-installer 包
        // uv 需要特殊处理版本检测
        if (config.name === "uv") {
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
        } else {
          // 其他 shell-installer 包
          const binName = config.binName || config.name;
          const shellResult = await checkShellInstallerPackage(binName);
          item.status = shellResult.installed ? "installed" : "missing";
          item.version = shellResult.version;
          item.binPath = shellResult.binPath;
        }
      }
    } catch (error) {
      item.status = "error";
      item.errorMessage = error instanceof Error ? error.message : "检测失败";
    }

    results.push(item);
  }

  return results;
}

/**
 * 安装所有必需的包（npm-local、npm-global 和 shell-installer）
 * @param onProgress - 进度回调
 * @returns 安装结果
 */
export async function installAllRequiredPackages(
  onProgress?: (current: string, index: number, total: number) => void,
): Promise<{ success: boolean; failedPackage?: string; error?: string }> {
  // 获取所有需要安装的依赖（npm-local 和 shell-installer）
  const installablePackages = SETUP_REQUIRED_DEPENDENCIES.filter(
    (d) => d.type === "npm-local" || d.type === "shell-installer",
  );
  const total = installablePackages.length;

  // 初始化 npm 环境（仅用于 npm-local 包）
  const hasNpmLocalPackages = installablePackages.some(
    (d) => d.type === "npm-local",
  );
  if (hasNpmLocalPackages) {
    try {
      await initLocalNpmEnv();
    } catch (error) {
      return {
        success: false,
        error:
          "初始化 npm 环境失败: " +
          (error instanceof Error ? error.message : String(error)),
      };
    }
  }

  // 依次安装
  for (let i = 0; i < installablePackages.length; i++) {
    const pkg = installablePackages[i];

    // 进度回调
    if (onProgress) {
      onProgress(pkg.displayName, i + 1, total);
    }

    if (pkg.type === "npm-local") {
      // 检查是否已安装
      const checkResult = await checkLocalNpmPackage(pkg.name);
      if (checkResult.installed) {
        console.log(`[Dependencies] ${pkg.name} 已安装，跳过`);
        continue;
      }

      // 安装 npm 包
      const installResult = await installLocalNpmPackage(pkg.name);
      if (!installResult.success) {
        return {
          success: false,
          failedPackage: pkg.name,
          error: installResult.error,
        };
      }
    } else if (pkg.type === "shell-installer") {
      // 检查是否已安装
      const binName = pkg.binName || pkg.name;
      const checkResult = await checkShellInstallerPackage(binName);
      if (checkResult.installed) {
        console.log(`[Dependencies] ${pkg.name} (shell) 已安装，跳过`);
        continue;
      }

      // 安装 shell-installer 包
      if (!pkg.installerUrl) {
        return {
          success: false,
          failedPackage: pkg.name,
          error: `缺少 installerUrl 配置`,
        };
      }

      const installResult = await installShellInstallerPackage(
        pkg.installerUrl,
        binName,
      );
      if (!installResult.success) {
        return {
          success: false,
          failedPackage: pkg.name,
          error: installResult.error,
        };
      }
    }
  }

  return { success: true };
}

/**
 * 检查所有必需依赖是否已安装
 * @returns 未安装的依赖列表
 */
export async function checkRequiredDependencies(): Promise<{
  allInstalled: boolean;
  missingDeps: LocalDependencyItem[];
}> {
  const deps = await checkAllSetupDependencies();
  const missingDeps = deps.filter(
    (d) => d.required && d.status !== "installed",
  );
  return {
    allInstalled: missingDeps.length === 0,
    missingDeps,
  };
}

/**
 * 重启所有服务
 * 在启动前会检查必需依赖是否已安装
 */
export async function restartAllServices(): Promise<void> {
  // 检查必需依赖
  const { allInstalled, missingDeps } = await checkRequiredDependencies();

  if (!allInstalled) {
    const missingNames = missingDeps.map((d) => d.displayName).join(", ");
    throw new Error(`缺少必需依赖: ${missingNames}。请先安装所有必需依赖。`);
  }

  try {
    await invoke("services_restart_all");
    console.log("[Dependencies] 服务启动命令已发送");
  } catch (error) {
    console.error("[Dependencies] 重启服务失败:", error);
    throw error;
  }
}

// ========== 服务状态管理 ==========

/**
 * 服务类型枚举
 */
export type ServiceType = "NuwaxFileServer" | "NuwaxLanproxy" | "Rcoder";

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
};

/**
 * 服务图标颜色映射
 */
export const SERVICE_STATE_COLORS: Record<ServiceState, string> = {
  Running: "#52c41a",
  Stopped: "#ff4d4f",
  Starting: "#1890ff",
  Stopping: "#faad14",
  Error: "#ff4d4f",
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
 * 获取依赖安装统计
 */
export async function getSetupDependencySummary(): Promise<{
  total: number;
  installed: number;
  missing: number;
  nodeReady: boolean;
  uvReady: boolean;
  systemDepsReady: boolean;
}> {
  const deps = await checkAllSetupDependencies();
  const nodeDep = deps.find((d) => d.name === "nodejs");
  const uvDep = deps.find((d) => d.name === "uv");

  const nodeReady =
    nodeDep?.status === "installed" && nodeDep?.meetsRequirement === true;
  const uvReady =
    uvDep?.status === "installed" && uvDep?.meetsRequirement === true;

  return {
    total: deps.length,
    installed: deps.filter((d) => d.status === "installed").length,
    missing: deps.filter(
      (d) => d.status === "missing" || d.status === "outdated",
    ).length,
    nodeReady,
    uvReady,
    systemDepsReady: nodeReady && uvReady,
  };
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
