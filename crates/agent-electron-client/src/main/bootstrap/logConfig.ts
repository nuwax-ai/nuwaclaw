/**
 * 主进程日志配置：按日分割、大小轮转、TTL 清理，开发/正式环境区分
 *
 * - 按日分割：每日一个日志文件 main.YYYY-MM-DD.log
 * - 大小轮转：单日文件超 maxSize 时按序号轮转为 main.YYYY-MM-DD.N.log
 * - TTL：启动时删除 logs 目录下超过有效期的归档文件
 * - latest.log：符号链接（或 Windows 硬链接）指向当日活跃日志
 * - 开发：文件级别 debug、更长保留期；正式：info、更短保留期
 */

import log from "electron-log";
import * as path from "path";
import * as fs from "fs";
import { app } from "electron";
import {
  APP_DATA_DIR_NAME,
  LOGS_DIR_NAME,
  PERF_LOG_FILENAME_PREFIX,
} from "../services/constants";

/** 开发环境：未打包或 NODE_ENV=development */
function isDev(): boolean {
  return process.env.NODE_ENV === "development" || !app.isPackaged;
}

/** 单文件最大字节数：默认 100MB */
const MAX_SIZE_DEV = 100 * 1024 * 1024;
const MAX_SIZE_PROD = 100 * 1024 * 1024;
// 验证轮转时可将上面两行临时改为 50 * 1024（50KB），重启后打日志即可触发轮转，验证完改回

/** 归档日志保留时间（毫秒）：开发 30 天，正式 7 天 */
const TTL_MS_DEV = 30 * 24 * 60 * 60 * 1000;
const TTL_MS_PROD = 7 * 24 * 60 * 60 * 1000;

/** 返回当天日期字符串 YYYY-MM-DD */
function todayDateStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** 转义正则特殊字符 */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** 追踪当前日期，用于检测跨午夜切换 */
let lastDateStr = "";

/**
 * 视为归档的日志文件名模式，用于 TTL 清理：
 * - main.YYYY-MM-DD.log（非当日）
 * - main.YYYY-MM-DD.N.log（大小轮转）
 * - main.YYYY-MM-DD-HHmmss.log（旧格式兼容）
 * - main.YYYY-MM-DD.legacy.log（旧 main.log 迁移）
 * - main.old.log / renderer.old.log
 * - main.log（旧格式，迁移后残留）
 *
 * 不视为归档：
 * - main.{todayDateStr()}.log（当日活跃日志）
 * - renderer.log
 * - latest.log
 * - mcp-proxy-*.log
 */
function isArchiveLogName(name: string): boolean {
  const n = name.toLowerCase();
  // 旧格式 .old.log
  if (n === "main.old.log" || n === "renderer.old.log") return true;
  if (!n.endsWith(".log")) return false;
  // 当前 renderer 不归档
  if (n === "renderer.log") return false;
  // 旧 main.log（迁移后残留）视为归档
  if (n === "main.log") return true;
  // 当日活跃日志不归档
  const today = todayDateStr();
  if (n === `main.${today}.log`) return false;
  if (n === `${PERF_LOG_FILENAME_PREFIX}.${today}.log`) return false;
  // main.* / perf.* 开头的其他日志都视为归档
  return (
    n.startsWith("main.") ||
    n.startsWith("renderer.") ||
    n.startsWith(`${PERF_LOG_FILENAME_PREFIX}.`)
  );
}

const LATEST_LOG_FILENAME = "latest.log";

/**
 * 使 latest.log 指向当日活跃日志 main.YYYY-MM-DD.log
 * - macOS/Linux：符号链接（相对路径）
 * - Windows：硬链接
 */
function updateLatestLog(logDir: string): void {
  const dateStr = todayDateStr();
  const mainName = `main.${dateStr}.log`;
  const mainPath = path.join(logDir, mainName);
  if (!fs.existsSync(mainPath)) return;
  const latestPath = path.join(logDir, LATEST_LOG_FILENAME);
  try {
    // 用 lstatSync 检测：existsSync 对 dangling symlink 返回 false，导致无法删除旧链接
    try {
      fs.lstatSync(latestPath);
      fs.unlinkSync(latestPath);
    } catch {
      /* 不存在 */
    }
    if (process.platform === "win32") {
      fs.linkSync(mainPath, latestPath);
    } else {
      fs.symlinkSync(mainName, latestPath, "file");
    }
  } catch (e) {
    log.warn("[LogConfig] latest.log create/update failed:", e);
  }
}

/**
 * 带重试的 updateLatestLog，确保日志文件已创建后再建立链接
 * Windows 平台：electron-log 轮转后异步创建新文件，可能需要等待
 */
