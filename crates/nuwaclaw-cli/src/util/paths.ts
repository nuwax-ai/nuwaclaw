import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs";

export function nuwaclawHome(): string {
  return path.join(os.homedir(), ".nuwaclaw");
}

export function cliDir(): string {
  return path.join(nuwaclawHome(), "cli");
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

export function enginesDir(): string {
  return path.join(nuwaclawHome(), "engines");
}

export function logsDir(): string {
  return path.join(nuwaclawHome(), "logs");
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
