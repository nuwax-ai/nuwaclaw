/**
 * 日志服务
 * 提供日志获取、过滤、导出、订阅等功能
 */

import { message } from "antd";

// 日志级别
type LogLevel = "error" | "warning" | "success" | "info";

// 日志条目
export interface LogEntry {
  id: string;
  timestamp: string; // ISO 8601 格式
  level: LogLevel;
  message: string;
  source?: string; // 日志来源
  details?: any; // 详细信息
}

// 日志统计
export interface LogStats {
  total: number;
  error: number;
  warning: number;
  success: number;
  info: number;
}

// 日志筛选参数
export interface LogFilter {
  level?: LogLevel | "all";
  keyword?: string;
  startTime?: string;
  endTime?: string;
  source?: string;
}

// 导出格式
export type ExportFormat = "json" | "csv" | "txt";

// Mock 日志数据
const mockLogs: LogEntry[] = [
  {
    id: "1",
    timestamp: "2026-02-04T14:30:25Z",
    level: "info",
    message: "系统启动完成",
    source: "system",
  },
  {
    id: "2",
    timestamp: "2026-02-04T14:30:26Z",
    level: "success",
    message: "连接到服务器成功",
    source: "network",
  },
  {
    id: "3",
    timestamp: "2026-02-04T14:30:27Z",
    level: "info",
    message: "等待任务指令...",
    source: "agent",
  },
  {
    id: "4",
    timestamp: "2026-02-04T14:31:00Z",
    level: "warning",
    message: "依赖缺失: Docker",
    source: "dependency",
  },
  {
    id: "5",
    timestamp: "2026-02-04T14:31:15Z",
    level: "info",
    message: "正在安装 Docker...",
    source: "dependency",
  },
  {
    id: "6",
    timestamp: "2026-02-04T14:31:45Z",
    level: "success",
    message: "Docker 安装成功",
    source: "dependency",
  },
  {
    id: "7",
    timestamp: "2026-02-04T14:32:00Z",
    level: "info",
    message: "任务队列已就绪",
    source: "agent",
  },
  {
    id: "8",
    timestamp: "2026-02-04T14:32:30Z",
    level: "error",
    message: "文件同步失败: 连接超时",
    source: "sync",
  },
  {
    id: "9",
    timestamp: "2026-02-04T14:32:35Z",
    level: "warning",
    message: "重试第 1 次...",
    source: "sync",
  },
  {
    id: "10",
    timestamp: "2026-02-04T14:32:40Z",
    level: "success",
    message: "文件同步成功",
    source: "sync",
  },
];

/**
 * 日志服务类
 */
class LogService {
  private logs: LogEntry[] = [...mockLogs];
  private subscribers: Set<(log: LogEntry) => void> = new Set();
  private maxLogs = 1000; // 最大保留日志数

  /**
   * 获取所有日志
   */
  async getLogs(filter?: LogFilter): Promise<LogEntry[]> {
    await this.delay(100);

    let result = [...this.logs];

    if (filter) {
      // 按级别过滤
      if (filter.level && filter.level !== "all") {
        result = result.filter((log) => log.level === filter.level);
      }

      // 按关键词搜索
      if (filter.keyword) {
        const keyword = filter.keyword.toLowerCase();
        result = result.filter(
          (log) =>
            log.message.toLowerCase().includes(keyword) ||
            log.source?.toLowerCase().includes(keyword),
        );
      }

      // 按时间范围过滤
      if (filter.startTime) {
        result = result.filter((log) => log.timestamp >= filter.startTime!);
      }
      if (filter.endTime) {
        result = result.filter((log) => log.timestamp <= filter.endTime!);
      }

      // 按来源过滤
      if (filter.source) {
        result = result.filter((log) => log.source === filter.source);
      }
    }

    // 按时间倒序排列
    return result.sort(
      (a, b) =>
        new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
    );
  }

  /**
   * 获取日志统计
   */
  async getStats(): Promise<LogStats> {
    await this.delay(50);

    return {
      total: this.logs.length,
      error: this.logs.filter((l) => l.level === "error").length,
      warning: this.logs.filter((l) => l.level === "warning").length,
      success: this.logs.filter((l) => l.level === "success").length,
      info: this.logs.filter((l) => l.level === "info").length,
    };
  }

