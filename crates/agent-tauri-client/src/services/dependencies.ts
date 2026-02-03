/**
 * 依赖管理服务
 * 获取依赖状态，支持安装操作
 */

import { message } from 'antd';

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
  outdated: number;
}

// Mock 数据
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

// 依赖服务类
class DependencyService {
  private dependencies: DependencyItem[] = [...mockDependencies];

  /**
   * 获取所有依赖
   */
  async getDependencies(): Promise<DependencyItem[]> {
    // TODO: 替换为真实的后端 API 调用
    // return invoke('get_dependencies');
    await this.delay(300);
    return [...this.dependencies];
  }

  /**
   * 获取依赖统计
   */
  async getSummary(): Promise<DependencySummary> {
    const deps = await this.getDependencies();
    return {
      total: deps.length,
      installed: deps.filter(d => d.status === 'installed').length,
      missing: deps.filter(d => d.status === 'missing').length,
      outdated: deps.filter(d => d.status === 'outdated').length,
    };
  }

  /**
   * 安装依赖
   */
  async installDependency(name: string): Promise<boolean> {
    message.loading(`正在安装 ${name}...`, 0);
    
    try {
      // TODO: 替换为真实的后端 API 调用
      // await invoke('install_dependency', { name });
      await this.delay(2000);
      
      // 更新本地状态
      const index = this.dependencies.findIndex(d => d.name === name);
      if (index !== -1) {
        this.dependencies[index] = {
          ...this.dependencies[index],
          status: 'installed',
          version: 'v1.0.0', // Mock 版本
        };
      }
      
      message.success(`${name} 安装成功！`);
      return true;
    } catch (error: any) {
      message.error(error.message || `${name} 安装失败`);
      return false;
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

  /**
   * 安装所有缺失的依赖
   */
  async installAll(): Promise<boolean> {
    const missing = this.dependencies.filter(d => d.status === 'missing');
    if (missing.length === 0) {
      message.info('没有需要安装的依赖');
      return true;
    }

    message.loading(`正在安装 ${missing.length} 个依赖...`, 0);
    
    for (const dep of missing) {
      await this.installDependency(dep.name);
    }
    
    message.success('所有依赖安装完成！');
    return true;
  }

  /**
   * 检查依赖状态
   */
  async checkDependency(name: string): Promise<DependencyItem | null> {
    await this.delay(100);
    return this.dependencies.find(d => d.name === name) || null;
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
