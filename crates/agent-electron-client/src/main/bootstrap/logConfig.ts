/**
 * 主进程日志配置：轮转、容量上限、按时间清理，开发/正式环境区分
 *
 * - 轮转：单文件超过 maxSize 时归档为 main.YYYY-MM-DD-HHmmss.log，避免 main.log 无限膨胀
 * - TTL：启动时删除 logs 目录下超过有效期的归档文件（及 main.old.log）
 * - 开发：文件级别 debug、更大 maxSize、更长保留期；正式：info、更小 maxSize、更短保留期
 */

import log from "electron-log";
import * as path from "path";
import * as fs from "fs";
import { app } from "electron";
import { APP_DATA_DIR_NAME, LOGS_DIR_NAME } from "../services/constants";

/** 开发环境：未打包或 NODE_ENV=development */
function isDev(): boolean {
  return process.env.NODE_ENV === "development" || !app.isPackaged;
}

/** 单文件最大字节数：默认 100MB */
const MAX_SIZE_DEV = 100 * 1024 * 1024;
const MAX_SIZE_PROD = 100 * 1024 * 1024;
// 验证轮转时可将上面两行临时改为 50 * 1024（50KB），重启后打日志即可触发 main.YYYY-MM-DD-HHmmss.log，验证完改回

/** 归档日志保留时间（毫秒）：开发 30 天，正式 7 天 */
const TTL_MS_DEV = 30 * 24 * 60 * 60 * 1000;
const TTL_MS_PROD = 7 * 24 * 60 * 60 * 1000;

/** 归档文件名时间戳格式 */
const ARCHIVE_TIME_FORMAT = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}-` +
  `${String(d.getHours()).padStart(2, "0")}${String(d.getMinutes()).padStart(2, "0")}${String(d.getSeconds()).padStart(2, "0")}`;

/** 视为归档的日志文件名模式：main/renderer 的 .old.log 或 .YYYY-MM-DD-*.log，不包含当前 main.log / renderer.log */
function isArchiveLogName(name: string): boolean {
  const n = name.toLowerCase();
  if (n === "main.old.log" || n === "renderer.old.log") return true;
  if (!n.endsWith(".log")) return false;
  if (n === "main.log" || n === "renderer.log") return false;
  return n.startsWith("main.") || n.startsWith("renderer.");
}

const LATEST_LOG_FILENAME = "latest.log";

/**
 * 使 latest.log 指向当前 main.log，便于用户与客户端只关注一个入口。
 * - macOS/Linux：创建符号链接 latest.log -> main.log（相对路径），轮转后新 main.log 自动被指向，无需更新。
 * - Windows：创建硬链接 latest.log（无权限要求）；轮转后需在 setImmediate 中重新创建，因硬链接指向 inode。
 */
function updateLatestLog(logDir: string): void {
  const mainPath = path.join(logDir, "main.log");
  if (!fs.existsSync(mainPath)) return;
  const latestPath = path.join(logDir, LATEST_LOG_FILENAME);
  try {
    if (fs.existsSync(latestPath)) fs.unlinkSync(latestPath);
    if (process.platform === "win32") {
      fs.linkSync(mainPath, latestPath);
    } else {
      fs.symlinkSync("main.log", latestPath, "file");
    }
  } catch (e) {
    log.warn("[LogConfig] latest.log 创建/更新失败:", e);
  }
}

/**
 * 带重试的 updateLatestLog，确保在日志轮转后正确指向新的 main.log
 * Windows 平台：electron-log 轮转后异步创建新文件，可能需要等待
 *
 * 默认参数：重试 20 次，每次间隔 100ms，总等待时间最多 2 秒
 * 这个容错区间可以应对大多数慢磁盘或高负载场景
 */
function updateLatestLogWithRetry(
  logDir: string,
  retries = 20,
  delayMs = 100,
): void {
  const mainPath = path.join(logDir, "main.log");

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
      "[LogConfig] latest.log 更新失败：main.log 不存在，重试次数已用完",
    );
  }
}

/**
 * 删除 logDir 下过期的归档日志（main/renderer 的 .old.log、.YYYY-MM-DD-*.log），不删当前 main.log / renderer.log
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
        log.info("[LogConfig] 已删除过期日志:", e.name);
      }
    } catch (err) {
      log.warn("[LogConfig] 清理日志失败:", e.name, err);
    }
  }
}

/**
 * 初始化 electron-log 文件输出：路径、大小轮转、自定义归档、按 TTL 清理
 */
export function initLogging(): void {
  const dev = isDev();
  const nuwaxHome = path.join(app.getPath("home"), APP_DATA_DIR_NAME);
  const logDir = path.join(nuwaxHome, LOGS_DIR_NAME);

  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }

  // 统一写入 ~/.nuwaclaw/logs/main.log
  log.transports.file.resolvePathFn = (variables) =>
    path.join(logDir, variables.fileName || "main.log");

  // 开发：文件打 debug；正式：文件打 info。控制台始终可看 debug
  log.transports.file.level = dev ? "debug" : "info";
  log.transports.console.level = "debug";

  const maxSize = dev ? MAX_SIZE_DEV : MAX_SIZE_PROD;
  const ttlMs = dev ? TTL_MS_DEV : TTL_MS_PROD;

  log.transports.file.maxSize = maxSize;

  // 轮转时归档为带时间戳的文件，便于 TTL 清理且不覆盖
  log.transports.file.archiveLogFn = (oldLogFile: {
    path: string;
    crop?: (n: number) => void;
  }) => {
    const oldPath = oldLogFile.path;
    const parsed = path.parse(oldPath);
    const archiveName = `${parsed.name}.${ARCHIVE_TIME_FORMAT(new Date())}${parsed.ext}`;
    const archivePath = path.join(parsed.dir, archiveName);
    try {
      fs.renameSync(oldPath, archivePath);
      log.info("[LogConfig] 日志已轮转:", archiveName);
      // Windows 硬链接指向 inode，轮转后需重新让 latest.log 指向新的 main.log
      // 使用带重试的版本，确保 electron-log 有足够时间创建新的 main.log
      if (process.platform === "win32") {
        updateLatestLogWithRetry(parsed.dir);
      }
    } catch (e) {
      log.warn("[LogConfig] 轮转失败，尝试截断:", e);
      const quarter = Math.round(maxSize / 4);
      oldLogFile.crop?.(Math.min(quarter, 256 * 1024));
    }
  };

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

  // 首次写入后让 latest.log 指向 main.log（使用带重试的版本确保 main.log 已存在）
  updateLatestLogWithRetry(logDir);
}

/** 供 IPC/客户端解析：优先读取的日志入口文件名（始终为当前主进程日志） */
export const LATEST_LOG_BASENAME = LATEST_LOG_FILENAME;
