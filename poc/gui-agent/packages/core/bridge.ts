/**
 * NuwaClaw GUI Agent - Python Bridge
 * 
 * TypeScript ↔ Python 通信桥接
 * 调用 OSWorld 标准工具
 */

import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import * as path from 'path';
import type { JsonRpcRequest, JsonRpcResponse, ActionParameters } from './types';

export interface PythonBridgeConfig {
  /** Python 命令，默认 'python3' */
  command?: string;
  /** 桥接脚本路径 */
  bridgeScript?: string;
  /** 工作目录 */
  cwd?: string;
  /** 环境变量 */
  env?: Record<string, string>;
  /** 启动超时（毫秒） */
  startupTimeout?: number;
  /** 请求超时（毫秒） */
  requestTimeout?: number;
}

/**
 * Python 桥接客户端
 * 
 * 通过 JSON-RPC 与 Python 进程通信
 */
export class PythonBridge extends EventEmitter {
  private process: ChildProcess | null = null;
  private requestId = 0;
  private pendingRequests = new Map<string | number, {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
    timeout: NodeJS.Timeout;
  }>();
  private buffer = '';
  private ready = false;
  private defaultRequestTimeout: number;
  private startupTimeout: number;

  constructor(private config: PythonBridgeConfig = {}) {
    super();
    this.defaultRequestTimeout = config.requestTimeout || 30000;
    this.startupTimeout = config.startupTimeout || 10000;
  }

  /**
   * 启动 Python 桥接进程
   */
  async start(): Promise<void> {
    if (this.process) {
      return;
    }

    const command = this.config.command || 'python3';
    const bridgeScript = this.config.bridgeScript || 
      path.join(__dirname, '..', 'tools', 'bridge.py');

    this.process = spawn(command, [bridgeScript], {
      cwd: this.config.cwd,
      env: { ...process.env, ...this.config.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    this.process.stdout?.on('data', (data) => {
      this.handleData(data.toString());
    });

    this.process.stderr?.on('data', (data) => {
      this.emit('log', { type: 'stderr', message: data.toString() });
    });

    this.process.on('error', (err) => {
      this.emit('error', err);
    });

    this.process.on('close', (code) => {
      this.emit('close', code);
      this.cleanup();
    });

    // 等待进程就绪
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Python bridge startup timeout'));
      }, this.startupTimeout);

      this.once('ready', () => {
        clearTimeout(timeout);
        this.ready = true;
        resolve();
      });

      this.once('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });
  }

  /**
   * 处理 Python 输出
   */
  private handleData(data: string): void {
    this.buffer += data;

    // 尝试解析完整的 JSON 响应
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.trim()) continue;

      try {
        const response: JsonRpcResponse = JSON.parse(line);
        
        // 检查是否是 ready 信号
        if (response.result === 'ready' && response.id === 0) {
          this.emit('ready');
          continue;
        }

        const pending = this.pendingRequests.get(response.id);
        if (pending) {
          clearTimeout(pending.timeout);
          this.pendingRequests.delete(response.id);
          
          if (response.error) {
            pending.reject(new Error(response.error.message));
          } else {
            pending.resolve(response.result);
          }
        }
      } catch (err) {
        // 不是 JSON，可能是日志
        this.emit('log', { type: 'stdout', message: line });
      }
    }
  }

  /**
   * 发送 JSON-RPC 请求
   */
  async call<T = unknown>(method: string, params?: unknown, timeout?: number): Promise<T> {
    if (!this.process) {
      throw new Error('Python bridge not started');
    }

    const id = ++this.requestId;
    const request: JsonRpcRequest = {
      jsonrpc: '2.0',
      id,
      method,
      params,
    };

    return new Promise<T>((resolve, reject) => {
      const requestTimeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`Request timeout: ${method}`));
      }, timeout || this.defaultRequestTimeout);

      this.pendingRequests.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
        timeout: requestTimeout,
      });

      this.process!.stdin?.write(JSON.stringify(request) + '\n');
    });
  }

  /**
   * 执行 OSWorld 操作
   */
  async executeAction(
    actionType: string,
    parameters: ActionParameters
  ): Promise<{ success: boolean; message?: string; data?: unknown }> {
    return this.call('execute_action', {
      action_type: actionType,
      parameters,
    });
  }

  /**
   * 截图
   */
  async screenshot(options?: {
    region?: { x: number; y: number; width: number; height: number };
    format?: 'png' | 'webp' | 'jpeg';
  }): Promise<{ image: string; width: number; height: number; format: string }> {
    return this.call('screenshot', options);
  }

  /**
   * 定位图像
   */
  async locateImage(
    imagePath: string,
    confidence?: number
  ): Promise<{ x: number; y: number; width: number; height: number } | null> {
    return this.call('locate_image', { image: imagePath, confidence });
  }

  /**
   * 获取鼠标位置
   */
  async getMousePosition(): Promise<{ x: number; y: number }> {
    return this.call('get_mouse_position');
  }

  /**
   * 开始录制
   */
  async startRecording(): Promise<{ status: string }> {
    return this.call('start_recording');
  }

  /**
   * 停止录制
   */
  async stopRecording(): Promise<{ status: string; actions: unknown[] }> {
    return this.call('stop_recording');
  }

  /**
   * 回放录制
   */
  async playRecording(actions: unknown[], speed?: number): Promise<{ status: string; results: unknown[] }> {
    return this.call('play_recording', { actions, speed });
  }

  /**
   * 列出可用工具
   */
  async listTools(): Promise<Array<{ name: string; description: string }>> {
    return this.call('list_tools');
  }

  /**
   * Ping 检查
   */
  async ping(): Promise<string> {
    return this.call('ping');
  }

  /**
   * 停止 Python 桥接进程
   */
  async stop(): Promise<void> {
    if (!this.process) {
      return;
    }

    // 发送关闭信号
    try {
      await this.call('shutdown', undefined, 5000);
    } catch {
      // 忽略错误
    }

    // 强制终止
    this.process.kill();
    this.cleanup();
  }

  /**
   * 清理状态
   */
  private cleanup(): void {
    this.process = null;
    this.ready = false;
    
    // 拒绝所有待处理的请求
    for (const [id, pending] of this.pendingRequests) {
      clearTimeout(pending.timeout);
      pending.reject(new Error('Python bridge closed'));
    }
    this.pendingRequests.clear();
  }

  /**
   * 是否已启动
   */
  get isRunning(): boolean {
    return this.process !== null && this.ready;
  }
}

/**
 * 全局 Python 桥接实例
 */
let globalBridge: PythonBridge | null = null;

/**
 * 获取全局 Python 桥接
 */
export function getPythonBridge(config?: PythonBridgeConfig): PythonBridge {
  if (!globalBridge) {
    globalBridge = new PythonBridge(config);
  }
  return globalBridge;
}

/**
 * 关闭全局 Python 桥接
 */
export async function closePythonBridge(): Promise<void> {
  if (globalBridge) {
    await globalBridge.stop();
    globalBridge = null;
  }
}
