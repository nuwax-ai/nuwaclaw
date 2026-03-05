import { machineIdSync } from "node-machine-id";
import { createHash } from "crypto";
import log from "electron-log";

const APP_SALT = "nuwax-agent";
let cachedDeviceId: string | null = null;

export function getDeviceId(): string {
  if (cachedDeviceId) return cachedDeviceId;

  const raw = machineIdSync(true);
  cachedDeviceId = createHash("sha256")
    .update(raw + APP_SALT)
    .digest("hex");

  log.info(`[DeviceId] ${cachedDeviceId}`);
  return cachedDeviceId;
}
