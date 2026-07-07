import * as fs from "node:fs";
import * as path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { cliToolsDir, ensureDir } from "../../util/paths.js";

/** nuwax-file-server is a published npm CLI (unlike lanproxy, which currently has no independent distribution channel — see lanproxyBinary.ts). */
const FILE_SERVER_VERSION =
  process.env.NUWACLAW_FILE_SERVER_VERSION || "latest";

function installedBinPath(): string {
  return path.join(
    cliToolsDir(),
    "node_modules",
    "nuwax-file-server",
    "dist",
    "cli.js",
  );
}

function ensureToolsProjectMarker(): void {
  const toolsDir = cliToolsDir();
  ensureDir(toolsDir);
  const marker = path.join(toolsDir, "package.json");
  if (!fs.existsSync(marker)) {
    fs.writeFileSync(
      marker,
      JSON.stringify(
        { name: "nuwaclaw-cli-tools", private: true, version: "0.0.0" },
        null,
        2,
      ),
    );
  }
}

function ensureFileServerInstalled(): string {
  const bin = installedBinPath();
  if (fs.existsSync(bin)) return bin;
  ensureToolsProjectMarker();
  console.error(
    `[nuwaclaw] 首次使用 --tunnel，正在安装 nuwax-file-server@${FILE_SERVER_VERSION}...`,
  );
  const result = spawnSync(
    "npm",
    [
      "install",
      `nuwax-file-server@${FILE_SERVER_VERSION}`,
      "--no-save",
      "--no-audit",
      "--no-fund",
    ],
    { cwd: cliToolsDir(), stdio: "inherit" },
  );
  if (result.status !== 0 || !fs.existsSync(bin)) {
    throw new Error("安装 nuwax-file-server 失败，请检查网络或 npm 镜像配置");
  }
  return bin;
}

export function startFileServer(port: number): void {
  const bin = ensureFileServerInstalled();
  const proc = spawn(process.execPath, [bin, "start", "--port", String(port)], {
    stdio: "ignore",
    detached: true,
  });
  proc.unref();
}

export function stopFileServer(): void {
  const bin = installedBinPath();
  if (!fs.existsSync(bin)) return;
  spawnSync(process.execPath, [bin, "stop"], { stdio: "ignore" });
}
