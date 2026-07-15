import { spawn, spawnSync } from "node:child_process";
import * as path from "node:path";
import { resolveInstalledPackageEntry } from "../engines/packageResolve.js";
import { buildCliChildEnv } from "../env/inheritEnv.js";
import { ensureDir, logsDir, tmpDir, workspacesDir } from "../../util/paths.js";

const NUWAX_FILE_SERVER_ENTRY = "nuwax-file-server/dist/cli.js";

function resolveFileServerBin(): string {
  return resolveInstalledPackageEntry(
    "nuwax-file-server",
    NUWAX_FILE_SERVER_ENTRY,
  );
}

export function buildFileServerEnv(
  port: number,
  baseWorkspaceDir = workspacesDir(),
): NodeJS.ProcessEnv {
  const dir = path.join(tmpDir(), `file-server-${port}`);
  const workspaceBase = path.resolve(baseWorkspaceDir);
  const projectSourceDir = path.join(workspaceBase, "project_workspace");
  const uploadProjectDir = path.join(tmpDir(), "file-server-project-zips");
  const distTargetDir = path.join(tmpDir(), "file-server-dist");
  const projectLogDir = path.join(logsDir(), "file-server", "project_logs");
  const computerLogDir = path.join(logsDir(), "file-server", "computer_logs");
  ensureDir(dir);
  ensureDir(workspaceBase);
  ensureDir(projectSourceDir);
  ensureDir(uploadProjectDir);
  ensureDir(distTargetDir);
  ensureDir(projectLogDir);
  ensureDir(computerLogDir);
  return buildCliChildEnv({
    TMPDIR: dir,
    TMP: dir,
    TEMP: dir,
    COMPUTER_WORKSPACE_DIR: workspaceBase,
    PROJECT_SOURCE_DIR: projectSourceDir,
    UPLOAD_PROJECT_DIR: uploadProjectDir,
    DIST_TARGET_DIR: distTargetDir,
    LOG_BASE_DIR: projectLogDir,
    COMPUTER_LOG_DIR: computerLogDir,
  });
}

export function startFileServer(port: number, baseWorkspaceDir?: string): void {
  const bin = resolveFileServerBin();
  const proc = spawn(process.execPath, [bin, "start", "--port", String(port)], {
    env: buildFileServerEnv(port, baseWorkspaceDir),
    stdio: "ignore",
    detached: true,
  });
  proc.unref();
}

export function stopFileServer(port: number, baseWorkspaceDir?: string): void {
  let bin: string;
  try {
    bin = resolveFileServerBin();
  } catch {
    return;
  }
  spawnSync(process.execPath, [bin, "stop"], {
    env: buildFileServerEnv(port, baseWorkspaceDir),
    stdio: "ignore",
  });
}
