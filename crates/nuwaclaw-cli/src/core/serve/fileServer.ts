import { spawn, spawnSync } from "node:child_process";
import * as path from "node:path";
import { resolveInstalledPackageEntry } from "../engines/packageResolve.js";
import { buildCliChildEnv } from "../env/inheritEnv.js";
import { ensureDir, tmpDir } from "../../util/paths.js";

const NUWAX_FILE_SERVER_ENTRY = "nuwax-file-server/dist/cli.js";

function resolveFileServerBin(): string {
  return resolveInstalledPackageEntry(
    "nuwax-file-server",
    NUWAX_FILE_SERVER_ENTRY,
  );
}

export function buildFileServerEnv(port: number): NodeJS.ProcessEnv {
  const dir = path.join(tmpDir(), `file-server-${port}`);
  ensureDir(dir);
  return buildCliChildEnv({
    TMPDIR: dir,
    TMP: dir,
    TEMP: dir,
  });
}

export function startFileServer(port: number): void {
  const bin = resolveFileServerBin();
  const proc = spawn(process.execPath, [bin, "start", "--port", String(port)], {
    env: buildFileServerEnv(port),
    stdio: "ignore",
    detached: true,
  });
  proc.unref();
}

export function stopFileServer(port: number): void {
  let bin: string;
  try {
    bin = resolveFileServerBin();
  } catch {
    return;
  }
  spawnSync(process.execPath, [bin, "stop"], {
    env: buildFileServerEnv(port),
    stdio: "ignore",
  });
}
