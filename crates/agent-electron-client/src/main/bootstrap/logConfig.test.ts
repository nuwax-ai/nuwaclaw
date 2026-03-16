/**
 * 单元测试: logConfig (日志按日分割 + 大小轮转)
 *
 * 覆盖:
 * 1. todayDateStr — 返回 YYYY-MM-DD 格式
 * 2. isArchiveLogName — 归档文件名判定（当日活跃、旧格式、轮转序号等）
 * 3. resolvePathFn — 按日路径 + 跨午夜切换
 * 4. archiveLogFn — 按序号轮转
 * 5. updateLatestLog / updateLatestLogWithRetry — 符号链接/硬链接
 * 6. migrateOldMainLog — 旧 main.log 一次性迁移
 * 7. cleanupOldLogs — TTL 清理（不删当日活跃日志）
 * 8. initLogging — 完整初始化流程
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as path from "path";

// ── Mocks ──────────────────────────────────────────────────

vi.mock("electron", () => ({
  app: {
    getPath: vi.fn(() => "/mock/home"),
    isPackaged: false,
  },
}));

const mockLog = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  transports: {
    file: {
      resolvePathFn: null as null | ((...args: unknown[]) => string),
      archiveLogFn: null as
        | null
        | ((oldLogFile: { path: string; crop?: (n: number) => void }) => void),
      level: "info",
      maxSize: 0,
    },
    console: {
      level: "debug",
    },
  },
};

vi.mock("electron-log", () => ({ default: mockLog }));

const mockExistsSync = vi.fn(() => false);
const mockMkdirSync = vi.fn();
const mockRenameSync = vi.fn();
const mockUnlinkSync = vi.fn();
const mockSymlinkSync = vi.fn();
const mockLinkSync = vi.fn();
const mockStatSync = vi.fn();
const mockLstatSync = vi.fn();
const mockReaddirSync = vi.fn((..._args: unknown[]) => [] as unknown[]);

vi.mock("fs", () => ({
  existsSync: (...args: unknown[]) => mockExistsSync(...(args as [string])),
  mkdirSync: (...args: unknown[]) => mockMkdirSync(...args),
  renameSync: (...args: unknown[]) => mockRenameSync(...args),
  unlinkSync: (...args: unknown[]) => mockUnlinkSync(...args),
  symlinkSync: (...args: unknown[]) => mockSymlinkSync(...args),
  linkSync: (...args: unknown[]) => mockLinkSync(...args),
  statSync: (...args: unknown[]) => mockStatSync(...args),
  lstatSync: (...args: unknown[]) => mockLstatSync(...args),
  readdirSync: (...args: unknown[]) => mockReaddirSync(...args),
}));

// ── Helpers ────────────────────────────────────────────────

/** 冻结 Date.now 和 new Date() 到指定日期 */
function freezeDate(dateStr: string) {
  const frozen = new Date(dateStr + "T12:00:00");
  vi.useFakeTimers();
  vi.setSystemTime(frozen);
}

const LOG_DIR = path.join("/mock/home", ".nuwaclaw", "logs");

// ── Tests ──────────────────────────────────────────────────