  /**
   * 添加日志
   */
  addLog(log: Omit<LogEntry, "id" | "timestamp">): void {
    const newLog: LogEntry = {
      ...log,
      id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
      timestamp: new Date().toISOString(),
    };

    this.logs.unshift(newLog);

    // 限制日志数量
    if (this.logs.length > this.maxLogs) {
      this.logs = this.logs.slice(0, this.maxLogs);
    }

    // 通知订阅者
    this.subscribers.forEach((cb) => cb(newLog));
  }

  /**
   * 清空日志
   */
  async clearLogs(): Promise<void> {
    await this.delay(100);
    this.logs = [];
    message.success("日志已清空");
  }

  /**
   * 导出日志
   */
  async exportLogs(format: ExportFormat = "json"): Promise<Blob> {
    message.loading("正在导出日志...", 0);

    await this.delay(500);

    let content: string;
    let mimeType: string;

    switch (format) {
      case "json":
        content = JSON.stringify(this.logs, null, 2);
        mimeType = "application/json";
        break;
      case "csv": {
        const headers = "时间,级别,来源,消息\n";
        const rows = this.logs
          .map(
            (log) =>
              `${log.timestamp},${log.level},${log.source || ""},"${log.message.replace(/"/g, '""')}"`,
          )
          .join("\n");
        content = headers + rows;
        mimeType = "text/csv";
        break;
      }
      case "txt":
        content = this.logs
          .map(
            (log) =>
              `[${log.timestamp}] [${log.level.toUpperCase()}] ${log.source ? `[${log.source}] ` : ""}${log.message}`,
          )
          .join("\n");
        mimeType = "text/plain";
        break;
      default:
        content = JSON.stringify(this.logs, null, 2);
        mimeType = "application/json";
    }

    message.success("日志导出成功");
    return new Blob([content], { type: mimeType });
  }

  /**
   * 下载日志文件
   */
  downloadLogs(blob: Blob, filename?: string): void {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download =
      filename || `logs-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  /**
   * 订阅实时日志
   */
  subscribe(callback: (log: LogEntry) => void): () => void {
    this.subscribers.add(callback);
    return () => {
      this.subscribers.delete(callback);
    };
  }

  /**
   * 生成模拟日志（用于测试）
   */
  generateMockLogs(count: number = 50): void {
    const sources = ["system", "network", "agent", "dependency", "sync"];
    const levels: LogLevel[] = ["info", "success", "warning", "error"];
    const messages = {
      info: [
        "正在初始化...",
        "加载配置中...",
        "检查依赖...",
        "同步数据...",
        "保存状态...",
      ],
      success: [
        "操作成功",
        "连接建立",
        "文件同步完成",
        "依赖安装成功",
        "任务完成",
      ],
      warning: [
        "连接不稳定",
        "依赖缺失",
        "磁盘空间不足",
        "配置过期",
        "重试中...",
      ],
      error: ["连接超时", "文件读取失败", "权限不足", "服务不可用", "解析错误"],
    };

    for (let i = 0; i < count; i++) {
      const level = levels[Math.floor(Math.random() * levels.length)];
      const source = sources[Math.floor(Math.random() * sources.length)];
      const msgList = messages[level];

      this.addLog({
        level,
        source,
        message: msgList[Math.floor(Math.random() * msgList.length)],
      });
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// 单例导出
export const logService = new LogService();

// 便捷函数
export const getLogs = (filter?: LogFilter) => logService.getLogs(filter);
export const getLogStats = () => logService.getStats();
export const addLog = (log: Omit<LogEntry, "id" | "timestamp">) =>
  logService.addLog(log);
export const clearLogs = () => logService.clearLogs();
export const exportLogs = (format: ExportFormat) =>
  logService.exportLogs(format);
export const downloadLogs = (blob: Blob, filename?: string) =>
  logService.downloadLogs(blob, filename);
export const subscribeLogs = (callback: (log: LogEntry) => void) =>
  logService.subscribe(callback);
export const generateMockLogs = (count?: number) =>
  logService.generateMockLogs(count);
