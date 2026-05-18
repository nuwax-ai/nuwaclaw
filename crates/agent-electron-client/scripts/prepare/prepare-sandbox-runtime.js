#!/usr/bin/env node
/**
 * 准备三端沙箱运行时资源
 *
 * 约定：
 * - 子模块目录：../agent-sandbox-runtime（相对 crates/agent-electron-client）
 * - 清单文件：manifest.json
 * - 目标目录：resources/sandbox-runtime/bin
 *
 * （仅 Windows 客户端）Sandbox helper：manifest 的 win32 产物或另行构建的
 * nuwax-sandbox-helper.exe；亦可由 Rust crate crates/windows-sandbox-helper
 * 通过 npm run build:sandbox-helper 生成到 resources/sandbox-helper。
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { getProjectRoot } = require("../utils/project-paths");

const projectRoot = getProjectRoot();
const cratesDir = path.resolve(projectRoot, "..");
const sandboxRuntimeSubmodule = path.join(cratesDir, "agent-sandbox-runtime");
const manifestPath = path.join(sandboxRuntimeSubmodule, "manifest.json");
const targetRoot = path.join(projectRoot, "resources", "sandbox-runtime");
const targetBin = path.join(targetRoot, "bin");

function getPlatformKey() {
  const arch = process.env.TARGET_ARCH || process.arch;
  return `${process.platform}-${arch}`;
}

function sha256(filePath) {
  const hash = crypto.createHash("sha256");
  const data = fs.readFileSync(filePath);
  hash.update(data);
  return hash.digest("hex");
}

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function normalizeEntry(entry) {
  if (!entry) return null;
  if (typeof entry === "string") {
    return { source: entry };
  }
  if (typeof entry !== "object") return null;
  const source = entry.source || entry.path || entry.file;
  if (!source || typeof source !== "string") return null;
  return {
    source,
    sha256: typeof entry.sha256 === "string" ? entry.sha256.toLowerCase() : null,
    targetName: typeof entry.targetName === "string" ? entry.targetName : null,
  };
}

function loadManifest() {
  if (!fs.existsSync(manifestPath)) {
    console.warn(
      `[prepare-sandbox-runtime] 未找到 manifest: ${manifestPath}，跳过（子模块未初始化或未接入）`,
    );
    return null;
  }
  const raw = fs.readFileSync(manifestPath, "utf-8");
  return JSON.parse(raw);
}

function resolvePlatformArtifact(manifest, key) {
  const table = manifest.platforms || manifest.artifacts || {};
  return normalizeEntry(table[key]);
}

function writeSkippedStub(key, reason) {
  ensureDir(targetRoot);
  ensureDir(targetBin);
  const payload = {
    skipped: true,
    reason,
    platform: key,
    preparedAt: new Date().toISOString(),
  };
  fs.writeFileSync(
    path.join(targetRoot, "resolved-manifest.json"),
    JSON.stringify(payload, null, 2),
    "utf-8",
  );
  console.warn(`[prepare-sandbox-runtime] 已写入占位目录（${reason}）`);
}

function main() {
  const key = getPlatformKey();
  const manifest = loadManifest();
  if (!manifest) {
    writeSkippedStub(key, "manifest missing");
    return;
  }

  const artifact = resolvePlatformArtifact(manifest, key);
  if (!artifact) {
    writeSkippedStub(key, `no artifact for ${key}`);
    return;
  }

  const sourcePath = path.isAbsolute(artifact.source)
    ? artifact.source
    : path.join(sandboxRuntimeSubmodule, artifact.source);

  if (!fs.existsSync(sourcePath)) {
    throw new Error(
      `[prepare-sandbox-runtime] 产物不存在: ${sourcePath}（platform=${key}）`,
    );
  }

  if (artifact.sha256) {
    const current = sha256(sourcePath);
    if (current !== artifact.sha256) {
      throw new Error(
        `[prepare-sandbox-runtime] 校验失败: expected=${artifact.sha256}, actual=${current}, file=${sourcePath}`,
      );
    }
  }

  // 缓存检查：若 platform-key + 版本 + 文件 hash/大小均匹配，跳过复制
  const platformKeyFile = path.join(targetBin, '.platform-key');
  const resolvedManifestPath = path.join(targetRoot, 'resolved-manifest.json');
  if (fs.existsSync(platformKeyFile) && fs.existsSync(resolvedManifestPath)) {
    try {
      const savedKey = fs.readFileSync(platformKeyFile, 'utf-8').trim();
      const savedManifest = JSON.parse(fs.readFileSync(resolvedManifestPath, 'utf-8'));
      const targetName = artifact.targetName || path.basename(sourcePath);
      const targetPath = path.join(targetBin, targetName);
      if (savedKey === key
        && savedManifest.version === (manifest.version || 'unknown')
        && fs.existsSync(targetPath)) {
        if (artifact.sha256) {
          const currentHash = sha256(targetPath);
          if (currentHash === artifact.sha256) {
            console.log(`[prepare-sandbox-runtime] ${key} ✓ (已是最新, SHA256 匹配)`);
            return;
          }
        } else if (fs.statSync(sourcePath).size === fs.statSync(targetPath).size) {
          console.log(`[prepare-sandbox-runtime] ${key} ✓ (已是最新, 大小匹配)`);
          return;
        }
      }
    } catch { /* 缓存文件损坏，继续执行 */ }
  }

  ensureDir(targetBin);
  const targetName = artifact.targetName || path.basename(sourcePath);
  const targetPath = path.join(targetBin, targetName);
  fs.copyFileSync(sourcePath, targetPath);

  if (process.platform !== "win32") {
    try {
      fs.chmodSync(targetPath, 0o755);
    } catch (_) {}
  }

  const resolved = {
    version: manifest.version || "unknown",
    platform: key,
    source: sourcePath,
    target: targetPath,
    sha256: artifact.sha256 || null,
    preparedAt: new Date().toISOString(),
  };
  fs.writeFileSync(
    path.join(targetRoot, "resolved-manifest.json"),
    JSON.stringify(resolved, null, 2),
    "utf-8",
  );
  fs.writeFileSync(path.join(targetBin, ".platform-key"), key, "utf-8");

  console.log(`[prepare-sandbox-runtime] ${key} -> ${targetName}`);
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
