import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import * as fs from "node:fs";
import { buildCliChildEnv } from "../env/inheritEnv.js";
import {
  resolveDefaultLanproxyBinary,
  resolveLanproxyBinary,
} from "./lanproxyBinary.js";

export interface LanproxyStartOptions {
  pathOverride?: string;
  serverHost: string;
  serverPort: number;
  clientKey: string;
  ssl?: boolean;
}

export interface LanproxyHandle {
  pid?: number;
  command: string;
  args: string[];
  stop: () => void;
}

function normalizeServerHostForLanproxy(serverHost: string): string {
  return serverHost.replace(/^https?:\/\//i, "").replace(/\/+$/, "");
}

export function startLanproxy(options: LanproxyStartOptions): LanproxyHandle {
  const command = options.pathOverride
    ? resolveLanproxyBinary(options.pathOverride)
    : resolveDefaultLanproxyBinary();
  if (process.platform !== "win32") {
    try {
      fs.chmodSync(command, 0o755);
    } catch {
      // Best-effort: packaged resources may already be executable or readonly.
    }
  }

  const args = [
    "-s",
    normalizeServerHostForLanproxy(options.serverHost),
    "-p",
    String(options.serverPort),
    "-k",
    options.clientKey,
    `--ssl=${options.ssl !== false}`,
  ];
  const proc = spawn(command, args, {
    env: buildCliChildEnv(),
    stdio: "ignore",
  }) as ChildProcessWithoutNullStreams;

  return {
    pid: proc.pid,
    command,
    args,
    stop: () => {
      if (!proc.killed) proc.kill();
    },
  };
}