describe("logConfig", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    // Reset mock log transports
    mockLog.transports.file.resolvePathFn = null;
    mockLog.transports.file.archiveLogFn = null;
    mockLog.transports.file.level = "info";
    mockLog.transports.file.maxSize = 0;
    mockLog.transports.console.level = "debug";
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ── isArchiveLogName (通过 cleanupOldLogs 间接测试) ──

  describe("isArchiveLogName (归档文件名判定)", () => {
    /**
     * isArchiveLogName 是模块内部函数，通过 initLogging → cleanupOldLogs 间接验证。
     * 构造一个包含各种文件名的目录，验证哪些被删除（归档）、哪些保留。
     */

    it("应将非当日的 main.YYYY-MM-DD.log 视为归档", async () => {
      freezeDate("2026-03-16");

      const now = Date.now();
      const oldMtime = now - 40 * 24 * 60 * 60 * 1000; // 40 天前，超过 TTL

      // logDir 存在
      mockExistsSync.mockReturnValue(true);

      // 模拟目录内容
      mockReaddirSync.mockReturnValue([
        { name: "main.2026-03-16.log", isFile: () => true }, // 当日活跃 → 不删
        { name: "main.2026-03-10.log", isFile: () => true }, // 非当日 → 归档
        { name: "main.2026-03-10.1.log", isFile: () => true }, // 轮转文件 → 归档
        { name: "main.2026-03-10.2.log", isFile: () => true }, // 轮转文件 → 归档
        { name: "main.2026-02-01-143022.log", isFile: () => true }, // 旧格式 → 归档
        { name: "main.2026-02-01.legacy.log", isFile: () => true }, // 迁移文件 → 归档
        { name: "main.log", isFile: () => true }, // 旧格式残留 → 归档
        { name: "main.old.log", isFile: () => true }, // 旧 .old → 归档
        { name: "renderer.log", isFile: () => true }, // 当前 renderer → 不删
        { name: "latest.log", isFile: () => false }, // symlink → isFile=false → 跳过
        { name: "mcp-proxy.log", isFile: () => true }, // 不以 main./renderer. 开头 → 不删
      ]);

      // statSync 返回超过 TTL 的 mtime
      mockStatSync.mockReturnValue({ mtimeMs: oldMtime });

      const { initLogging } = await import("./logConfig");
      initLogging();

      // 应删除的文件（归档 + 超 TTL）
      const deletedFiles = mockUnlinkSync.mock.calls.map((call) =>
        path.basename(call[0] as string),
      );

      expect(deletedFiles).toContain("main.2026-03-10.log");
      expect(deletedFiles).toContain("main.2026-03-10.1.log");
      expect(deletedFiles).toContain("main.2026-03-10.2.log");
      expect(deletedFiles).toContain("main.2026-02-01-143022.log");
      expect(deletedFiles).toContain("main.2026-02-01.legacy.log");
      expect(deletedFiles).toContain("main.log");
      expect(deletedFiles).toContain("main.old.log");

      // 不应删除的文件（排除 updateLatestLog 中对 latest.log 的 unlink）
      const cleanupDeleted = deletedFiles.filter((f) => f !== "latest.log");
      expect(cleanupDeleted).not.toContain("main.2026-03-16.log");
      expect(cleanupDeleted).not.toContain("renderer.log");
      expect(deletedFiles).not.toContain("mcp-proxy.log");
    });

    it("不应删除未超过 TTL 的归档文件", async () => {
      freezeDate("2026-03-16");

      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockReturnValue([
        { name: "main.2026-03-15.log", isFile: () => true },
      ]);

      // mtime = 1 天前，未超过 30 天 TTL（dev 模式）
      const recentMtime = Date.now() - 1 * 24 * 60 * 60 * 1000;
      mockStatSync.mockReturnValue({ mtimeMs: recentMtime });

      const { initLogging } = await import("./logConfig");
      initLogging();

      // statSync 被调用了（说明识别为归档），但未删除（未超 TTL）
      const deletedFiles = mockUnlinkSync.mock.calls.map((call) =>
        path.basename(call[0] as string),
      );
      expect(deletedFiles).not.toContain("main.2026-03-15.log");
    });
  });

  // ── resolvePathFn (按日路径) ──

  describe("resolvePathFn (按日路径)", () => {
    it("应返回 main.YYYY-MM-DD.log 路径", async () => {
      freezeDate("2026-03-16");
      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockReturnValue([]);

      const { initLogging } = await import("./logConfig");
      initLogging();

      const resolvePathFn = mockLog.transports.file.resolvePathFn!;
      expect(resolvePathFn).toBeDefined();

      const result = resolvePathFn();
      expect(result).toBe(path.join(LOG_DIR, "main.2026-03-16.log"));
    });

    it("跨午夜应切换到新日期文件", async () => {
      freezeDate("2026-03-16");
      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockReturnValue([]);

      const { initLogging } = await import("./logConfig");
      initLogging();

      const resolvePathFn = mockLog.transports.file.resolvePathFn!;

      // 第一次调用：2026-03-16
      const result1 = resolvePathFn();
      expect(result1).toBe(path.join(LOG_DIR, "main.2026-03-16.log"));

      // 模拟跨午夜
      vi.setSystemTime(new Date("2026-03-17T00:00:01"));

      const result2 = resolvePathFn();
      expect(result2).toBe(path.join(LOG_DIR, "main.2026-03-17.log"));
    });
  });

  // ── archiveLogFn (按序号轮转) ──

  describe("archiveLogFn (大小轮转)", () => {
    it("首次轮转应生成序号 1", async () => {
      freezeDate("2026-03-16");
      mockExistsSync.mockReturnValue(true);
      // 目录中没有已有的轮转文件
      mockReaddirSync.mockReturnValue([]);

      const { initLogging } = await import("./logConfig");
      initLogging();

      const archiveLogFn = mockLog.transports.file.archiveLogFn!;
      expect(archiveLogFn).toBeDefined();

      const oldPath = path.join(LOG_DIR, "main.2026-03-16.log");
      archiveLogFn({ path: oldPath });

      expect(mockRenameSync).toHaveBeenCalledWith(
        oldPath,
        path.join(LOG_DIR, "main.2026-03-16.1.log"),
      );
    });

    it("已有序号 1 和 2 时，应生成序号 3", async () => {
      freezeDate("2026-03-16");
      mockExistsSync.mockReturnValue(true);

      const dirFiles = [
        "main.2026-03-16.1.log",
        "main.2026-03-16.2.log",
        "main.2026-03-16.log",
      ];

      mockReaddirSync.mockImplementation((...args: unknown[]) => {
        const opts = args[1];
        // cleanupOldLogs 调用 readdirSync(dir, { withFileTypes: true })
        if (
          opts &&
          typeof opts === "object" &&
          (opts as Record<string, unknown>).withFileTypes
        ) {
          return dirFiles.map((name) => ({ name, isFile: () => true }));
        }
        // archiveLogFn 调用 readdirSync(dir)（返回字符串数组）
        return dirFiles;
      });
      mockStatSync.mockReturnValue({ mtimeMs: Date.now() });

      const { initLogging } = await import("./logConfig");
      initLogging();

      const archiveLogFn = mockLog.transports.file.archiveLogFn!;
      const oldPath = path.join(LOG_DIR, "main.2026-03-16.log");
      archiveLogFn({ path: oldPath });

      expect(mockRenameSync).toHaveBeenCalledWith(
        oldPath,
        path.join(LOG_DIR, "main.2026-03-16.3.log"),
      );
    });

    it("不应混淆其他日期的序号", async () => {
      freezeDate("2026-03-16");
      mockExistsSync.mockReturnValue(true);

      const dirFiles = [
        "main.2026-03-15.5.log", // 昨天的序号 5，不应影响今天
        "main.2026-03-16.log",
      ];

      mockReaddirSync.mockImplementation((...args: unknown[]) => {
        const opts = args[1];
        if (
          opts &&
          typeof opts === "object" &&
          (opts as Record<string, unknown>).withFileTypes
        ) {
          return dirFiles.map((name) => ({ name, isFile: () => true }));
        }
        return dirFiles;
      });
      mockStatSync.mockReturnValue({ mtimeMs: Date.now() });

      const { initLogging } = await import("./logConfig");
      initLogging();

      const archiveLogFn = mockLog.transports.file.archiveLogFn!;
      const oldPath = path.join(LOG_DIR, "main.2026-03-16.log");
      archiveLogFn({ path: oldPath });

      // 今天从序号 1 开始，不受昨天的序号 5 影响
      expect(mockRenameSync).toHaveBeenCalledWith(
        oldPath,
        path.join(LOG_DIR, "main.2026-03-16.1.log"),
      );
    });

    it("rename 失败时应调用 crop 截断", async () => {
      freezeDate("2026-03-16");
      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockReturnValue([]);
      mockRenameSync.mockImplementation(() => {
        throw new Error("EPERM");
      });

      const { initLogging } = await import("./logConfig");
      initLogging();

      // 清掉 initLogging 阶段的 renameSync 调用（migrateOldMainLog 等）
      mockRenameSync.mockClear();
      mockRenameSync.mockImplementation(() => {
        throw new Error("EPERM");
      });

      const archiveLogFn = mockLog.transports.file.archiveLogFn!;
      const cropFn = vi.fn();
      const oldPath = path.join(LOG_DIR, "main.2026-03-16.log");
      archiveLogFn({ path: oldPath, crop: cropFn });

      expect(cropFn).toHaveBeenCalled();
      expect(mockLog.warn).toHaveBeenCalledWith(
        expect.stringContaining("轮转失败"),
        expect.anything(),
      );
    });
  });

  // ── updateLatestLog (符号链接) ──

  describe("updateLatestLog (latest.log 链接)", () => {
    it("macOS/Linux 应创建指向当日文件的符号链接", async () => {
      freezeDate("2026-03-16");

      // 保存并模拟 platform
      const originalPlatform = process.platform;
      Object.defineProperty(process, "platform", {
        value: "darwin",
        configurable: true,
      });

      mockExistsSync.mockImplementation((p: unknown) => {
        const s = p as string;
        // main.2026-03-16.log 存在
        if (s.endsWith("main.2026-03-16.log")) return true;
        // latest.log 不存在
        if (s.endsWith("latest.log")) return false;
        // logDir 存在
        return true;
      });
      mockReaddirSync.mockReturnValue([]);

      const { initLogging } = await import("./logConfig");
      initLogging();

      expect(mockSymlinkSync).toHaveBeenCalledWith(
        "main.2026-03-16.log",
        path.join(LOG_DIR, "latest.log"),
        "file",
      );

      Object.defineProperty(process, "platform", {
        value: originalPlatform,
        configurable: true,
      });
    });

    it("Windows 应创建硬链接", async () => {
      freezeDate("2026-03-16");

      const originalPlatform = process.platform;
      Object.defineProperty(process, "platform", {
        value: "win32",
        configurable: true,
      });

      mockExistsSync.mockImplementation((p: unknown) => {
        const s = p as string;
        if (s.endsWith("main.2026-03-16.log")) return true;
        if (s.endsWith("latest.log")) return false;
        return true;
      });
      mockReaddirSync.mockReturnValue([]);

      const { initLogging } = await import("./logConfig");
      initLogging();

      expect(mockLinkSync).toHaveBeenCalledWith(
        path.join(LOG_DIR, "main.2026-03-16.log"),
        path.join(LOG_DIR, "latest.log"),
      );

      Object.defineProperty(process, "platform", {
        value: originalPlatform,
        configurable: true,
      });
    });

    it("应先删除已有的 latest.log 再创建", async () => {
      freezeDate("2026-03-16");

      const originalPlatform = process.platform;
      Object.defineProperty(process, "platform", {
        value: "darwin",
        configurable: true,
      });

      mockExistsSync.mockImplementation((p: unknown) => {
        const s = p as string;
        if (s.endsWith("main.2026-03-16.log")) return true;
        if (s.endsWith("latest.log")) return true; // 已存在
        return true;
      });
      mockReaddirSync.mockReturnValue([]);

      const { initLogging } = await import("./logConfig");
      initLogging();

      // 应先 unlink 旧的 latest.log
      const unlinkCalls = mockUnlinkSync.mock.calls.map((c) => c[0] as string);
      expect(unlinkCalls).toContain(path.join(LOG_DIR, "latest.log"));

      // 再创建新的符号链接
      expect(mockSymlinkSync).toHaveBeenCalledWith(
        "main.2026-03-16.log",
        path.join(LOG_DIR, "latest.log"),
        "file",
      );

      Object.defineProperty(process, "platform", {
        value: originalPlatform,
        configurable: true,
      });
    });

    it("dangling symlink 应被正确替换", async () => {
      freezeDate("2026-03-16");

      const originalPlatform = process.platform;
      Object.defineProperty(process, "platform", {
        value: "darwin",
        configurable: true,
      });

      // existsSync 对 dangling symlink 返回 false（目标不存在）
      // lstatSync 对 dangling symlink 成功返回（链接本身存在）
      mockExistsSync.mockImplementation((p: unknown) => {
        const s = p as string;
        if (s.endsWith("main.2026-03-16.log")) return true;
        if (s.endsWith("latest.log")) return false; // dangling: 目标不存在
        return true;
      });
      mockLstatSync.mockImplementation((p: unknown) => {
        const s = p as string;
        if (s.endsWith("latest.log")) return {}; // lstat 成功 → 链接本身存在
        return {};
      });
      mockReaddirSync.mockReturnValue([]);

      const { initLogging } = await import("./logConfig");
      initLogging();

      // lstatSync 发现链接存在 → unlinkSync 删除 dangling symlink
      const unlinkCalls = mockUnlinkSync.mock.calls.map((c) => c[0] as string);
      expect(unlinkCalls).toContain(path.join(LOG_DIR, "latest.log"));

      // 再创建新的符号链接
      expect(mockSymlinkSync).toHaveBeenCalledWith(
        "main.2026-03-16.log",
        path.join(LOG_DIR, "latest.log"),
        "file",
      );

      Object.defineProperty(process, "platform", {
        value: originalPlatform,
        configurable: true,
      });
    });
  });

  // ── migrateOldMainLog (旧 main.log 迁移) ──

  describe("migrateOldMainLog (旧日志迁移)", () => {
    it("应将旧 main.log 按 mtime 重命名为 legacy 文件", async () => {
      freezeDate("2026-03-16");

      // main.log 存在
      mockExistsSync.mockImplementation((p: unknown) => {
        const s = p as string;
        if (s === path.join(LOG_DIR, "main.log")) return true;
        return true;
      });
      // main.log 的 mtime 是 2026-03-10
      const migrateMtime = new Date("2026-03-10T15:30:00");
      mockStatSync.mockImplementation((p: unknown) => {
        const s = p as string;
        if (s === path.join(LOG_DIR, "main.log")) {
          return { mtime: migrateMtime, mtimeMs: migrateMtime.getTime() };
        }
        return { mtimeMs: Date.now() };
      });
      mockReaddirSync.mockReturnValue([]);

      const { initLogging } = await import("./logConfig");
      initLogging();

      expect(mockRenameSync).toHaveBeenCalledWith(
        path.join(LOG_DIR, "main.log"),
        path.join(LOG_DIR, "main.2026-03-10.legacy.log"),
      );
    });

    it("旧 main.log 不存在时不应执行迁移", async () => {
      freezeDate("2026-03-16");

      mockExistsSync.mockImplementation((p: unknown) => {
        const s = p as string;
        if (s === path.join(LOG_DIR, "main.log")) return false;
        return true;
      });
      mockReaddirSync.mockReturnValue([]);

      const { initLogging } = await import("./logConfig");
      initLogging();

      // renameSync 不应被调用来迁移 main.log
      const renameCalls = mockRenameSync.mock.calls.map((c) =>
        path.basename(c[0] as string),
      );
      expect(renameCalls).not.toContain("main.log");
    });

    it("迁移应在 TTL 清理之前执行", async () => {
      freezeDate("2026-03-16");

      const callOrder: string[] = [];

      // main.log 存在
      mockExistsSync.mockReturnValue(true);

      mockStatSync.mockReturnValue({
        mtime: new Date("2026-01-01T00:00:00"),
        mtimeMs: new Date("2026-01-01").getTime(),
      });

      // 追踪 renameSync（迁移）和 readdirSync（清理）调用顺序
      mockRenameSync.mockImplementation((...args: unknown[]) => {
        const src = path.basename(args[0] as string);
        if (src === "main.log") {
          callOrder.push("migrate");
        }
      });

      mockReaddirSync.mockImplementation((...args: unknown[]) => {
        const dirPath = args[0] as string;
        if (dirPath === LOG_DIR && args[1]) {
          // readdirSync with withFileTypes → cleanupOldLogs
          callOrder.push("cleanup");
        }
        return [];
      });

      const { initLogging } = await import("./logConfig");
      initLogging();

      const migrateIdx = callOrder.indexOf("migrate");
      const cleanupIdx = callOrder.indexOf("cleanup");
      expect(migrateIdx).toBeGreaterThanOrEqual(0);
      expect(cleanupIdx).toBeGreaterThanOrEqual(0);
      expect(migrateIdx).toBeLessThan(cleanupIdx);
    });
  });

  // ── initLogging (完整初始化) ──

  describe("initLogging (完整初始化)", () => {
    it("应创建日志目录（如不存在）", async () => {
      freezeDate("2026-03-16");

      mockExistsSync.mockImplementation((p: unknown) => {
        const s = p as string;
        if (s === LOG_DIR) return false; // logDir 不存在
        return false;
      });
      mockReaddirSync.mockReturnValue([]);

      const { initLogging } = await import("./logConfig");
      initLogging();

      expect(mockMkdirSync).toHaveBeenCalledWith(LOG_DIR, { recursive: true });
    });

    it("应设置正确的 maxSize", async () => {
      freezeDate("2026-03-16");
      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockReturnValue([]);

      const { initLogging } = await import("./logConfig");
      initLogging();

      expect(mockLog.transports.file.maxSize).toBe(100 * 1024 * 1024);
    });

    it("应设置 file level 为 debug（开发模式）", async () => {
      freezeDate("2026-03-16");
      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockReturnValue([]);

      const { initLogging } = await import("./logConfig");
      initLogging();

      // app.isPackaged = false → dev mode → debug
      expect(mockLog.transports.file.level).toBe("debug");
    });

    it("应输出初始化日志", async () => {
      freezeDate("2026-03-16");
      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockReturnValue([]);

      const { initLogging } = await import("./logConfig");
      initLogging();

      expect(mockLog.info).toHaveBeenCalledWith(
        "[LogConfig] 日志已初始化",
        "(开发)",
        "fileLevel=",
        "debug",
        "maxSize=",
        "100MB",
        "ttlDays=",
        30,
      );
    });
  });
});
