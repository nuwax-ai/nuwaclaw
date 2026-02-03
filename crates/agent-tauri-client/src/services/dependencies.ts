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
