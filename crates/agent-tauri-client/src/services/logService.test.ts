/**
 * 日志服务测试
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  logService,
  getLogs,
  getLogStats,
  addLog,
  clearLogs,
  exportLogs,
  subscribeLogs,
  generateMockLogs,
  LogEntry,
  LogFilter,
  LogStats,
} from "./logService";

describe("LogService", () => {
  beforeEach(() => {
    // 重置日志服务
    logService.logs = [];
  });

  describe("获取日志", () => {
    it("应该返回空数组当没有日志", async () => {
      const logs = await getLogs();
      expect(logs).toEqual([]);
    });

    it("应该返回添加的日志", async () => {
      addLog({ level: "info", message: "测试日志" });
      const logs = await getLogs();
      expect(logs.length).toBe(1);
      expect(logs[0].message).toBe("测试日志");
    });

    it("应该按时间倒序排列", async () => {
      addLog({ level: "info", message: "第一条" });
      addLog({ level: "info", message: "第二条" });
      const logs = await getLogs();
      expect(logs[0].message).toBe("第二条");
      expect(logs[1].message).toBe("第一条");
    });
  });

  describe("日志过滤", () => {
    it("应该按级别过滤", async () => {
      addLog({ level: "info", message: "信息日志" });
      addLog({ level: "error", message: "错误日志" });
      addLog({ level: "warning", message: "警告日志" });

      const errorLogs = await getLogs({ level: "error" });
      expect(errorLogs.length).toBe(1);
      expect(errorLogs[0].level).toBe("error");
    });

    it("应该按关键词搜索", async () => {
      addLog({ level: "info", message: "系统启动完成" });
      addLog({ level: "info", message: "用户登录成功" });
      addLog({ level: "info", message: "文件同步完成" });

      const filtered = await getLogs({ keyword: "登录" });
      expect(filtered.length).toBe(1);
      expect(filtered[0].message).toContain("登录");
    });
  });

  describe("日志统计", () => {
    it("应该正确计算统计数据", async () => {
      addLog({ level: "info", message: "日志1" });
      addLog({ level: "info", message: "日志2" });
      addLog({ level: "error", message: "错误1" });
      addLog({ level: "warning", message: "警告1" });
      addLog({ level: "success", message: "成功1" });

      const stats = await getLogStats();
      expect(stats.total).toBe(5);
      expect(stats.info).toBe(2);
      expect(stats.error).toBe(1);
      expect(stats.warning).toBe(1);
      expect(stats.success).toBe(1);
    });

    it("应该正确处理空日志", async () => {
      const stats = await getLogStats();
      expect(stats.total).toBe(0);
      expect(stats.error).toBe(0);
      expect(stats.warning).toBe(0);
      expect(stats.success).toBe(0);
      expect(stats.info).toBe(0);
    });
  });

  describe("添加日志", () => {
    it("应该自动生成 id 和 timestamp", async () => {
      addLog({ level: "info", message: "测试" });
      const logs = await getLogs();

      expect(logs[0].id).toBeDefined();
      expect(logs[0].timestamp).toBeDefined();
      // ISO 8601 格式，支持毫秒
      expect(logs[0].timestamp).toMatch(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/,
      );
    });

    it("应该支持来源字段", () => {
      addLog({ level: "info", message: "测试", source: "system" });
      expect(logService.logs[0].source).toBe("system");
    });

    it("应该支持详细信息字段", () => {
      const details = { userId: 123, action: "login" };
      addLog({ level: "info", message: "测试", details });
      expect(logService.logs[0].details).toEqual(details);
    });
  });

  describe("清空日志", () => {
    it("应该清空所有日志", async () => {
      addLog({ level: "info", message: "测试" });
      await clearLogs();

      const logs = await getLogs();
      expect(logs.length).toBe(0);
    });
  });

  describe("订阅日志", () => {
    it("应该能订阅实时日志", () => {
      const callback = vi.fn();
      const unsubscribe = subscribeLogs(callback);

      addLog({ level: "info", message: "新日志" });

      expect(callback).toHaveBeenCalledTimes(1);
      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({ message: "新日志" }),
      );

      unsubscribe();
      addLog({ level: "info", message: "另一条" });
      expect(callback).toHaveBeenCalledTimes(1);
    });
  });

  describe("生成模拟日志", () => {
    it("应该生成指定数量的日志", () => {
      generateMockLogs(10);
      expect(logService.logs.length).toBe(10);
    });

    it("应该生成多种级别的日志", () => {
      generateMockLogs(100);
      const levels = new Set(logService.logs.map((l) => l.level));
      expect(levels.size).toBeGreaterThan(1);
    });
  });

  describe("导出日志", () => {
    it("应该能导出 JSON 格式", async () => {
      addLog({ level: "info", message: "测试" });
      const blob = await exportLogs("json");

      expect(blob.type).toBe("application/json");
      expect(blob instanceof Blob).toBe(true);
    });

    it("应该能导出 CSV 格式", async () => {
      addLog({ level: "info", message: "测试", source: "test" });
      const blob = await exportLogs("csv");

      expect(blob.type).toBe("text/csv");
      expect(blob instanceof Blob).toBe(true);
    });

    it("应该能导出 TXT 格式", async () => {
      addLog({ level: "info", message: "测试" });
      const blob = await exportLogs("txt");

      expect(blob.type).toBe("text/plain");
      expect(blob instanceof Blob).toBe(true);
    });
  });
});

describe("LogEntry 类型", () => {
  it("应该验证日志条目结构", () => {
    const entry: LogEntry = {
      id: "1",
      timestamp: "2026-02-04T14:30:25Z",
      level: "info",
      message: "测试消息",
      source: "test",
      details: { key: "value" },
    };

    expect(entry.id).toBe("1");
    expect(entry.level).toBe("info");
    expect(entry.message).toBe("测试消息");
  });

  it("应该支持可选字段", () => {
    const minimalEntry: LogEntry = {
      id: "1",
      timestamp: "2026-02-04T14:30:25Z",
      level: "error",
      message: "错误消息",
    };

    expect(minimalEntry.source).toBeUndefined();
    expect(minimalEntry.details).toBeUndefined();
  });
});

describe("LogFilter 类型", () => {
  it("应该支持所有过滤选项", () => {
    const filter: LogFilter = {
      level: "error",
      keyword: "测试",
      startTime: "2026-02-04T00:00:00Z",
      endTime: "2026-02-04T23:59:59Z",
      source: "system",
    };

    expect(filter.level).toBe("error");
    expect(filter.keyword).toBe("测试");
  });

  it("应该支持空过滤", () => {
    const filter: LogFilter = {};
    expect(filter.level).toBeUndefined();
    expect(filter.keyword).toBeUndefined();
  });
});
