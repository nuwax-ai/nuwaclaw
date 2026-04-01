/**
 * Windows-MCP 类型定义
 *
 * 定义 WindowsMcpManager 的接口，由调用方（Electron 客户端）实现具体的进程管理逻辑。
 */

/** Windows-MCP 服务状态 */
export interface WindowsMcpStatus {
  /** 是否正在运行 */
  running: boolean;
  /** HTTP 端口号 */
  port?: number;
  /** 进程 PID */
  pid?: number;
  /** 错误信息（如果启动失败） */
  error?: string;
}

/** 进程启动配置（由调用方构建） */
export interface ProcessConfig {
  /** uv 可执行文件路径 */
  command: string;
  /** 启动参数 */
  args: string[];
  /** 环境变量 */
  env: Record<string, string>;
  /** 工作目录（可选） */
  cwd?: string;
}

/** 启动结果 */
export interface StartResult {
  /** 是否成功 */
  success: boolean;
  /** 端口号（成功时） */
  port?: number;
  /** 错误信息（失败时） */
  error?: string;
}

/** 停止结果 */
export interface StopResult {
  /** 是否成功 */
  success: boolean;
  /** 错误信息（失败时） */
  error?: string;
}

/** 进程运行器接口（由调用方实现） */
export interface ProcessRunner {
  /**
   * 启动进程
   * @param config 进程配置
   * @returns 启动结果
   */
  start(config: ProcessConfig): Promise<StartResult>;

  /**
   * 停止进程
   * @returns 停止结果
   */
  stop(): Promise<StopResult>;

  /**
   * 获取进程 PID
   * @returns PID 或 null
   */
  getPid(): number | null;
}

/** WindowsMcpManager 配置 */
export interface WindowsMcpConfig {
  /** 健康检查间隔（毫秒），默认 30000 */
  healthCheckInterval?: number;
  /** 启动超时（毫秒），默认 30000 */
  startupTimeout?: number;
  /** 健康检查超时（毫秒），默认 5000 */
  healthCheckTimeout?: number;
  /** 最大重启次数，默认 3 */
  /** 连续健康检查失败多少次后结束子进程（防抖，避免单次抖动误杀） */
  maxRestarts?: number;
}
