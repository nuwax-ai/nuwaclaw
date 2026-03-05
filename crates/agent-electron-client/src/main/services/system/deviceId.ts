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
    log.warn("[DeviceId] Failed to read machineId, using hostname fallback:", e);
    raw = os.hostname();
  }

  cachedDeviceId = createHash("sha256")
    .update(raw + APP_SALT)
    .digest("hex");

  log.info(`[DeviceId] ${cachedDeviceId}`);
  return cachedDeviceId;
}
