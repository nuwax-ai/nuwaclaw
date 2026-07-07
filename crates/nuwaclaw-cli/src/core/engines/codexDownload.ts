import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { enginesDir, ensureDir } from "../../util/paths.js";
import { isWindows } from "../../util/which.js";

/** Same fork/version pinned by the Electron client's scripts/prepare/prepare-codex-acp.js. */
const CODEX_ACP_VERSION = process.env.CODEX_ACP_VERSION || "0.15.11";
const CODEX_ACP_REPO = process.env.CODEX_ACP_REPO || "nuwax-ai/codex-acp";
const CODEX_ACP_ASSET_PREFIX =
  process.env.CODEX_ACP_ASSET_PREFIX || "nuwax-codex-acp";

const PLATFORM_MAP: Record<string, { target: string; ext: "tar.gz" | "zip" }> =
  {
    "darwin-arm64": { target: "aarch64-apple-darwin", ext: "tar.gz" },
    "darwin-x64": { target: "x86_64-apple-darwin", ext: "tar.gz" },
    "linux-x64": { target: "x86_64-unknown-linux-gnu", ext: "tar.gz" },
    "linux-arm64": { target: "aarch64-unknown-linux-gnu", ext: "tar.gz" },
    "win32-x64": { target: "x86_64-pc-windows-msvc", ext: "zip" },
    "win32-arm64": { target: "aarch64-pc-windows-msvc", ext: "zip" },
  };

function getPlatformKey(): string {
  return `${process.platform}-${process.arch}`;
}

function getBinaryName(key: string): string {
  return key.startsWith("win32") ? "nuwax-codex-acp.exe" : "nuwax-codex-acp";
}

function sha256File(filePath: string): string {
  return crypto
    .createHash("sha256")
    .update(fs.readFileSync(filePath))
    .digest("hex");
}

function findBinaryRecursive(
  dir: string,
  binaryName: string,
  maxDepth: number,
): string | null {
  if (maxDepth <= 0) return null;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isFile() && entry.name === binaryName) return fullPath;
    if (entry.isDirectory()) {
      const found = findBinaryRecursive(fullPath, binaryName, maxDepth - 1);
      if (found) return found;
    }
  }
  return null;
}

async function downloadToFile(
  downloadUrl: string,
  destFile: string,
): Promise<void> {
  const headers: Record<string, string> = { "User-Agent": "nuwaclaw-cli" };
  if (process.env.GITHUB_TOKEN)
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const resp = await fetch(downloadUrl, { headers, redirect: "follow" });
  if (!resp.ok || !resp.body) {
    throw new Error(`下载失败 HTTP ${resp.status}：${downloadUrl}`);
  }
  const buffer = Buffer.from(await resp.arrayBuffer());
  fs.writeFileSync(destFile, buffer);
}

function extractArchive(
  archivePath: string,
  ext: "tar.gz" | "zip",
  extractDir: string,
): void {
  ensureDir(extractDir);
  if (ext === "zip") {
    if (isWindows()) {
      execFileSync("powershell", [
        "-NoProfile",
        "-Command",
        `Expand-Archive -Path "${archivePath}" -DestinationPath "${extractDir}" -Force`,
      ]);
    } else {
      execFileSync("unzip", ["-q", archivePath, "-d", extractDir]);
    }
  } else {
    execFileSync("tar", ["-xzf", archivePath, "-C", extractDir]);
  }
}

/**
 * Downloads (if not already cached) the nuwax-codex-acp binary for the
 * current platform into ~/.nuwaclaw/engines/codex-acp/<version>/, mirroring
 * the Electron client's prepare-codex-acp.js source/versioning. Only runs
 * when the user actually selects the codex engine — never during install.
 */
export async function ensureCodexAcpBinary(): Promise<string> {
  const key = getPlatformKey();
  const info = PLATFORM_MAP[key];
  if (!info) {
    throw new Error(
      `nuwax-codex-acp 暂不支持当前平台 (${key})。支持的平台：${Object.keys(PLATFORM_MAP).join(", ")}`,
    );
  }

  const binaryName = getBinaryName(key);
  const destDir = path.join(enginesDir(), "codex-acp", CODEX_ACP_VERSION, key);
  const destPath = path.join(destDir, binaryName);
  if (fs.existsSync(destPath)) return destPath;

  const assetName = `${CODEX_ACP_ASSET_PREFIX}-${CODEX_ACP_VERSION}-${info.target}.${info.ext}`;
  const downloadUrl = `https://github.com/${CODEX_ACP_REPO}/releases/download/v${CODEX_ACP_VERSION}/${assetName}`;

  const cacheDir = path.join(enginesDir(), "codex-acp", ".cache");
  ensureDir(cacheDir);
  const archivePath = path.join(cacheDir, assetName);

  console.error(
    `[nuwaclaw] 首次使用 codex 引擎，正在下载 nuwax-codex-acp@${CODEX_ACP_VERSION}（${key}）...`,
  );
  try {
    await downloadToFile(downloadUrl, archivePath);
  } catch (err) {
    throw new Error(
      `下载 nuwax-codex-acp 失败：${(err as Error).message}\n请确认网络可访问 GitHub Releases：https://github.com/${CODEX_ACP_REPO}/releases/tag/v${CODEX_ACP_VERSION}`,
    );
  }

  const extractDir = path.join(cacheDir, `extract-${key}`);
  if (fs.existsSync(extractDir))
    fs.rmSync(extractDir, { recursive: true, force: true });
  extractArchive(archivePath, info.ext, extractDir);

  const extractedBinary = findBinaryRecursive(extractDir, binaryName, 3);
  if (!extractedBinary) {
    throw new Error(`nuwax-codex-acp 压缩包解压后未找到二进制 ${binaryName}`);
  }

  ensureDir(destDir);
  fs.copyFileSync(extractedBinary, destPath);
  fs.chmodSync(destPath, 0o755);

  if (process.platform === "darwin") {
    try {
      execFileSync("codesign", ["--force", "--sign", "-", destPath]);
    } catch {
      // Best-effort ad-hoc signature, same as the Electron prepare script; not fatal if codesign is unavailable.
    }
  }

  // Recorded for parity with the Electron build's cache-freshness marker; not a security signature.
  fs.writeFileSync(`${destPath}.sha256`, sha256File(destPath));
  return destPath;
}