function updateLatestLogWithRetry(
  logDir: string,
  retries = 20,
  delayMs = 100,
): void {
  const dateStr = todayDateStr();
  const mainPath = path.join(logDir, `main.${dateStr}.log`);

  if (fs.existsSync(mainPath)) {
    updateLatestLog(logDir);
    return;
  }

  if (retries > 0) {
    setTimeout(
      () => updateLatestLogWithRetry(logDir, retries - 1, delayMs),
      delayMs,
    );
  } else {
    log.warn(
      `[LogConfig] latest.log update failed: main.${dateStr}.log does not exist, retries exhausted`,
    );
  }
}

/**
 * 删除 logDir 下过期的归档日志
 */
function cleanupOldLogs(logDir: string, maxAgeMs: number): void {
  if (!fs.existsSync(logDir)) return;
  const now = Date.now();
  const entries = fs.readdirSync(logDir, { withFileTypes: true });
  for (const e of entries) {
    if (!e.isFile()) continue;
    if (!isArchiveLogName(e.name)) continue;
    const fullPath = path.join(logDir, e.name);
    try {
      const stat = fs.statSync(fullPath);
      if (now - stat.mtimeMs > maxAgeMs) {
        fs.unlinkSync(fullPath);
        log.info("[LogConfig] Deleted expired log:", e.name);
      }
    } catch (err) {
      log.warn("[LogConfig] Failed to clean log:", e.name, err);
    }
  }
}

/**
 * 旧 main.log 一次性迁移：按 mtime 重命名为 main.YYYY-MM-DD.legacy.log
 */
function migrateOldMainLog(logDir: string): void {
  const oldMainPath = path.join(logDir, "main.log");
  if (!fs.existsSync(oldMainPath)) return;
  try {
    const stat = fs.statSync(oldMainPath);
    const mtime = stat.mtime;
    const dateStr = `${mtime.getFullYear()}-${String(mtime.getMonth() + 1).padStart(2, "0")}-${String(mtime.getDate()).padStart(2, "0")}`;
    const legacyName = `main.${dateStr}.legacy.log`;
    const legacyPath = path.join(logDir, legacyName);
    fs.renameSync(oldMainPath, legacyPath);
    log.info("[LogConfig] Old main.log migrated to:", legacyName);
  } catch (e) {
    log.warn("[LogConfig] Old main.log migration failed:", e);
  }
}

// ==================== PERF 专用日志 ====================

let _perfLogger: ReturnType<typeof log.create> | null = null;

/**
 * 初始化 PERF 专用 logger，写入 perf.YYYY-MM-DD.log
 * 由 initLogging() 内部调用，logDir 已保证存在
 */
function initPerfLogging(logDir: string): void {
  _perfLogger = log.create({ logId: "perf" });
  _perfLogger.transports.file.resolvePathFn = () => {
    const dateStr = todayDateStr();
    return path.join(logDir, `${PERF_LOG_FILENAME_PREFIX}.${dateStr}.log`);
  };
  // perf 日志无论开发/正式均写 info 级别（性能数据本身有价值）
  _perfLogger.transports.file.level = "info";
  // 不重复打到控制台（main logger 已输出）；electron-log v5 level=false 禁用该 transport
  (_perfLogger.transports.console as any).level = false;
  _perfLogger.transports.file.maxSize = 50 * 1024 * 1024;
}

/**
 * 获取 PERF 专用 logger（main 进程使用）
 * 若 initLogging() 未调用（如测试环境），返回默认 log 作为降级
 */
export function getPerfLogger(): ReturnType<typeof log.create> {
  return _perfLogger ?? log;
}

/**
 * 初始化 electron-log 文件输出：按日分割、大小轮转、TTL 清理
 */
