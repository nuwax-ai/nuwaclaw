/**
 * 日志服务 - Electron Client 版本
 * 
 * 功能:
 * - 日志获取、过滤、导出
 * - 实时日志订阅
 * - 日志统计
 * - 结合 electron-log
 */

import log from 'electron-log';
import * as fs from 'fs';
import * as path from 'path';
import { APP_DATA_DIR_NAME } from '@shared/constants';

// ==================== Types ====================

export type LogLevel = 'error' | 'warning' | 'success' | 'info';

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
  level?: LogLevel | 'all';
  keyword?: string;
  startTime?: string;
  endTime?: string;
  source?: string;
}

export type ExportFormat = 'json' | 'csv' | 'txt';

// ==================== Log Store ====================

class LogStore {
  private logs: LogEntry[] = [];
  private maxLogs = 1000;
  private subscribers: Set<(log: LogEntry) => void> = new Set();

  constructor() {
    // 从文件加载历史日志
    this.loadFromFile();
  }

  private getLogFilePath(): string {
    const home = process.env.HOME || process.env.USERPROFILE || '';
    return path.join(home, APP_DATA_DIR_NAME, 'logs', 'app.json');
  }

  private loadFromFile(): void {
    try {
      const logPath = this.getLogFilePath();
      if (fs.existsSync(logPath)) {
        const data = fs.readFileSync(logPath, 'utf-8');
        this.logs = JSON.parse(data);
      }
    } catch (error) {
      console.error('[LogService] Failed to load logs:', error);
    }
  }

  private saveToFile(): void {
    try {
      const logPath = this.getLogFilePath();
      const dir = path.dirname(logPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(logPath, JSON.stringify(this.logs.slice(0, 100)));
    } catch (error) {
      console.error('[LogService] Failed to save logs:', error);
    }
  }

  addLog(entry: Omit<LogEntry, 'id' | 'timestamp'>): LogEntry {
    const newLog: LogEntry = {
      ...entry,
      id: Date.now().toString(36) + Math.random().toString(36).substr(2, 9),
      timestamp: new Date().toISOString(),
    };

    this.logs.unshift(newLog);

    if (this.logs.length > this.maxLogs) {
      this.logs = this.logs.slice(0, this.maxLogs);
    }

    // 保存到文件
    this.saveToFile();

    // 通知订阅者
    this.subscribers.forEach((cb) => cb(newLog));

    // 同时写入 electron-log
    switch (entry.level) {
      case 'error':
        log.error(`[${entry.source || 'app'}] ${entry.message}`);
        break;
      case 'warning':
        log.warn(`[${entry.source || 'app'}] ${entry.message}`);
        break;
      case 'success':
        log.info(`[${entry.source || 'app'}] ✓ ${entry.message}`);
        break;
      case 'info':
      default:
        log.info(`[${entry.source || 'app'}] ${entry.message}`);
    }

    return newLog;
  }

  getLogs(filter?: LogFilter): LogEntry[] {
    let result = [...this.logs];

    if (!filter) return result;

    if (filter.level && filter.level !== 'all') {
      result = result.filter((log) => log.level === filter.level);
    }

    if (filter.keyword) {
      const keyword = filter.keyword.toLowerCase();
      result = result.filter(
        (log) =>
          log.message.toLowerCase().includes(keyword) ||
          log.source?.toLowerCase().includes(keyword)
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
      (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );
  }

  getStats(): LogStats {
    return {
      total: this.logs.length,
      error: this.logs.filter((l) => l.level === 'error').length,
      warning: this.logs.filter((l) => l.level === 'warning').length,
      success: this.logs.filter((l) => l.level === 'success').length,
      info: this.logs.filter((l) => l.level === 'info').length,
    };
  }

  clearLogs(): void {
    this.logs = [];
    this.saveToFile();
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
  details?: unknown
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
export function exportLogs(format: ExportFormat = 'json'): string {
  const logs = logStore.getLogs();

  switch (format) {
    case 'json':
      return JSON.stringify(logs, null, 2);

    case 'csv': {
      const headers = '时间,级别,来源,消息\n';
      const rows = logs
        .map(
          (log) =>
            `${log.timestamp},${log.level},${log.source || ''},"${log.message.replace(/"/g, '""')}"`
        )
        .join('\n');
      return headers + rows;
    }

    case 'txt':
      return logs
        .map(
          (log) =>
            `[${log.timestamp}] [${log.level.toUpperCase()}] ${log.source ? `[${log.source}] ` : ''}${log.message}`
        )
        .join('\n');

    default:
      return JSON.stringify(logs, null, 2);
  }
}

/**
 * 获取日志文件路径
 */
export function getLogFilePath(): string {
  return logStore.getLogs ? '' : '';
}

// ==================== Quick Log Methods ====================

export const logger = {
  error: (message: string, source?: string, details?: unknown) =>
    addLog('error', message, source, details),
  
  warn: (message: string, source?: string, details?: unknown) =>
    addLog('warning', message, source, details),
  
  warning: (message: string, source?: string, details?: unknown) =>
    addLog('warning', message, source, details),
  
  success: (message: string, source?: string, details?: unknown) =>
    addLog('success', message, source, details),
  
  info: (message: string, source?: string, details?: unknown) =>
    addLog('info', message, source, details),
  
  log: (message: string, source?: string, details?: unknown) =>
    addLog('info', message, source, details),
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
