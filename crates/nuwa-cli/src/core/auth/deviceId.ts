import { createHash } from "node:crypto";
import * as os from "node:os";
// node-machine-id is CJS; its named exports aren't statically detected by
// Node's ESM interop (cjs-module-lexer), so import the default and destructure.
import nodeMachineId from "node-machine-id";
const { machineIdSync } = nodeMachineId;

/**
 * Same formula as the Electron client's docs/architecture/device-id.md
 * (deviceId = sha256(machineId + salt)), but with a distinct salt so the CLI
 * registers as its own device rather than colliding with an Electron install
 * on the same machine.
 */
const APP_SALT = "nuwax-agent-cli";

let cached: string | null = null;

export function getDeviceId(): string {
  if (cached) return cached;
  let raw: string;
  try {
    raw = machineIdSync(true);
  } catch {
    raw = os.hostname();
  }
  cached = createHash("sha256")
    .update(raw + APP_SALT)
    .digest("hex");
  return cached;
}
