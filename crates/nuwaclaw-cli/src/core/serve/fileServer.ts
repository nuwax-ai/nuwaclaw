import { spawn, spawnSync } from "node:child_process";
import { resolveInstalledPackageEntry } from "../engines/packageResolve.js";

const NUWAX_FILE_SERVER_ENTRY = "nuwax-file-server/dist/cli.js";

function resolveFileServerBin(): string {
  return resolveInstalledPackageEntry(
    "nuwax-file-server",
    NUWAX_FILE_SERVER_ENTRY,
  );
}

export function startFileServer(port: number): void {
  const bin = resolveFileServerBin();
  const proc = spawn(process.execPath, [bin, "start", "--port", String(port)], {
    stdio: "ignore",
    detached: true,
  });
  proc.unref();
}

export function stopFileServer(): void {
  let bin: string;
  try {
    bin = resolveFileServerBin();
  } catch {
    return;
  }
  spawnSync(process.execPath, [bin, "stop"], { stdio: "ignore" });
}
