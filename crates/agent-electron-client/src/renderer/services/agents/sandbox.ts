/**
 * Sandbox Manager - 跨平台沙箱执行
 * 
 * 支持:
 * - macOS: 应用程序隔离
 * - Windows: Hyper-V/WSL 隔离
 * - Linux: Docker/容器隔离
 */

import * as path from 'path';
import * as fs from 'fs';
import { spawn, ChildProcess } from 'child_process';
import log from 'electron-log';
import { APP_NAME_IDENTIFIER } from '@shared/constants';

export type Platform = 'darwin' | 'win32' | 'linux';

export interface SandboxConfig {
  enabled: boolean;
  type: 'none' | 'macos-app-sandbox' | 'docker' | 'wsl' | 'firejail';
  image?: string;  // Docker 镜像
  workspaceDir: string;
}

export interface SandboxStatus {
  ready: boolean;
  type: string;
  containerId?: string;
  error?: string;
}

export interface SandboxRuntime {
  id: string;
  pid: number;
  cwd: string;
  startedAt: number;
}

// ==================== Platform Detection ====================

export function getPlatform(): Platform {
  return process.platform as Platform;
}

export function isMacOS(): boolean {
  return process.platform === 'darwin';
}

export function isWindows(): boolean {
  return process.platform === 'win32';
}

export function isLinux(): boolean {
  return process.platform === 'linux';
}

// ==================== Docker Detection ====================

