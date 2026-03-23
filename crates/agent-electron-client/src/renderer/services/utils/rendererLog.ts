/**
 * Renderer 进程日志工具
 * 通过 IPC 将日志写入主进程日志文件
 */

export type LogLevel = "info" | "warn" | "error";

export interface Logger {
  info: (msg: string, ...args: unknown[]) => void;
  warn: (msg: string, ...args: unknown[]) => void;
  error: (msg: string, ...args: unknown[]) => void;
}

/**
 * 创建带 scope 的日志记录器
 * @param scope - 日志作用域，如 "SetupCheck", "DepsCheck", "AutoReconnect"
 * @returns Logger 实例
 *
 * 使用示例:
 * const log = createLogger("AutoReconnect");
 * log.info("starting services");
 * // 输出: [Renderer] [AutoReconnect] starting services
 */
export function createLogger(scope: string): Logger {
  const prefix = `[Renderer] [${scope}]`;
  return {
    info: (msg: string, ...args: unknown[]): void => {
      window.electronAPI?.log.write("info", `${prefix} ${msg}`, ...args);
    },
    warn: (msg: string, ...args: unknown[]): void => {
      window.electronAPI?.log.write("warn", `${prefix} ${msg}`, ...args);
    },
    error: (msg: string, ...args: unknown[]): void => {
      window.electronAPI?.log.write("error", `${prefix} ${msg}`, ...args);
    },
  };
}

/**
 * 默认日志记录器（无 scope）
 */
export const rendererLog: Logger = {
  info: (msg: string, ...args: unknown[]): void => {
    window.electronAPI?.log.write("info", `[Renderer] ${msg}`, ...args);
  },
  warn: (msg: string, ...args: unknown[]): void => {
    window.electronAPI?.log.write("warn", `[Renderer] ${msg}`, ...args);
  },
  error: (msg: string, ...args: unknown[]): void => {
    window.electronAPI?.log.write("error", `[Renderer] ${msg}`, ...args);
  },
};

export default rendererLog;
