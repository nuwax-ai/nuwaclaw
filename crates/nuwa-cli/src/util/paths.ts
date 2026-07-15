import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs";

export function nuwaCliHome(): string {
  return path.join(os.homedir(), ".nuwa-cli");
}

export function cliDir(): string {
  return nuwaCliHome();
}

export function cliConfigPath(): string {
  return path.join(cliDir(), "config.json");
}

export function cliCredentialsPath(): string {
  return path.join(cliDir(), "credentials.json");
}

export function cliToolsDir(): string {
  return path.join(cliDir(), "tools");
}

/**
 * Lockfile `serve` writes on listen and removes on graceful shutdown, so
 * `status` can report whether a local serve is running and on which port.
 * Holds only pid/port/host/startedAt — NEVER the X-Nuwax-Internal-Secret
 * (that stays ephemeral, printed at startup only). `NUWACLAW_SERVE_LOCK_PATH`
 * is a test-only override so the suite doesn't clobber a real serve's lock.
 */
export function cliServeLockPath(): string {
  return (
    process.env.NUWACLAW_SERVE_LOCK_PATH ?? path.join(cliDir(), "serve.lock")
  );
}

export function enginesDir(): string {
  return path.join(nuwaCliHome(), "engines");
}

export function logsDir(): string {
  return path.join(nuwaCliHome(), "logs");
}

export function tmpDir(): string {
  return path.join(nuwaCliHome(), "tmp");
}

export function workspacesDir(): string {
  return path.join(nuwaCliHome(), "workspaces");
}

export function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

/** Atomic write: write to a temp file in the same dir, then rename over the target. */
export function writeFileAtomic(
  filePath: string,
  data: string,
  mode?: number,
): void {
  ensureDir(path.dirname(filePath));
  const tmpPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmpPath, data, { mode });
  fs.renameSync(tmpPath, filePath);
}
