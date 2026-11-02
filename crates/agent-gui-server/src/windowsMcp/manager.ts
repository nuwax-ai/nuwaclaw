/**
 * Windows-MCP 管理器
 *
 * 管理 windows-mcp 子进程的生命周期，提供启动、停止、健康检查等功能。
 *
 * 设计模式：依赖注入
 * - 核心逻辑在此模块中实现
 * - 进程管理由调用方通过 ProcessRunner 接口注入
 */

import type {
  WindowsMcpStatus,
  ProcessConfig,
  ProcessRunner,
  StartResult,
  StopResult,
  WindowsMcpConfig,
} from './types.js';
import { healthCheck, waitForReady } from './healthCheck.js';

/** 默认配置 */
const DEFAULT_CONFIG: Required<WindowsMcpConfig> = {
  healthCheckInterval: 30000,
  startupTimeout: 30000,
  healthCheckTimeout: 5000,
  maxRestarts: 3,
};

/**
 * Windows-MCP 管理器
 *
 * 使用示例：
 * ```typescript
 * const manager = new WindowsMcpManager();
 * manager.setProcessRunner(new MyProcessRunner());
 *
 * const result = await manager.start(60020, (port) => ({
 *   command: '/path/to/uv',
 *   args: ['tool', 'run', 'windows-mcp', '--transport', 'streamable-http', '--port', port.toString()],
 *   env: process.env as Record<string, string>,
 * }));
 *
 * if (result.success) {
 *   console.log('Started on port:', result.port);
 * }
 * ```
 */
export class WindowsMcpManager {
  private runner: ProcessRunner | null = null;
  private port: number = 0;
  private running: boolean = false;
  /** 合并并发 start()，避免双实例抢同一端口 */
  private startInFlight: Promise<StartResult> | null = null;
  private lastError: string | null = null;
  private healthCheckTimer: ReturnType<typeof setInterval> | null = null;
  /** 历史累计重启/失败次数（观测用） */
  private restartCount: number = 0;
  /** 连续健康检查失败次数，达到 maxRestarts 后结束子进程释放端口 */
  private healthFailStreak: number = 0;
  private config: Required<WindowsMcpConfig>;

  constructor(config?: WindowsMcpConfig) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * 设置进程运行器
   *
   * 必须在调用 start() 之前设置。
   *
   * @param runner 进程运行器实例
   */
  setProcessRunner(runner: ProcessRunner): void {
    this.runner = runner;
  }

  /**
   * 启动 windows-mcp 服务
   *
   * @param port 端口号
   * @param buildConfig 构建进程配置的函数
   * @returns 启动结果
   */
  async start(
    port: number,
    buildConfig: (port: number) => ProcessConfig
  ): Promise<StartResult> {
    if (this.running) {
      return { success: true, port: this.port };
    }

    if (this.startInFlight) {
      return this.startInFlight;
    }

    if (!this.runner) {
      const error = 'ProcessRunner not set. Call setProcessRunner() first.';
      this.lastError = error;
      return { success: false, error };
    }

    this.startInFlight = this.startImpl(port, buildConfig).finally(() => {
      this.startInFlight = null;
    });
    return this.startInFlight;
  }

  private async startImpl(
    port: number,
    buildConfig: (port: number) => ProcessConfig
  ): Promise<StartResult> {
    const runner = this.runner;
    if (!runner) {
      const error = 'ProcessRunner not set. Call setProcessRunner() first.';
      this.lastError = error;
      return { success: false, error };
    }

    this.lastError = null;
    const config = buildConfig(port);

    try {
      // 启动进程
      const result = await runner.start(config);
      if (!result.success) {
        this.lastError = result.error || 'Failed to start process';
        return { success: false, error: this.lastError };
      }

      // 等待服务就绪
      const ready = await waitForReady(port, {
        timeout: this.config.startupTimeout,
        requestTimeout: this.config.healthCheckTimeout,
      });

      if (!ready) {
        await runner.stop();
        this.lastError = 'Service failed to become ready within timeout';
        return { success: false, error: this.lastError };
      }

      // 成功启动
      this.port = port;
      this.running = true;
      this.restartCount = 0;
      this.healthFailStreak = 0;

      // 启动健康检查
      this.startHealthCheck();

      return { success: true, port };
    } catch (error) {
      // 若 runner.start 之后、置 running 之前抛错，避免遗留子进程
      try {
        await runner.stop();
      } catch {
        /* ignore */
      }
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.lastError = errorMessage;
      this.running = false;
      this.port = 0;
      return { success: false, error: errorMessage };
    }
  }

  /**
   * 停止 windows-mcp 服务
   *
   * 注意：即使 `this.running === false`（例如健康检查失败时已把标记清掉），仍必须调用
   * runner.stop()，否则子进程（uv/python）可能仍在监听端口，导致退出 Electron 后残留。
   */
  async stop(): Promise<StopResult> {
    this.stopHealthCheck();

    if (!this.runner) {
      this.running = false;
      this.port = 0;
      return { success: true };
    }

    try {
      const result = await this.runner.stop();
      this.running = false;
      this.port = 0;
      return result.success ? { success: true } : result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.running = false;
      this.port = 0;
      return { success: false, error: errorMessage };
    }
  }

  /**
   * 重启 windows-mcp 服务
   */
  async restart(port: number, buildConfig: (port: number) => ProcessConfig): Promise<StartResult> {
    await this.stop();
    return this.start(port, buildConfig);
  }

  /**
   * 获取当前状态
   */
  getStatus(): WindowsMcpStatus {
    return {
      running: this.running,
      port: this.running ? this.port : undefined,
      pid: this.runner?.getPid() ?? undefined,
      error: this.lastError ?? undefined,
    };
  }

  /**
   * 获取 MCP 服务 URL
   *
   * @returns URL 或 null（如果未运行）
   */
  getMcpUrl(): string | null {
    if (!this.running || !this.port) {
      return null;
    }
    return `http://127.0.0.1:${this.port}/mcp`;
  }

  /**
   * 启动健康检查定时器
   */
  private startHealthCheck(): void {
    this.stopHealthCheck();

    this.healthCheckTimer = setInterval(() => {
      void (async () => {
        if (!this.running || !this.port || !this.runner) {
          return;
        }

        const port = this.port;
        const result = await healthCheck({
          port,
          timeout: this.config.healthCheckTimeout,
        });

        if (!result.healthy) {
          this.lastError = `Health check failed: ${result.error}`;
          this.healthFailStreak++;
          if (this.healthFailStreak < this.config.maxRestarts) {
            return;
          }
          // 连续失败达到阈值：结束子进程，避免端口占用且与 stop() 状态一致
          this.stopHealthCheck();
          this.running = false;
          this.port = 0;
          this.healthFailStreak = 0;
          this.restartCount++;
          try {
            await this.runner.stop();
          } catch {
            /* ignore */
          }
          return;
        }

        this.healthFailStreak = 0;
        this.lastError = null;
      })();
    }, this.config.healthCheckInterval);
  }

  /**
   * 停止健康检查定时器
   */
  private stopHealthCheck(): void {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
    }
  }
}
