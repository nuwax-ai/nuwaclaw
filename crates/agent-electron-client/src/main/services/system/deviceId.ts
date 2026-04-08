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
  const { screen, app } = require("electron");
  const primary = screen.getPrimaryDisplay();
  log.info("[System]", {
    version: app.getVersion(),
    platform: process.platform,
    arch: os.arch(),
    release: os.release(),
    nodeVersion: process.versions.node,
    electronVersion: process.versions.electron,
    chromeVersion: process.versions.chrome,
    locale: os.locale(),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    cpuCount: os.cpus().length,
    totalMemoryGB: Math.round(os.totalmem() / 1024 / 1024 / 1024),
    freeMemoryGB: Math.round(os.freemem() / 1024 / 1024 / 1024),
    screen: `${primary.size.width}x${primary.size.height}@${primary.scaleFactor}x`,
    timestamp: Date.now(),
  });
}
