/**
 * 依赖管理服务
 * 通过 Tauri invoke 调用 Rust 后端执行 node 命令检测/安装依赖
 */

import { message } from 'antd';
import { invoke } from '@tauri-apps/api/core';

// 依赖状态
export type DependencyStatus = 'checking' | 'installed' | 'missing' | 'outdated' | 'installing' | 'error';

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
    name: 'nodejs',
    displayName: 'Node.js',
    version: 'v18.19.0',
    source: '系统全局',
    status: 'installed',
    required: true,
    description: 'JavaScript 运行时环境',
  },
  {
    name: 'git',
    displayName: 'Git',
    version: 'v2.39.1',
    source: 'Xcode',
    status: 'installed',
    required: true,
    description: '版本控制工具',
  },
  {
    name: 'npm',
    displayName: 'npm',
    version: 'v10.2.4',
    source: '系统全局',
    status: 'installed',
    required: true,
    description: 'Node.js 包管理器',
  },
  {
    name: 'python',
    displayName: 'Python',
    version: 'v3.11.0',
    source: '系统全局',
    status: 'installed',
    required: false,
    description: 'Python 运行时环境',
  },
  {
    name: 'docker',
    displayName: 'Docker',
    version: 'v24.0.0',
    status: 'missing',
    required: false,
    description: '容器运行时',
  },
  {
    name: 'rust',
    displayName: 'Rust/Cargo',
    version: 'v1.72.0',
    status: 'installed',
    required: false,
    description: 'Rust 工具链',
  },
  {
    name: 'curl',
    displayName: 'cURL',
    version: 'v8.5.0',
    status: 'installed',
    required: false,
    description: 'HTTP 客户端工具',
  },
  {
    name: 'jq',
    displayName: 'jq',
    version: 'v1.7',
    status: 'installed',
    required: false,
    description: 'JSON 处理工具',
  },
  {
    name: 'pandoc',
    displayName: 'Pandoc',
    version: 'v3.1.0',
    status: 'missing',
    required: false,
    description: '文档转换工具',
  },
  {
    name: 'ffmpeg',
    displayName: 'FFmpeg',
    version: 'v6.0',
    status: 'missing',
    required: false,
    description: '多媒体处理工具',
  },
  {
    name: 'opencode',
    displayName: 'OpenCode',
    status: 'installed',
    required: false,
    description: 'AI 编程助手',
  },
  {
    name: '@anthropic-ai/claude-code',
    displayName: 'Claude Code',
    status: 'installed',
    required: false,
    description: 'Claude AI 编程助手',
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
      const deps = await invoke<any[]>('get_dependencies');
      return deps.map(this.mapDependencyDto);
    } catch (error) {
      console.error('获取依赖列表失败，使用模拟数据:', error);
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
      const summary = await invoke<any>('get_dependency_summary');
      return {
        total: summary.total,
        installed: summary.installed,
        missing: summary.missing,
      };
    } catch (error) {
      console.error('获取依赖统计失败，使用模拟数据:', error);
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
        await invoke('install_dependency', { name });
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
      message.info('没有需要安装的依赖');
      return true;
    }

    message.loading(`正在安装 ${missing} 个依赖...`, 0);

    try {
      if (!this.useMockData) {
        await invoke('install_all_dependencies');
      } else {
        await this.delay(3000);
      }

      message.success('所有依赖安装完成！');
      return true;
    } catch (error: any) {
      message.error(error.message || '安装失败');
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
        await invoke('uninstall_dependency', { name });
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
      return deps.find(d => d.name === name) || null;
    }

    try {
      const result = await invoke<any>('check_dependency', { name });
      return result ? this.mapDependencyDto(result) : null;
    } catch (error) {
      console.error('检查依赖失败:', error);
      return null;
    }
  }

  /**
   * 刷新依赖状态
   */
  async refresh(): Promise<DependencyItem[]> {
    message.loading('正在刷新依赖状态...', 0);
    await this.delay(500);
    message.success('依赖状态已刷新');
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
      installed: deps.filter(d => d.status === 'installed').length,
      missing: deps.filter(d => d.status === 'missing').length,
    };
  }

  private mapDependencyDto(dto: any): DependencyItem {
    const statusMap: Record<string, DependencyStatus> = {
      'Ok': 'installed',
      'Missing': 'missing',
      'Outdated': 'outdated',
      'Checking': 'checking',
      'Installing': 'installing',
    };

    return {
      name: dto.name,
      displayName: dto.display_name || dto.name,
      version: dto.version,
      status: statusMap[dto.status] || 'installed',
      required: dto.required,
      description: dto.description,
    };
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// 单例导出
export const dependencyService = new DependencyService();

// 便捷函数
export const getDependencies = () => dependencyService.getDependencies();
export const getDependencySummary = () => dependencyService.getSummary();
export const installDependency = (name: string) => dependencyService.installDependency(name);
export const refreshDependencies = () => dependencyService.refresh();
export const installAllDependencies = () => dependencyService.installAll();
export const uninstallDependency = (name: string) => dependencyService.uninstallDependency(name);

// ========== 初始化向导依赖管理 ==========

/**
 * npm 镜像源（国内加速）
 */
export const NPM_REGISTRY = 'https://registry.npmmirror.com/';

/**
 * 依赖类型
 */
export type LocalDependencyType = 'system' | 'npm-local';

/**
 * 本地依赖配置
 */
export interface LocalDependencyConfig {
  name: string;              // 包名
  displayName: string;       // 显示名称
  type: LocalDependencyType; // 类型: system=系统依赖, npm-local=本地npm包
  description: string;       // 描述
  required: boolean;         // 是否必需
  minVersion?: string;       // 最低版本要求 (仅 system 类型)
  installUrl?: string;       // 安装链接 (仅 system 类型)
  binName?: string;          // 可执行文件名 (仅 npm-local 类型)
}

/**
 * 本地依赖项状态
 */
export interface LocalDependencyItem extends LocalDependencyConfig {
  status: DependencyStatus;
  version?: string;          // 已安装版本
  binPath?: string;          // 可执行文件完整路径
  errorMessage?: string;     // 错误信息
  meetsRequirement?: boolean; // 版本是否满足要求 (仅 system 类型)
}

/**
 * 初始化向导必需依赖配置
 */
export const SETUP_REQUIRED_DEPENDENCIES: LocalDependencyConfig[] = [
  {
    name: 'nodejs',
    displayName: 'Node.js',
    type: 'system',
    description: 'JavaScript 运行时环境，用于运行 npm 包和服务',
    required: true,
    minVersion: '22.0.0',
    installUrl: 'https://nodejs.org',
  },
  {
    name: 'uv',
    displayName: 'uv',
    type: 'system',
    description: '高性能 Python 包管理器，用于管理 Python 环境和依赖',
    required: true,
    minVersion: '0.5.0',
    installUrl: 'https://docs.astral.sh/uv/getting-started/installation/',
  },
  {
    name: 'nuwax-file-server',
    displayName: 'Nuwax File Server',
    type: 'npm-local',
    description: 'NuWax 文件服务 - AI Agent 文件传输服务',
    required: true,
    binName: 'nuwax-file-server',
  },
  {
    name: 'nuwaxcode',
    displayName: 'NuwaxCode',
    type: 'npm-local',
    description: 'NuWax VSCode 扩展 - AI 编程助手集成',
    required: true,
    binName: 'nuwaxcode',
  },
  {
    name: 'claude-code-acp',
    displayName: 'Claude Code (ACP)',
    type: 'npm-local',
    description: 'Claude Code AI 编程助手 (ACP 版本)',
    required: true,
    binName: 'claude-code-acp',
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

// ========== 本地依赖管理服务 ==========

/**
 * 获取应用数据目录路径
 * @returns 应用数据目录（如 ~/Library/Application Support/com.nuwax.agent）
 */
export async function getAppDataDir(): Promise<string> {
  try {
    return await invoke<string>('get_app_data_dir');
  } catch (error) {
    console.error('[Dependencies] 获取应用数据目录失败:', error);
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
    return await invoke<boolean>('init_local_npm_env');
  } catch (error) {
    console.error('[Dependencies] 初始化 npm 环境失败:', error);
    throw error;
  }
}

/**
 * 检测 Node.js 版本
 * @returns Node.js 版本信息
 */
export async function checkNodeVersion(): Promise<NodeVersionResult> {
  try {
    const result = await invoke<NodeVersionResult>('detect_node_version');
    console.log('[Dependencies] Node.js 检测结果:', result);
    return result;
  } catch (error) {
    console.error('[Dependencies] 检测 Node.js 失败:', error);
    return {
      installed: false,
      meetsRequirement: false,
    };
  }
}

/**
 * 检测 uv 版本
 * @returns uv 版本信息
 */
export async function checkUvVersion(): Promise<UvVersionResult> {
  try {
    const result = await invoke<UvVersionResult>('detect_uv_version');
    console.log('[Dependencies] uv 检测结果:', result);
    return result;
  } catch (error) {
    console.error('[Dependencies] 检测 uv 失败:', error);
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
export async function checkLocalNpmPackage(packageName: string): Promise<NpmPackageResult> {
  try {
    const result = await invoke<NpmPackageResult>('check_local_npm_package', { packageName });
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
export async function installLocalNpmPackage(packageName: string): Promise<InstallResult> {
  try {
    console.log(`[Dependencies] 开始安装 ${packageName}...`);
    const result = await invoke<InstallResult>('install_local_npm_package', { packageName });
    
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
 * 检测所有必需依赖状态
 * @returns 依赖状态列表
 */
export async function checkAllSetupDependencies(): Promise<LocalDependencyItem[]> {
  const results: LocalDependencyItem[] = [];
  
  for (const config of SETUP_REQUIRED_DEPENDENCIES) {
    const item: LocalDependencyItem = {
      ...config,
      status: 'checking',
    };
    
    try {
      if (config.type === 'system') {
        // 系统依赖
        if (config.name === 'nodejs') {
          // Node.js 检测
          const nodeResult = await checkNodeVersion();
          item.status = nodeResult.installed
            ? (nodeResult.meetsRequirement ? 'installed' : 'outdated')
            : 'missing';
          item.version = nodeResult.version;
          item.meetsRequirement = nodeResult.meetsRequirement;
          
          if (!nodeResult.meetsRequirement && nodeResult.installed) {
            item.errorMessage = `版本 ${nodeResult.version} 低于要求的 ${config.minVersion}`;
          }
        } else if (config.name === 'uv') {
          // uv 检测
          const uvResult = await checkUvVersion();
          item.status = uvResult.installed
            ? (uvResult.meetsRequirement ? 'installed' : 'outdated')
            : 'missing';
          item.version = uvResult.version;
          item.meetsRequirement = uvResult.meetsRequirement;
          
          if (!uvResult.meetsRequirement && uvResult.installed) {
            item.errorMessage = `版本 ${uvResult.version} 低于要求的 ${config.minVersion}`;
          }
        }
      } else {
        // npm-local 包
        const pkgResult = await checkLocalNpmPackage(config.name);
        item.status = pkgResult.installed ? 'installed' : 'missing';
        item.version = pkgResult.version;
        item.binPath = pkgResult.binPath;
      }
    } catch (error) {
      item.status = 'error';
      item.errorMessage = error instanceof Error ? error.message : '检测失败';
    }
    
    results.push(item);
  }
  
  return results;
}

/**
 * 安装所有必需的 npm 包
 * @param onProgress - 进度回调
 * @returns 安装结果
 */
export async function installAllRequiredPackages(
  onProgress?: (current: string, index: number, total: number) => void
): Promise<{ success: boolean; failedPackage?: string; error?: string }> {
  // 获取所有 npm-local 类型的依赖
  const npmPackages = SETUP_REQUIRED_DEPENDENCIES.filter(d => d.type === 'npm-local');
  const total = npmPackages.length;
  
  // 初始化 npm 环境
  try {
    await initLocalNpmEnv();
  } catch (error) {
    return {
      success: false,
      error: '初始化 npm 环境失败: ' + (error instanceof Error ? error.message : String(error)),
    };
  }
  
  // 依次安装
  for (let i = 0; i < npmPackages.length; i++) {
    const pkg = npmPackages[i];
    
    // 进度回调
    if (onProgress) {
      onProgress(pkg.displayName, i + 1, total);
    }
    
    // 检查是否已安装
    const checkResult = await checkLocalNpmPackage(pkg.name);
    if (checkResult.installed) {
      console.log(`[Dependencies] ${pkg.name} 已安装，跳过`);
      continue;
    }
    
    // 安装
    const installResult = await installLocalNpmPackage(pkg.name);
    if (!installResult.success) {
      return {
        success: false,
        failedPackage: pkg.name,
        error: installResult.error,
      };
    }
  }
  
  return { success: true };
}

/**
 * 重启所有服务
 * TODO: 后续专门实现
 */
export async function restartAllServices(): Promise<void> {
  try {
    await invoke('restart_all_services');
    console.log('[Dependencies] 服务启动命令已发送');
  } catch (error) {
    console.error('[Dependencies] 重启服务失败:', error);
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
  const nodeDep = deps.find(d => d.name === 'nodejs');
  const uvDep = deps.find(d => d.name === 'uv');
  
  const nodeReady = nodeDep?.status === 'installed' && nodeDep?.meetsRequirement === true;
  const uvReady = uvDep?.status === 'installed' && uvDep?.meetsRequirement === true;
  
  return {
    total: deps.length,
    installed: deps.filter(d => d.status === 'installed').length,
    missing: deps.filter(d => d.status === 'missing' || d.status === 'outdated').length,
    nodeReady,
    uvReady,
    systemDepsReady: nodeReady && uvReady,
  };
}