export function initLogging(): void {
  const dev = isDev();
  const nuwaxHome = path.join(app.getPath("home"), APP_DATA_DIR_NAME);
  const logDir = path.join(nuwaxHome, LOGS_DIR_NAME);

  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }

  // 按日分割：写入 main.YYYY-MM-DD.log，跨午夜自动切换
  log.transports.file.resolvePathFn = () => {
    const dateStr = todayDateStr();
    if (dateStr !== lastDateStr) {
      lastDateStr = dateStr;
      setImmediate(() => updateLatestLogWithRetry(logDir));
    }
    return path.join(logDir, `main.${dateStr}.log`);
  };

  // 开发：文件打 debug；正式：文件打 info。控制台始终可看 debug
  log.transports.file.level = dev ? "debug" : "info";
  log.transports.console.level = "debug";

  const maxSize = dev ? MAX_SIZE_DEV : MAX_SIZE_PROD;
  const ttlMs = dev ? TTL_MS_DEV : TTL_MS_PROD;

  log.transports.file.maxSize = maxSize;

  // 大小轮转：当日文件超 maxSize 时，扫描目录找最大序号 N，重命名为 main.YYYY-MM-DD.(N+1).log
  let isArchiving = false;
  log.transports.file.archiveLogFn = (oldLogFile: {
    path: string;
    crop?: (n: number) => void;
  }) => {
    // 防止重入：catch 中的日志写入会再次触发 archiveLogFn，导致无限递归
    if (isArchiving) {
      oldLogFile.crop?.(256 * 1024);
      return;
    }
    isArchiving = true;
    try {
      const oldPath = oldLogFile.path;
      const parsed = path.parse(oldPath);
      // 从当前文件名提取日期（main.YYYY-MM-DD.log → YYYY-MM-DD）
      const baseMatch = parsed.name.match(/^main\.(\d{4}-\d{2}-\d{2})$/);
      const dateStr = baseMatch ? baseMatch[1] : todayDateStr();

      // 扫描目录找当日最大序号
      let maxSeq = 0;
      try {
        const seqPattern = new RegExp(
          `^main\\.${escapeRegExp(dateStr)}\\.(\\d+)\\.log$`,
        );
        const files = fs.readdirSync(parsed.dir);
        for (const f of files) {
          const m = f.match(seqPattern);
          if (m) {
            const seq = parseInt(m[1], 10);
            if (seq > maxSeq) maxSeq = seq;
          }
        }
      } catch {
        // 目录读取失败，从 1 开始
      }

      const newSeq = maxSeq + 1;
      const archiveName = `main.${dateStr}.${newSeq}.log`;
      const archivePath = path.join(parsed.dir, archiveName);
      try {
        fs.renameSync(oldPath, archivePath);
        log.info("[LogConfig] Log rotated:", archiveName);
        // Windows 硬链接指向 inode，轮转后需重新让 latest.log 指向新文件
        if (process.platform === "win32") {
          updateLatestLogWithRetry(parsed.dir);
        }
      } catch (e) {
        log.warn("[LogConfig] Rotation failed, attempting truncation:", e);
        const quarter = Math.round(maxSize / 4);
        oldLogFile.crop?.(Math.min(quarter, 256 * 1024));
      }
    } finally {
      isArchiving = false;
    }
  };

  // 旧 main.log 一次性迁移（必须在 TTL 清理之前，避免旧文件被直接删除）
  migrateOldMainLog(logDir);

  // 启动时按 TTL 清理过期归档
  cleanupOldLogs(logDir, ttlMs);

  log.info(
    "[LogConfig] 日志已初始化",
    dev ? "(开发)" : "(正式)",
    "fileLevel=",
    log.transports.file.level,
    "maxSize=",
    Math.round(maxSize / 1024 / 1024) + "MB",
    "ttlDays=",
    Math.round(ttlMs / (24 * 60 * 60 * 1000)),
  );

  // 首次写入后让 latest.log 指向当日日志
  updateLatestLogWithRetry(logDir);

  // 初始化 perf 专用日志
  initPerfLogging(logDir);
}

/** 供 IPC/客户端解析：优先读取的日志入口文件名（始终为当前主进程日志） */
export const LATEST_LOG_BASENAME = LATEST_LOG_FILENAME;

// ==================== 结构化日志 ====================

export type LogLevel = "debug" | "info" | "warn" | "error";
export type LogService =
  | "engine"
  | "sandbox"
  | "mcp"
  | "harness"
  | "ipc"
  | "db"
  | "system"
  | "app";

export interface StructuredLogEntry {
  timestamp: string;
  level: LogLevel;
  service: LogService;
  message: string;
  sessionId?: string;
  taskId?: string;
  traceId?: string;
  data?: Record<string, unknown>;
}

/**
 * 写出结构化 JSON 日志行（同时也通过 electron-log 写入普通日志文件）。
 * 格式：一行 JSON，便于 grep / jq 分析。
 *
 * 使用示例：
 *   structuredLog("info", "harness", "Task created", { taskId: id });
 *   structuredLog("error", "engine", "ACP crash", { sessionId, error: e.message });
 */
export function structuredLog(
  level: LogLevel,
  service: LogService,
  message: string,
  extra?: {
    sessionId?: string;
    taskId?: string;
    traceId?: string;
    data?: Record<string, unknown>;
  },
): void {
  const entry: StructuredLogEntry = {
    timestamp: new Date().toISOString(),
    level,
    service,
    message,
    ...extra,
  };

  // 写入普通日志（同步，保证顺序一致）
  const logLine = `[structured] ${JSON.stringify(entry)}`;
  switch (level) {
    case "debug":
      log.debug(logLine);
      break;
    case "info":
      log.info(logLine);
      break;
    case "warn":
      log.warn(logLine);
      break;
    case "error":
      log.error(logLine);
      break;
  }
}
