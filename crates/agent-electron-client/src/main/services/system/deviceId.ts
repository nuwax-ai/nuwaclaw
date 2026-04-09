import { machineIdSync } from "node-machine-id";
import { createHash } from "crypto";
import * as os from "os";
import log from "electron-log";

const APP_SALT = "nuwax-agent";
let cachedDeviceId: string | null = null;

export function getDeviceId(): string {
  if (cachedDeviceId) return cachedDeviceId;

  let raw: string;
  try {
    raw = machineIdSync(true);
  } catch (e) {
    log.warn(
      "[DeviceId] Failed to read machineId, using hostname fallback:",
      e,
    );
    raw = os.hostname();
  }

  cachedDeviceId = createHash("sha256")
    .update(raw + APP_SALT)
    .digest("hex");

  log.info(`[DeviceId] ${cachedDeviceId}`);
  return cachedDeviceId;
}

export function logSystemInfo(): void {
  // 固定字段尽量保持稳定输出，便于跨平台日志分析与检索。
  const baseInfo = {
    platform: process.platform,
    arch: os.arch(),
    release: os.release(),
    nodeVersion: process.versions.node,
    electronVersion: process.versions.electron,
    chromeVersion: process.versions.chrome,
    // 保留毫秒级时间戳，方便日志系统或外部工具做数值排序/聚合分析。
    timestamp: Date.now(),
    // 额外输出 UTC 时间字符串（ISO 8601），便于人工阅读与跨时区排查问题。
    // 例如：2026-04-09T08:12:34.567Z，其中 `Z` 代表 UTC（不受本地时区影响）。
    timestampUtc: new Date().toISOString(),
  };

  try {
    // `electron` 在极少数受限环境/初始化早期可能不可用；由外层 catch 统一降级。
    const electron = require("electron");
    const app = electron?.app;
    const screen = electron?.screen;
    const primary = screen?.getPrimaryDisplay?.();
    const screenInfo =
      primary?.size?.width && primary?.size?.height && primary?.scaleFactor
        ? `${primary.size.width}x${primary.size.height}@${primary.scaleFactor}x`
        : "unknown";
    const timezone =
      Intl.DateTimeFormat().resolvedOptions().timeZone || "unknown";
    const cpuCount = os.cpus()?.length ?? 0;
    const totalMemoryGB = Math.round(os.totalmem() / 1024 / 1024 / 1024);
    const freeMemoryGB = Math.round(os.freemem() / 1024 / 1024 / 1024);

    log.info("[System]", {
      ...baseInfo,
      version: app?.getVersion?.() ?? "unknown",
      locale: app?.getLocale?.() ?? "unknown",
      timezone,
      cpuCount,
      totalMemoryGB,
      freeMemoryGB,
      screen: screenInfo,
    });
  } catch (e) {
    // 系统信息采集仅用于诊断，任何异常都不应影响客户端启动和核心功能。
    log.warn("[System] Failed to collect system info:", e);
    // 即使进入降级路径，也要输出固定字段，避免日志结构缺失。
    log.info("[System]", {
      ...baseInfo,
      version: "unknown",
      locale: "unknown",
      timezone: "unknown",
      cpuCount: 0,
      totalMemoryGB: 0,
      freeMemoryGB: 0,
      screen: "unknown",
    });
  }
}
