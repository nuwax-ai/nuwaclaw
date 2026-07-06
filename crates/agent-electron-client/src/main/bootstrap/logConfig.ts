/**
 * 主进程日志配置：按日分割、TTL 清理，开发/正式环境区分
 *
 * - 按日分割：每日一个日志文件 main.YYYY-MM-DD.log（单文件大小不限制）
 * - TTL：启动时删除 logs 目录下超过有效期的归档文件
 * - latest.log：符号链接（或 Windows 硬链接）指向当日活跃日志
 * - 开发：文件级别 debug、更长保留期；正式：info、更短保留期
 *
 * 注意：已解决 EPIPE 无限循环问题，日志不会无限增长，无需总量限制
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

/** 归档日志保留时间（毫秒）：开发 30 天，正式 7 天 */
const TTL_MS_DEV = 30 * 24 * 60 * 60 * 1000;
const TTL_MS_PROD = 7 * 24 * 60 * 60 * 1000;

/** 返回当天日期字符串 YYYY-MM-DD */
function todayDateStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** 追踪当前日期，用于检测跨午夜切换 */
let lastDateStr = "";

/**
 * 视为归档的日志文件名模式，用于 TTL 清理：
 * - main.YYYY-MM-DD.log（非当日）
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
  // perf 日志大小不限制，与主日志保持一致
}

/**
 * 获取 PERF 专用 logger（main 进程使用）
 * 若 initLogging() 未调用（如测试环境），返回默认 log 作为降级
 */
export function getPerfLogger(): ReturnType<typeof log.create> {
  return _perfLogger ?? log;
}

/**
 * 初始化 electron-log 文件输出：按日分割、TTL 清理
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

  // 包装 console transport 的 writeFn，防止 EPIPE 错误导致无限循环
  const originalWriteFn = log.transports.console.writeFn;
  log.transports.console.writeFn = ({ message }) => {
    try {
      originalWriteFn({ message });
    } catch (error: unknown) {
      // 如果 console 写入失败（如 EPIPE），禁用 console transport
      const errorObj = error as { code?: string; message?: string };
      if (errorObj?.code === "EPIPE" || errorObj?.message?.includes("EPIPE")) {
        log.transports.console.level = false;
        // 尝试写入文件记录这个错误（使用预先导入的 fs 模块）
        try {
          const timestamp = new Date().toISOString();
          const logEntry = `[${timestamp}] WARN Console transport disabled due to EPIPE error\n`;
          fs.appendFileSync(
            path.join(logDir, `main.${todayDateStr()}.log`),
            logEntry,
          );
        } catch {
          // 忽略文件写入失败
        }
      }
    }
  };

  const ttlMs = dev ? TTL_MS_DEV : TTL_MS_PROD;

  // 按日分割：只保留按日分割，去掉大小轮转和单文件大小限制
  // 单文件大小不受限制，由 TTL 清理机制控制日志保留时间

  // 旧 main.log 一次性迁移（必须在 TTL 清理之前，避免旧文件被直接删除）
  migrateOldMainLog(logDir);

  // 启动时按 TTL 清理过期归档
  cleanupOldLogs(logDir, ttlMs);

  // 运行时定期清理：每小时检查一次，删除超过 TTL 的日志文件
  const runtimeCleanupInterval = setInterval(
    () => {
      try {
        cleanupOldLogs(logDir, ttlMs);
      } catch (e) {
        // 清理失败不影响主进程
      }
    },
    60 * 60 * 1000,
  ); // 1 小时

  // 应用退出时清理定时器
  app.on("will-quit", () => {
    clearInterval(runtimeCleanupInterval);
  });

  log.info(
    "[LogConfig] Logging initialized",
    dev ? "(development)" : "(production)",
    "fileLevel=",
    log.transports.file.level,
    "ttlDays=",
    Math.round(ttlMs / (24 * 60 * 60 * 1000)),
  );

  // 首次写入后让 latest.log 指向当日日志
  updateLatestLogWithRetry(logDir);

  // 初始化 perf 专用日志
  initPerfLogging(logDir);
}

/**
 * 更新日志级别（数据库初始化后调用）
 *
 * beta 通道：文件日志级别为 debug
 * stable 通道：文件日志级别为 info（开发环境为 debug）
 */
export function updateLogLevel(updateChannel: string): void {
  const isBeta = updateChannel === "beta";

  if (isBeta) {
    log.transports.file.level = "debug";
    log.info("[LogConfig] Beta channel: file log level set to debug");
  } else {
    const dev = isDev();
    log.transports.file.level = dev ? "debug" : "info";
    log.info(
      "[LogConfig] Stable channel: file log level set to",
      log.transports.file.level,
    );
  }
}

/** 供 IPC/客户端解析：优先读取的日志入口文件名（始终为当前主进程日志） */
export const LATEST_LOG_BASENAME = LATEST_LOG_FILENAME;
