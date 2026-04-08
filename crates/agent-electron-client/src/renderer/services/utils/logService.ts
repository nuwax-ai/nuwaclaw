/**
 * 日志服务 - Renderer 安全版本
 *
 * 功能:
 * - 日志获取、过滤、导出
 * - 实时日志订阅
 * - 日志统计
 * - 通过 IPC 转发到主进程日志
 */

import { t } from "../core/i18n";

// ==================== Types ====================

export type LogLevel = "error" | "warning" | "success" | "info";

export interface LogEntry {
  id: string;
  timestamp: string;
  level: LogLevel;
  message: string;
  source?: string;
  details?: unknown;
}

export interface LogStats {
  total: number;
  error: number;
  warning: number;
  success: number;
  info: number;
}

export interface LogFilter {
  level?: LogLevel | "all";
  keyword?: string;
  startTime?: string;
  endTime?: string;
  source?: string;
}

export type ExportFormat = "json" | "csv" | "txt";

// ==================== Log Store ====================

class LogStore {
  private logs: LogEntry[] = [];
  private maxLogs = 1000;
  private persistMaxLogs = 100;
  private subscribers: Set<(log: LogEntry) => void> = new Set();
  private readonly storageKey = "app_logs_cache";

  constructor() {
    // 从 localStorage 加载历史日志（renderer 可用）
    this.loadFromStorage();
  }

  private getStorage(): Storage | null {
    if (typeof window === "undefined") return null;
    try {
      return window.localStorage;
    } catch {
      return null;
    }
  }

  private loadFromStorage(): void {
    try {
      const storage = this.getStorage();
      if (!storage) return;
      const raw = storage.getItem(this.storageKey);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        this.logs = parsed as LogEntry[];
      }
    } catch (error) {
      console.error("[LogService] Failed to load logs:", error);
    }
  }

  private saveToStorage(): void {
    try {
      const storage = this.getStorage();
      if (!storage) return;
      storage.setItem(
        this.storageKey,
        JSON.stringify(this.logs.slice(0, this.persistMaxLogs)),
      );
    } catch (error) {
      console.error("[LogService] Failed to save logs:", error);
    }
  }

  addLog(entry: Omit<LogEntry, "id" | "timestamp">): LogEntry {
    const newLog: LogEntry = {
      ...entry,
      id: Date.now().toString(36) + Math.random().toString(36).substr(2, 9),
      timestamp: new Date().toISOString(),
    };

    this.logs.unshift(newLog);

    if (this.logs.length > this.maxLogs) {
      this.logs = this.logs.slice(0, this.maxLogs);
    }

    // 保存到 localStorage
    this.saveToStorage();

    // 通知订阅者
    this.subscribers.forEach((cb) => cb(newLog));

    // 同步转发到主进程日志（避免 renderer 直接依赖 electron-log）
    const msg = `[${entry.source || "app"}]${entry.level === "success" ? " ✓" : ""} ${entry.message}`;
    const level: "info" | "warn" | "error" =
      entry.level === "error"
        ? "error"
        : entry.level === "warning"
          ? "warn"
          : "info";
    if (typeof window !== "undefined") {
      void window.electronAPI?.log?.write(level, msg, entry.details);
    }

    return newLog;
  }

  getLogs(filter?: LogFilter): LogEntry[] {
    let result = [...this.logs];

    if (!filter) return result;

    if (filter.level && filter.level !== "all") {
      result = result.filter((log) => log.level === filter.level);
    }

    if (filter.keyword) {
      const keyword = filter.keyword.toLowerCase();
      result = result.filter(
        (log) =>
          log.message.toLowerCase().includes(keyword) ||
          log.source?.toLowerCase().includes(keyword),
      );
    }

    if (filter.startTime) {
      result = result.filter((log) => log.timestamp >= filter.startTime!);
    }

    if (filter.endTime) {
      result = result.filter((log) => log.timestamp <= filter.endTime!);
    }

    if (filter.source) {
      result = result.filter((log) => log.source === filter.source);
    }

    return result.sort(
      (a, b) =>
        new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
    );
  }

  getStats(): LogStats {
    return {
      total: this.logs.length,
      error: this.logs.filter((l) => l.level === "error").length,
      warning: this.logs.filter((l) => l.level === "warning").length,
      success: this.logs.filter((l) => l.level === "success").length,
      info: this.logs.filter((l) => l.level === "info").length,
    };
  }

  clearLogs(): void {
    this.logs = [];
    this.saveToStorage();
  }

  subscribe(callback: (log: LogEntry) => void): () => void {
    this.subscribers.add(callback);
    return () => this.subscribers.delete(callback);
  }

  getSources(): string[] {
    const sources = new Set<string>();
    this.logs.forEach((log) => {
      if (log.source) sources.add(log.source);
    });
    return Array.from(sources);
  }
}

export const logStore = new LogStore();

// ==================== Log Service ====================

/**
 * 添加日志 (快捷方法)
 */
export function addLog(
  level: LogLevel,
  message: string,
  source?: string,
  details?: unknown,
): LogEntry {
  return logStore.addLog({ level, message, source, details });
}

/**
 * 获取日志
 */
export function getLogs(filter?: LogFilter): LogEntry[] {
  return logStore.getLogs(filter);
}

/**
 * 获取日志统计
 */
export function getLogStats(): LogStats {
  return logStore.getStats();
}

/**
 * 清空日志
 */
export function clearLogs(): void {
  logStore.clearLogs();
}

/**
 * 订阅实时日志
 */
export function subscribeLogs(callback: (log: LogEntry) => void): () => void {
  return logStore.subscribe(callback);
}

/**
 * 获取日志来源列表
 */
export function getLogSources(): string[] {
  return logStore.getSources();
}

/**
 * 导出日志
 */
export function exportLogs(format: ExportFormat = "json"): string {
  const logs = logStore.getLogs();

  switch (format) {
    case "json":
      return JSON.stringify(logs, null, 2);

    case "csv": {
      const headers = t("Claw.Log.csvHeader") + "\n";
      const rows = logs
        .map(
          (log) =>
            `${log.timestamp},${log.level},${log.source || ""},"${log.message.replace(/"/g, '""')}"`,
        )
        .join("\n");
      return headers + rows;
    }

    case "txt":
      return logs
        .map(
          (log) =>
            `[${log.timestamp}] [${log.level.toUpperCase()}] ${log.source ? `[${log.source}] ` : ""}${log.message}`,
        )
        .join("\n");

    default:
      return JSON.stringify(logs, null, 2);
  }
}

/**
 * 获取日志文件路径
 */
export function getLogFilePath(): string {
  return "localStorage:app_logs_cache";
}

// ==================== Quick Log Methods ====================

export const logger = {
  error: (message: string, source?: string, details?: unknown) =>
    addLog("error", message, source, details),

  warn: (message: string, source?: string, details?: unknown) =>
    addLog("warning", message, source, details),

  warning: (message: string, source?: string, details?: unknown) =>
    addLog("warning", message, source, details),

  success: (message: string, source?: string, details?: unknown) =>
    addLog("success", message, source, details),

  info: (message: string, source?: string, details?: unknown) =>
    addLog("info", message, source, details),

  // debug 使用 info 级别（LogStore 无 debug 级别），语义上表示诊断日志
  debug: (message: string, source?: string, details?: unknown) =>
    addLog("info", message, source, details),

  log: (message: string, source?: string, details?: unknown) =>
    addLog("info", message, source, details),
};

export default {
  addLog,
  getLogs,
  getLogStats,
  clearLogs,
  subscribeLogs,
  getLogSources,
  exportLogs,
  logger,
};