export async function checkDocker(): Promise<boolean> {
  return new Promise((resolve) => {
    const proc = spawn('docker', ['--version'], {
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    proc.on('close', (code) => resolve(code === 0));
    proc.on('error', () => resolve(false));
  });
}

export async function checkWSL(): Promise<boolean> {
  if (!isWindows()) return false;
  
  return new Promise((resolve) => {
    const proc = spawn('wsl', ['--status'], {
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    proc.on('close', (code) => resolve(code === 0));
    proc.on('error', () => resolve(false));
  });
}

// ==================== Sandbox Manager ====================

class SandboxManager {
  private config: SandboxConfig;
  private runtime: SandboxRuntime | null = null;
  private process: ChildProcess | null = null;

  constructor() {
    this.config = {
      enabled: false,
      type: 'none',
      workspaceDir: '',
    };
  }

  /**
   * 初始化沙箱配置
   */
  async init(config: Partial<SandboxConfig>): Promise<void> {
    this.config = {
      enabled: false,
      type: 'none',
      workspaceDir: config.workspaceDir || '',
      ...config,
    };

    // 自动检测可用沙箱类型
    if (this.config.enabled) {
      await this.detectAvailableSandbox();
    }
  }

  /**
   * 检测可用沙箱
   */
  async detectAvailableSandbox(): Promise<string> {
    const platform = getPlatform();

    if (platform === 'darwin') {
      // macOS: 尝试 Docker
      const hasDocker = await checkDocker();
      if (hasDocker) {
        this.config.type = 'docker';
        return 'docker';
      }
      // 回退到应用沙箱
      this.config.type = 'macos-app-sandbox';
      return 'macos-app-sandbox';
    }

    if (platform === 'win32') {
      // Windows: 尝试 WSL 或 Docker
      const hasWSL = await checkWSL();
      const hasDocker = await checkDocker();
      
      if (hasWSL) {
        this.config.type = 'wsl';
        return 'wsl';
      }
      if (hasDocker) {
        this.config.type = 'docker';
        return 'docker';
      }
      this.config.type = 'none';
      return 'none';
    }

    if (platform === 'linux') {
      // Linux: Docker 或 Firejail
      const hasDocker = await checkDocker();
      if (hasDocker) {
        this.config.type = 'docker';
        return 'docker';
      }
      // 尝试 firejail
      const hasFirejail = await this.checkCommand('firejail');
      if (hasFirejail) {
        this.config.type = 'firejail';
        return 'firejail';
      }
      this.config.type = 'none';
      return 'none';
    }

    return 'none';
  }

  private async checkCommand(cmd: string): Promise<boolean> {
    return new Promise((resolve) => {
      const checkCmd = process.platform === 'win32' ? 'where' : 'which';
      const proc = spawn(checkCmd, [cmd], { stdio: ['ignore', 'pipe', 'ignore'] });
      proc.on('close', (code) => resolve(code === 0));
      proc.on('error', () => resolve(false));
    });
  }

  /**
   * 启动沙箱
   */
  async start(image?: string): Promise<{ success: boolean; error?: string }> {
    if (!this.config.enabled || this.config.type === 'none') {
      return { success: true };
    }

    const platform = getPlatform();

    try {
      switch (this.config.type) {
        case 'docker':
          return await this.startDocker(image || this.config.image || 'alpine');
        
        case 'wsl':
          return await this.startWSL();
        
        case 'firejail':
          return await this.startFirejail();
        
        case 'macos-app-sandbox':
          return { success: true }; // macOS 应用沙箱由系统管理
        
        default:
          return { success: true };
      }
    } catch (error) {
      log.error('[Sandbox] Start failed:', error);
      return { success: false, error: String(error) };
    }
  }

  /**
   * 启动 Docker 沙箱
   */
  private async startDocker(image: string): Promise<{ success: boolean; error?: string }> {
    const containerName = `${APP_NAME_IDENTIFIER}-${Date.now()}`;
    const workspace = this.config.workspaceDir;

    return new Promise((resolve) => {
      // 启动 Docker 容器
      const proc = spawn('docker', [
        'run',
        '-d',
        '--name', containerName,
        '-v', `${workspace}:/workspace`,
        '-w', '/workspace',
        image,
        'sleep', 'infinity',
      ], {
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });

      let stderr = '';
      proc.stderr?.on('data', (data) => { stderr += data.toString(); });

      proc.on('error', (error) => {
        resolve({ success: false, error: error.message });
      });

      proc.on('close', (code) => {
        if (code === 0) {
          this.runtime = {
            id: containerName,
            pid: proc.pid || 0,
            cwd: workspace,
            startedAt: Date.now(),
          };
          resolve({ success: true });
        } else {
          resolve({ success: false, error: stderr || 'Docker start failed' });
        }
      });
    });
  }

  /**
   * 启动 WSL 沙箱
   */
  private async startWSL(): Promise<{ success: boolean; error?: string }> {
    const workspace = this.config.workspaceDir;

    return new Promise((resolve) => {
      // 在 WSL 中启动
      const proc = spawn('wsl', [
        'bash', '-c',
        `cd "${workspace}" && sleep infinity`
      ], {
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });

      proc.on('error', (error) => {
        resolve({ success: false, error: error.message });
      });

      proc.on('close', (code) => {
        resolve({ success: code === 0 });
      });

      // 等待启动
      setTimeout(() => {
        if (proc.pid) {
          this.runtime = {
            id: 'wsl',
            pid: proc.pid,
            cwd: workspace,
            startedAt: Date.now(),
          };
          resolve({ success: true });
        }
      }, 2000);
    });
  }

  /**
   * 启动 Firejail 沙箱
   */
  private async startFirejail(): Promise<{ success: boolean; error?: string }> {
    // Firejail 需要在运行命令时使用，不需要预先启动
    return { success: true };
  }

  /**
   * 在沙箱中执行命令
   */
  async execute(
    command: string,
    args: string[] = [],
    options?: { env?: Record<string, string>; cwd?: string }
  ): Promise<{ success: boolean; stdout?: string; stderr?: string; error?: string }> {
    const platform = getPlatform();
    const cwd = options?.cwd || this.config.workspaceDir;

    // 如果未启用沙箱，直接执行
    if (!this.config.enabled || this.config.type === 'none') {
      return this.executeDirect(command, args, options);
    }

    try {
      switch (this.config.type) {
        case 'docker':
          return await this.executeInDocker(command, args, { cwd, ...options });
        
        case 'wsl':
          return await this.executeInWSL(command, args, { cwd, ...options });
        
        case 'firejail':
          return await this.executeInFirejail(command, args, { cwd, ...options });
        
        default:
          return this.executeDirect(command, args, options);
      }
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  /**
   * 直接执行
   */
  private executeDirect(
    command: string,
    args: string[],
    options?: { env?: Record<string, string>; cwd?: string }
  ): Promise<{ success: boolean; stdout?: string; stderr?: string; error?: string }> {
    return new Promise((resolve) => {
      const proc = spawn(command, args, {
        cwd: options?.cwd,
        env: { ...process.env, ...options?.env },
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });

      let stdout = '';
      let stderr = '';

      proc.stdout?.on('data', (data) => { stdout += data.toString(); });
      proc.stderr?.on('data', (data) => { stderr += data.toString(); });

      proc.on('close', (code) => {
        resolve({
          success: code === 0,
          stdout,
          stderr,
        });
      });

      proc.on('error', (error) => {
        resolve({ success: false, error: error.message });
      });
    });
  }

  /**
   * 在 Docker 中执行
   */
  private executeInDocker(
    command: string,
    args: string[],
    options?: { cwd?: string; env?: Record<string, string> }
  ): Promise<{ success: boolean; stdout?: string; stderr?: string; error?: string }> {
    if (!this.runtime?.id) {
      return { success: false, error: 'Sandbox not running' };
    }

    const dockerArgs = [
      'exec',
      '-i',
      this.runtime.id,
      'sh', '-c',
      `${command} ${args.join(' ')}`
    ];

    return new Promise((resolve) => {
      const proc = spawn('docker', dockerArgs, {
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });

      let stdout = '';
      let stderr = '';

      proc.stdout?.on('data', (data) => { stdout += data.toString(); });
      proc.stderr?.on('data', (data) => { stderr += data.toString(); });

      proc.on('close', (code) => {
        resolve({ success: code === 0, stdout, stderr });
      });

      proc.on('error', (error) => {
        resolve({ success: false, error: error.message });
      });
    });
  }

  /**
   * 在 WSL 中执行
   */
  private executeInWSL(
    command: string,
    args: string[],
    options?: { cwd?: string; env?: Record<string, string> }
  ): Promise<{ success: boolean; stdout?: string; stderr?: string; error?: string }> {
    const cwd = options?.cwd || this.config.workspaceDir;
    const fullCommand = `${command} ${args.join(' ')}`;

    return new Promise((resolve) => {
      const proc = spawn('wsl', [
        'bash', '-c',
        `cd "${cwd}" && ${fullCommand}`
      ], {
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });

      let stdout = '';
      let stderr = '';

      proc.stdout?.on('data', (data) => { stdout += data.toString(); });
      proc.stderr?.on('data', (data) => { stderr += data.toString(); });

      proc.on('close', (code) => {
        resolve({ success: code === 0, stdout, stderr });
      });

      proc.on('error', (error) => {
        resolve({ success: false, error: error.message });
      });
    });
  }

  /**
   * 在 Firejail 中执行
   */
  private executeInFirejail(
    command: string,
    args: string[],
    options?: { cwd?: string; env?: Record<string, string> }
  ): Promise<{ success: boolean; stdout?: string; stderr?: string; error?: string }> {
    const cwd = options?.cwd || this.config.workspaceDir;

    return new Promise((resolve) => {
      const proc = spawn('firejail', [
        '--noprofile',
        `--directory=${cwd}`,
        '--',
        command,
        ...args
      ], {
        cwd,
        env: { ...process.env, ...options?.env },
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });

      let stdout = '';
      let stderr = '';

      proc.stdout?.on('data', (data) => { stdout += data.toString(); });
      proc.stderr?.on('data', (data) => { stderr += data.toString(); });

      proc.on('close', (code) => {
        resolve({ success: code === 0, stdout, stderr });
      });

      proc.on('error', (error) => {
        resolve({ success: false, error: error.message });
      });
    });
  }

  /**
   * 停止沙箱
   */
  async stop(): Promise<void> {
    if (!this.runtime) return;

    try {
      if (this.config.type === 'docker' && this.runtime.id) {
        spawn('docker', ['stop', this.runtime.id], {
          stdio: 'ignore',
          windowsHide: true,
        });
        spawn('docker', ['rm', '-f', this.runtime.id], {
          stdio: 'ignore',
          windowsHide: true,
        });
      }

      if (this.process) {
        this.process.kill();
      }
    } catch (error) {
      log.error('[Sandbox] Stop error:', error);
    }

    this.runtime = null;
    this.process = null;
  }

  /**
   * 获取状态
   */
  getStatus(): SandboxStatus {
    return {
      ready: !!this.runtime,
      type: this.config.type,
      containerId: this.runtime?.id,
    };
  }

  /**
   * 获取配置
   */
  getConfig(): SandboxConfig {
    return { ...this.config };
  }

  /**
   * 是否启用沙箱
   */
  isEnabled(): boolean {
    return this.config.enabled;
  }
}

export const sandboxManager = new SandboxManager();

export default sandboxManager;
