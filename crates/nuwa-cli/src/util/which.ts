import { spawnSync } from "node:child_process";

export function isWindows(): boolean {
  return process.platform === "win32";
}

/** Resolve a command to an absolute path via the shell's own lookup (which/where). */
export function findOnPath(command: string): string | null {
  const finder = isWindows() ? "where" : "which";
  const result = spawnSync(finder, [command], { encoding: "utf-8" });
  if (result.status !== 0) return null;
  const first = result.stdout.split(/\r?\n/).find((line) => line.trim());
  return first?.trim() || null;
}

export function getVersion(
  binPath: string,
  args: string[] = ["--version"],
): string | null {
  const result = spawnSync(binPath, args, { encoding: "utf-8", timeout: 5000 });
  if (result.status !== 0) return null;
  const text = (result.stdout || result.stderr || "").trim();
  const match = text.match(/(\d+\.\d+\.\d+)/);
  return match ? match[1] : text.split("\n")[0]?.trim() || null;
}
