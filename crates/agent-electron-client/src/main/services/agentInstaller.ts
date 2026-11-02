/**
 * Agent 安装管理服务
 *
 * 提供 ACP Agent 的下载、安装、查询、卸载能力。
 * 安装目录：~/.nuwax-agent/acp-agent/
 * 注册表：~/.nuwax-agent/acp-agent/registry.json
 *
 * 对齐 rcoder 的 /agent-mgmt/* API 实现。
 */

import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import * as https from "https";
import * as http from "http";
import { execFile, execFileSync } from "child_process";
import { promisify } from "util";
import AdmZip from "adm-zip";
import log from "electron-log";
import { getAppDataDir } from "./system/appPaths";
import { getNodeBinPathWithFallback } from "./system/dependencies";
import type {
  InstallFromUrlRequest,
  InstallAgentResponse,
  ListAgentsResponse,
  CheckAgentResponse,
  UninstallAgentResponse,
  AgentInstallType,
  AgentInstallStatus,
  InstallAction,
  PlatformEntry,
} from "@shared/types/computerTypes";

const execFileAsync = promisify(execFile);

// =============================================================================
// 常量
// =============================================================================

const ACP_AGENT_DIR_NAME = "acp-agent";
const REGISTRY_FILE = "registry.json";
const CACHE_DIR = "cache";
const BIN_DIR = "bin";
const LIB_DIR = "lib";

// 下载超时 10 分钟
const DOWNLOAD_TIMEOUT_MS = 10 * 60 * 1000;
// 下载重试次数
const DOWNLOAD_MAX_RETRIES = 3;

// =============================================================================
// 内置 Agent 列表
// =============================================================================

const BUILTIN_AGENTS = new Set([
  "claude-code-acp-ts",
  "claude-code-acp",
  "claude-code",
  "nuwaxcode",
  "codex-cli",
  "codex-acp",
  "nuwax-codex-acp",
]);

export function isBuiltinAgent(agentId: string): boolean {
  return BUILTIN_AGENTS.has(agentId);
}

// =============================================================================
// 目录管理
// =============================================================================

/** 获取 Agent 安装根目录 */
export function getAgentInstallDir(): string {
  return path.join(getAppDataDir(), ACP_AGENT_DIR_NAME);
}

/** 确保 acp-agent 目录存在（应用启动时调用） */
export function ensureAcpAgentDir(): void {
  fs.mkdirSync(getAgentInstallDir(), { recursive: true });
}

/** 获取 Agent 注册表文件路径 */
function getAgentRegistryPath(): string {
  return path.join(getAgentInstallDir(), REGISTRY_FILE);
}

/** 获取 Agent bin 目录（符号链接目录） */
function getAgentBinDir(): string {
  return path.join(getAgentInstallDir(), BIN_DIR);
}

/** 获取下载缓存目录 */
function getCacheDir(): string {
  return path.join(getAgentInstallDir(), CACHE_DIR);
}

/**
 * 获取指定 agent 的版本隔离目录
 * 结构: {install_dir}/{agent_id}/{version}/
 */
function getAgentVersionDir(agentId: string, version: string): string {
  return path.join(getAgentInstallDir(), agentId, version);
}

/** 获取指定 agent 版本的 bin 目录 */
function getAgentVersionBinDir(agentId: string, version: string): string {
  return path.join(getAgentVersionDir(agentId, version), BIN_DIR);
}

/** 获取指定 agent 版本的 lib 目录 */
function getAgentVersionLibDir(agentId: string, version: string): string {
  return path.join(getAgentVersionDir(agentId, version), LIB_DIR);
}

/** 确保所有必要目录存在 */
function ensureDirectories(): void {
  const dirs = [getAgentInstallDir(), getAgentBinDir(), getCacheDir()];
  for (const dir of dirs) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

// =============================================================================
// 平台检测
// =============================================================================

/** 获取当前平台 key（对齐 rcoder 的 {os}-{arch} 格式） */
function getCurrentPlatformKey(): string {
  const platform = process.platform;
  const arch = process.arch;

  // 归一化 OS
  let os: string;
  if (platform === "win32") os = "windows";
  else if (platform === "darwin") os = "darwin";
  else os = "linux";

  // 归一化 Arch
  let normalizedArch: string;
  if (arch === "x64") normalizedArch = "x86_64";
  else if (arch === "arm64") normalizedArch = "aarch64";
  else normalizedArch = arch;

  return `${os}-${normalizedArch}`;
}

/** 从 platforms map 中匹配当前平台的 PlatformEntry */
function matchPlatform(
  platforms: Record<string, PlatformEntry>,
): { key: string; entry: PlatformEntry } | null {
  const currentKey = getCurrentPlatformKey();

  // 精确匹配
  if (platforms[currentKey]) {
    return { key: currentKey, entry: platforms[currentKey] };
  }

  // 归一化后匹配（处理 amd64/x86_64 等差异）
  for (const [key, entry] of Object.entries(platforms)) {
    if (normalizePlatformKey(key) === normalizePlatformKey(currentKey)) {
      return { key, entry };
    }
  }

  return null;
}

/** Resolve download URL for the current platform (for logging/diagnostics). */
export function resolvePlatformDownloadUrl(
  platforms: Record<string, PlatformEntry>,
): string | undefined {
  return matchPlatform(platforms)?.entry.url;
}

/** 归一化平台 key */
function normalizePlatformKey(key: string): string {
  return key
    .toLowerCase()
    .replace(/amd64/g, "x86_64")
    .replace(/arm64/g, "aarch64");
}

/** 获取系统信息 */
function getSystemInfo(): { os: string; arch: string; platform: string } {
  const platform = process.platform;
  const arch = process.arch;

  let os: string;
  if (platform === "win32") os = "windows";
  else if (platform === "darwin") os = "darwin";
  else os = "linux";

  let normalizedArch: string;
  if (arch === "x64") normalizedArch = "x86_64";
  else if (arch === "arm64") normalizedArch = "aarch64";
  else normalizedArch = arch;

  return { os, arch: normalizedArch, platform: getCurrentPlatformKey() };
}

// =============================================================================
// 注册表管理
// =============================================================================

interface AgentManifest {
  agent_id: string;
  install_type: AgentInstallType;
  command: string;
  args: string[];
  binary_path: string;
  version?: string;
  source?: string;
  platform?: string;
  file_size: number;
  file_type: string;
  installed_at: number;
}

/** 读取注册表 */
function readRegistry(): Map<string, AgentManifest[]> {
  const registryPath = getAgentRegistryPath();
  const result = new Map<string, AgentManifest[]>();

  if (!fs.existsSync(registryPath)) {
    return result;
  }

  try {
    const data = JSON.parse(
      fs.readFileSync(registryPath, "utf-8"),
    ) as AgentManifest[];
    for (const manifest of data) {
      const existing = result.get(manifest.agent_id) || [];
      existing.push(manifest);
      result.set(manifest.agent_id, existing);
    }
  } catch (e) {
    log.error(`[AgentInstaller] Failed to read registry: ${e}`);
  }

  return result;
}

/** 写入注册表 */
function writeRegistry(registry: Map<string, AgentManifest[]>): void {
  const registryPath = getAgentRegistryPath();
  const allManifests: AgentManifest[] = [];

  for (const manifests of registry.values()) {
    allManifests.push(...manifests);
  }

  // 原子写入：先写临时文件，再重命名
  const tmpPath = registryPath + ".tmp";
  fs.writeFileSync(tmpPath, JSON.stringify(allManifests, null, 2));
  fs.renameSync(tmpPath, registryPath);
}

/** 检查注册表中是否已包含指定版本 */
function containsVersion(
  registry: Map<string, AgentManifest[]>,
  agentId: string,
  version: string,
): boolean {
  const manifests = registry.get(agentId);
  if (!manifests) return false;

  const normalizedVersion = normalizeVersion(version);
  return manifests.some(
    (m) => m.version && normalizeVersion(m.version) === normalizedVersion,
  );
}

/** 归一化版本号（去 v 前缀） */
function normalizeVersion(version: string): string {
  const v = version.trim();
  if (v.startsWith("v") || v.startsWith("V")) {
    return v.substring(1);
  }
  return v;
}

// =============================================================================
// 文件下载
// =============================================================================

const INSPECT_HEAD_BYTES = 512;

type ArchiveKind = "zip" | "tar.gz";

export interface InspectDownloadedArtifactOptions {
  url: string;
  contentType?: string;
  expectedArchive?: ArchiveKind;
  deleteOnFailure?: boolean;
}

interface DownloadResult {
  filePath: string;
  fileSize: number;
  fromCache: boolean;
}

function readFileHead(filePath: string, maxBytes = INSPECT_HEAD_BYTES): Buffer {
  const fd = fs.openSync(filePath, "r");
  try {
    const size = Math.min(fs.statSync(filePath).size, maxBytes);
    const buf = Buffer.alloc(size);
    if (size > 0) {
      fs.readSync(fd, buf, 0, size, 0);
    }
    return buf;
  } finally {
    fs.closeSync(fd);
  }
}

function formatMagicHex(buf: Buffer, max = 8): string {
  return buf.subarray(0, Math.min(buf.length, max)).toString("hex");
}

function isZipMagic(buf: Buffer): boolean {
  return buf.length >= 2 && buf[0] === 0x50 && buf[1] === 0x4b;
}

function isGzipMagic(buf: Buffer): boolean {
  return buf.length >= 2 && buf[0] === 0x1f && buf[1] === 0x8b;
}

function inferExpectedArchiveFromUrl(url: string): ArchiveKind | undefined {
  const lower = url.toLowerCase();
  if (lower.endsWith(".zip")) return "zip";
  if (lower.endsWith(".tar.gz") || lower.endsWith(".tgz")) return "tar.gz";
  return undefined;
}

function buildInspectContext(
  url: string,
  contentType: string | undefined,
  size: number,
): string {
  const parts = [`url=${url}`, `size=${size}B`];
  if (contentType) {
    parts.push(`content-type=${contentType}`);
  }
  return parts.join(", ");
}

function safeUnlink(filePath: string): void {
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch (e) {
    log.warn(
      `[AgentInstaller] Failed to remove invalid download: ${filePath}: ${e}`,
    );
  }
}

function normalizeContentType(
  value: string | string[] | undefined,
): string | undefined {
  if (Array.isArray(value)) {
    return value[0];
  }
  return value;
}

function isApiErrorPayload(json: Record<string, unknown>): boolean {
  if (json.success === true) {
    return false;
  }
  if (json.success === false) {
    return true;
  }
  if (json.code != null && json.message != null) {
    return true;
  }
  if (json.displayCode != null && json.message != null) {
    return true;
  }
  return false;
}

/** Download validation errors that will not succeed on retry. */
export function isNonRetryableDownloadError(message: string): boolean {
  return (
    message.includes("Download returned API error") ||
    message.includes("Download content-type mismatch") ||
    message.includes("Downloaded file is not a valid") ||
    message.includes("Downloaded file is empty") ||
    message.includes("File has archive extension but missing") ||
    message.includes("File has .zip extension but missing") ||
    /^HTTP 40[0-9]:/.test(message)
  );
}

function tryParseApiError(
  filePath: string,
  head: Buffer,
  size: number,
): string | null {
  const trimmedHead = head.toString("utf-8").trimStart();
  const firstChar =
    trimmedHead.length > 0 ? trimmedHead.charCodeAt(0) : head[0];
  if (firstChar !== 0x7b && firstChar !== 0x5b) {
    return null;
  }

  try {
    const text =
      size <= 65536 ? fs.readFileSync(filePath, "utf-8").trim() : trimmedHead;
    const json = JSON.parse(text) as Record<string, unknown>;
    if (!json || typeof json !== "object" || Array.isArray(json)) {
      return null;
    }
    if (isApiErrorPayload(json)) {
      const code = json.code ?? json.displayCode ?? "unknown";
      const message = json.message ?? "unknown error";
      return `Download returned API error (${code}): ${message}`;
    }
  } catch {
    // Not a parseable API error payload.
  }
  return null;
}

/** Validate downloaded artifact content before extract/install. */
export function inspectDownloadedArtifact(
  filePath: string,
  opts: InspectDownloadedArtifactOptions,
): void {
  const { url, contentType, expectedArchive, deleteOnFailure = true } = opts;
  const size = fs.statSync(filePath).size;

  if (size === 0) {
    const msg = `Downloaded file is empty [${buildInspectContext(url, contentType, size)}]`;
    if (deleteOnFailure) safeUnlink(filePath);
    throw new Error(msg);
  }

  const head = readFileHead(filePath);
  const apiError = tryParseApiError(filePath, head, size);
  if (apiError) {
    const msg = `${apiError} [${buildInspectContext(url, contentType, size)}]`;
    if (deleteOnFailure) safeUnlink(filePath);
    throw new Error(msg);
  }

  const archiveMagic = isZipMagic(head)
    ? "zip"
    : isGzipMagic(head)
      ? "tar.gz"
      : null;
  const ct = contentType?.toLowerCase() ?? "";
  if (
    (ct.includes("application/json") || ct.includes("text/html")) &&
    !archiveMagic
  ) {
    const msg = `Download content-type mismatch: expected archive, got ${contentType} [${buildInspectContext(url, contentType, size)}]`;
    if (deleteOnFailure) safeUnlink(filePath);
    throw new Error(msg);
  }

  const expected = expectedArchive ?? inferExpectedArchiveFromUrl(url);
  if (expected === "zip" && !isZipMagic(head)) {
    const msg = `Downloaded file is not a valid zip (magic=${formatMagicHex(head)}, ${buildInspectContext(url, contentType, size)})`;
    if (deleteOnFailure) safeUnlink(filePath);
    throw new Error(msg);
  }
  if (expected === "tar.gz" && !isGzipMagic(head)) {
    const msg = `Downloaded file is not a valid tar.gz/gzip (magic=${formatMagicHex(head)}, ${buildInspectContext(url, contentType, size)})`;
    if (deleteOnFailure) safeUnlink(filePath);
    throw new Error(msg);
  }
}

/** 下载文件到缓存目录 */
async function downloadToCache(
  agentId: string,
  version: string,
  url: string,
): Promise<DownloadResult> {
  const cacheDir = path.join(getCacheDir(), agentId, normalizeVersion(version));
  fs.mkdirSync(cacheDir, { recursive: true });

  // 从 URL 提取文件名
  const urlPath = new URL(url).pathname;
  const fileName = path.basename(urlPath) || `${agentId}-${version}`;
  const filePath = path.join(cacheDir, fileName);

  // 检查缓存（校验内容，坏缓存删除后重下）
  if (fs.existsSync(filePath) && fs.statSync(filePath).size > 0) {
    try {
      inspectDownloadedArtifact(filePath, {
        url,
        expectedArchive: inferExpectedArchiveFromUrl(url),
      });
      log.info(`[AgentInstaller] Using cached file: ${filePath}`);
      return {
        filePath,
        fileSize: fs.statSync(filePath).size,
        fromCache: true,
      };
    } catch (e) {
      log.warn(`[AgentInstaller] Invalid cached file, re-downloading: ${e}`);
    }
  }

  // 下载（带重试）
  let lastError: Error | null = null;
  for (let attempt = 1; attempt <= DOWNLOAD_MAX_RETRIES; attempt++) {
    try {
      log.info(
        `[AgentInstaller] Downloading: ${url} (attempt ${attempt}/${DOWNLOAD_MAX_RETRIES})`,
      );
      const fileSize = await downloadFile(url, filePath);
      return { filePath, fileSize, fromCache: false };
    } catch (e) {
      lastError = e as Error;
      log.warn(`[AgentInstaller] Download attempt ${attempt} failed: ${e}`);
      if (isNonRetryableDownloadError(lastError.message)) {
        throw lastError;
      }
      if (attempt < DOWNLOAD_MAX_RETRIES) {
        await sleep(1000 * attempt);
      }
    }
  }

  throw new Error(
    `Download failed after ${DOWNLOAD_MAX_RETRIES} attempts: ${lastError?.message}`,
  );
}

/** 最大重定向次数 */
const MAX_REDIRECTS = 5;

/** 下载单个文件 */
function downloadFile(
  url: string,
  destPath: string,
  redirectCount = 0,
): Promise<number> {
  return new Promise((resolve, reject) => {
    const client = url.startsWith("https") ? https : http;
    const timeout = setTimeout(() => {
      reject(new Error("Download timeout"));
    }, DOWNLOAD_TIMEOUT_MS);

    client
      .get(url, (res) => {
        // 处理重定向
        if (
          res.statusCode &&
          res.statusCode >= 300 &&
          res.statusCode < 400 &&
          res.headers.location
        ) {
          clearTimeout(timeout);
          if (redirectCount >= MAX_REDIRECTS) {
            reject(new Error(`Too many redirects (max ${MAX_REDIRECTS})`));
            return;
          }
          downloadFile(res.headers.location, destPath, redirectCount + 1)
            .then(resolve)
            .catch(reject);
          return;
        }

        if (res.statusCode !== 200) {
          clearTimeout(timeout);
          reject(new Error(`HTTP ${res.statusCode}: ${res.statusMessage}`));
          return;
        }

        const contentType = normalizeContentType(res.headers["content-type"]);
        if (contentType?.toLowerCase().includes("application/json")) {
          log.warn(
            `[AgentInstaller] Download response content-type is JSON: url=${url}, content-type=${contentType}`,
          );
        }

        const fileStream = fs.createWriteStream(destPath);
        let fileSize = 0;

        res.on("data", (chunk: Buffer) => {
          fileSize += chunk.length;
        });

        res.pipe(fileStream);

        fileStream.on("finish", () => {
          clearTimeout(timeout);
          fileStream.close(() => {
            try {
              inspectDownloadedArtifact(destPath, {
                url,
                contentType,
                expectedArchive: inferExpectedArchiveFromUrl(url),
              });
              resolve(fileSize);
            } catch (err) {
              reject(err);
            }
          });
        });

        fileStream.on("error", (err) => {
          clearTimeout(timeout);
          fs.unlinkSync(destPath);
          reject(err);
        });
      })
      .on("error", (err) => {
        clearTimeout(timeout);
        reject(err);
      });
  });
}

/** SHA-256 校验 */
function verifySha256(filePath: string, expectedSha256: string): boolean {
  const fileBuffer = fs.readFileSync(filePath);
  const hash = crypto.createHash("sha256").update(fileBuffer).digest("hex");
  return hash === expectedSha256.toLowerCase();
}

// =============================================================================
// 文件解压
// =============================================================================

/** 检测文件类型（优先 magic bytes；archive 后缀无 magic 则报错） */
function detectFileType(filePath: string): "tar.gz" | "zip" | "executable" {
  const head = readFileHead(filePath, 4);
  if (isGzipMagic(head)) return "tar.gz";
  if (isZipMagic(head)) return "zip";

  const lower = filePath.toLowerCase();
  if (lower.endsWith(".tar.gz") || lower.endsWith(".tgz")) {
    throw new Error(
      `File has archive extension but missing gzip magic bytes: ${filePath}`,
    );
  }
  if (lower.endsWith(".zip")) {
    throw new Error(
      `File has .zip extension but missing zip magic bytes: ${filePath}`,
    );
  }

  return "executable";
}

/** 解压文件到临时目录，返回解压后的文件列表 */
async function extractArchive(
  filePath: string,
  fileType: "tar.gz" | "zip",
  destDir: string,
  sourceUrl?: string,
): Promise<string[]> {
  fs.mkdirSync(destDir, { recursive: true });

  if (fileType === "tar.gz") {
    await extractTarGz(filePath, destDir, sourceUrl);
  } else {
    await extractZip(filePath, destDir, sourceUrl);
  }

  // 规范化目录结构（兼容单一文件夹根目录的压缩包）
  normalizeExtractedDir(destDir);

  return listFilesRecursive(destDir);
}

/** 解压 tar.gz */
async function extractTarGz(
  filePath: string,
  destDir: string,
  sourceUrl?: string,
): Promise<string[]> {
  try {
    // 优先使用系统 tar 命令
    await execFileAsync("tar", ["xzf", filePath, "-C", destDir]);
  } catch {
    if (sourceUrl) {
      inspectDownloadedArtifact(filePath, {
        url: sourceUrl,
        expectedArchive: "tar.gz",
        deleteOnFailure: false,
      });
    }
    // 回退到 npm tar 包
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const tar = require("tar");
      await tar.extract({ file: filePath, cwd: destDir });
    } catch {
      throw new Error(
        "Failed to extract tar.gz: no extraction method available",
      );
    }
  }

  return listFilesRecursive(destDir);
}

/** 解压 zip */
async function extractZip(
  filePath: string,
  destDir: string,
  sourceUrl?: string,
): Promise<string[]> {
  try {
    const zip = new AdmZip(filePath);
    zip.extractAllTo(destDir, true);
    return listFilesRecursive(destDir);
  } catch (primaryErr) {
    log.warn(`[AgentInstaller] adm-zip extract failed: ${primaryErr}`);
    if (sourceUrl) {
      inspectDownloadedArtifact(filePath, {
        url: sourceUrl,
        expectedArchive: "zip",
        deleteOnFailure: false,
      });
    }
    try {
      await execFileAsync("unzip", ["-o", filePath, "-d", destDir]);
      return listFilesRecursive(destDir);
    } catch (fallbackErr) {
      const fallbackMessage = String(fallbackErr);
      const unzipDetail = fallbackMessage.includes("ENOENT")
        ? `${fallbackMessage} (Windows has no unzip fallback)`
        : fallbackMessage;
      throw new Error(
        `Failed to extract zip: adm-zip=${primaryErr}; unzip=${unzipDetail}`,
      );
    }
  }
}

/** 递归列出目录下的所有文件 */
function listFilesRecursive(dir: string): string[] {
  const files: string[] = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...listFilesRecursive(fullPath));
    } else {
      files.push(fullPath);
    }
  }

  return files;
}

/**
 * 规范化解压目录结构
 *
 * 兼容两种压缩包结构：
 * 1. 根目录是单一文件夹 → 提取文件夹内容到 destDir
 * 2. 根目录是多个文件/目录 → 保持原样
 *
 * 示例：
 * - 压缩包：agent-2978-1.0.0.tar.gz
 *   解压后：destDir/agent-2978-1.0.0/dist/bundle.mjs
 *   规范化后：destDir/dist/bundle.mjs
 */
function normalizeExtractedDir(destDir: string): void {
  const entries = fs.readdirSync(destDir, { withFileTypes: true });

  // 过滤掉 .DS_Store 等隐藏文件
  const visibleEntries = entries.filter((e) => !e.name.startsWith("."));

  // 如果只有一个子目录，且是目录，则提取内容
  if (visibleEntries.length === 1 && visibleEntries[0].isDirectory()) {
    const subDir = path.join(destDir, visibleEntries[0].name);
    const subEntries = fs.readdirSync(subDir);

    // 移动子目录内容到 destDir
    for (const entry of subEntries) {
      const srcPath = path.join(subDir, entry);
      const destPath = path.join(destDir, entry);
      fs.renameSync(srcPath, destPath);
    }

    // 删除空的子目录
    fs.rmdirSync(subDir);

    log.info(
      `[AgentInstaller] Normalized archive structure: extracted "${visibleEntries[0].name}" contents`,
    );
  }
}

// =============================================================================
// 核心安装逻辑
// =============================================================================

/**
 * 从 URL 安装 Agent（多平台 + 版本管理，幂等）
 *
 * 对齐 rcoder 的 install_with_version_check 流程：
 * 1. 验证参数
 * 2. 版本检查（精确版本已安装 → 跳过）
 * 3. 平台匹配
 * 4. 下载
 * 5. SHA-256 校验
 * 6. 解压/安装
 * 7. 更新注册表
 */
export async function installFromUrl(
  request: InstallFromUrlRequest,
): Promise<InstallAgentResponse> {
  const t0 = Date.now();
  ensureDirectories();

  const { agent, platforms, force } = request;
  const { agent_id, command, args = [], version } = agent;

  // 1. 验证参数
  if (!agent_id?.trim()) {
    throw new Error("agent_id is required");
  }
  if (!command?.trim()) {
    throw new Error("command is required");
  }
  if (!version?.trim()) {
    throw new Error("version is required");
  }
  if (!platforms || Object.keys(platforms).length === 0) {
    throw new Error("platforms cannot be empty");
  }

  const normalizedVersion = normalizeVersion(version);
  const registry = readRegistry();

  // 2. 版本检查（幂等核心）
  if (!force && containsVersion(registry, agent_id, normalizedVersion)) {
    log.info(
      `[AgentInstaller] Agent already installed, skipping: ${agent_id}@${normalizedVersion}`,
    );
    const existing = registry
      .get(agent_id)
      ?.find(
        (m) => m.version && normalizeVersion(m.version) === normalizedVersion,
      );
    return {
      agent_id,
      status: "available",
      binary_path: existing?.binary_path || command,
      file_type: existing?.file_type || "unknown",
      file_size: 0,
      version: normalizedVersion,
      action: "skipped",
      installed: false,
      previous_version: normalizedVersion,
      platform: undefined,
    };
  }

  // 3. 平台匹配
  const match = matchPlatform(platforms);
  if (!match) {
    const availableKeys = Object.keys(platforms);
    throw new Error(
      `Platform not found: ${getCurrentPlatformKey()} (available: ${availableKeys.join(", ")})`,
    );
  }

  const { key: platformKey, entry: platformEntry } = match;
  log.info(
    `[AgentInstaller] Matched platform: ${platformKey}, url: ${platformEntry.url}`,
  );

  // 4. 下载
  const downloadResult = await downloadToCache(
    agent_id,
    normalizedVersion,
    platformEntry.url,
  );

  // 5. SHA-256 校验
  if (platformEntry.sha256) {
    if (!verifySha256(downloadResult.filePath, platformEntry.sha256)) {
      throw new Error("SHA-256 checksum mismatch");
    }
    log.info("[AgentInstaller] SHA-256 verification passed");
  }

  // 6. 检测文件类型并安装（多版本并存结构）
  const fileType = detectFileType(downloadResult.filePath);
  const versionDir = getAgentVersionDir(agent_id, normalizedVersion);
  const versionBinDir = getAgentVersionBinDir(agent_id, normalizedVersion);
  const versionLibDir = getAgentVersionLibDir(agent_id, normalizedVersion);
  const targetBinaryPath = path.join(versionBinDir, command);
  let fileCount: number | undefined;

  // 创建版本目录
  fs.mkdirSync(versionBinDir, { recursive: true });
  fs.mkdirSync(versionLibDir, { recursive: true });

  if (fileType === "executable") {
    // 单文件：直接复制到版本 bin 目录
    fs.copyFileSync(downloadResult.filePath, targetBinaryPath);
    fs.chmodSync(targetBinaryPath, 0o755);
  } else {
    // 压缩包：解压到临时目录
    const tmpExtractDir = path.join(
      getCacheDir(),
      agent_id,
      normalizedVersion,
      "_extract",
    );
    const extractedFiles = await extractArchive(
      downloadResult.filePath,
      fileType,
      tmpExtractDir,
      platformEntry.url,
    );
    fileCount = extractedFiles.length;

    if (isSystemCommand(command)) {
      // 系统命令（如 node、python）：所有文件直接解压到版本目录根目录
      // 入口文件由系统/运行时提供，不需要在压缩包中查找
      // args 中的路径相对于版本目录，如 {PREFIX_WORKSPACE_DIR}/acp-agent/2978/1.0.0/dist/bundle.mjs
      log.info(
        `[AgentInstaller] System command "${command}", extracting all files to version dir`,
      );
      for (const file of extractedFiles) {
        const relativePath = path.relative(tmpExtractDir, file);
        const targetPath = path.join(versionDir, relativePath);
        fs.mkdirSync(path.dirname(targetPath), { recursive: true });
        fs.copyFileSync(file, targetPath);
      }
    } else {
      // 自定义命令：查找入口可执行文件
      const entryFile = findEntryFile(tmpExtractDir, command);
      if (!entryFile) {
        throw new Error(
          `Entry file not found: ${command} (extracted ${extractedFiles.length} files)`,
        );
      }

      // 移动入口文件到版本 bin 目录
      fs.copyFileSync(entryFile, targetBinaryPath);
      fs.chmodSync(targetBinaryPath, 0o755);

      // 其余文件移动到版本 lib 目录
      for (const file of extractedFiles) {
        if (file !== entryFile) {
          const relativePath = path.relative(tmpExtractDir, file);
          const targetPath = path.join(versionLibDir, relativePath);
          fs.mkdirSync(path.dirname(targetPath), { recursive: true });
          fs.copyFileSync(file, targetPath);
        }
      }
    }

    // 清理临时解压目录
    fs.rmSync(tmpExtractDir, { recursive: true, force: true });
  }

  // 7. 创建/更新符号链接到全局 bin 目录（系统命令跳过）
  if (!isSystemCommand(command)) {
    const globalBinDir = getAgentBinDir();
    fs.mkdirSync(globalBinDir, { recursive: true });
    const symlinkPath = path.join(globalBinDir, command);

    // 如果符号链接已存在，先删除
    if (fs.existsSync(symlinkPath)) {
      fs.unlinkSync(symlinkPath);
    }

    // 创建符号链接指向当前版本
    try {
      fs.symlinkSync(targetBinaryPath, symlinkPath);
    } catch (err) {
      // Windows 可能不支持符号链接，改用复制
      if (process.platform === "win32") {
        fs.copyFileSync(targetBinaryPath, symlinkPath);
      } else {
        throw err;
      }
    }
  }

  // 8. 更新注册表
  // 系统命令的 binary_path 指向版本目录根目录（args 中的脚本路径相对于此）
  const manifestBinaryPath = isSystemCommand(command)
    ? versionDir
    : targetBinaryPath;

  const manifest: AgentManifest = {
    agent_id,
    install_type: "url",
    command,
    args,
    binary_path: manifestBinaryPath,
    version: normalizedVersion,
    source: platformEntry.url,
    platform: platformKey,
    file_size: downloadResult.fileSize,
    file_type: fileType,
    installed_at: Math.floor(Date.now() / 1000),
  };

  const existingManifests = registry.get(agent_id) || [];
  // 移除同版本的旧记录
  const filtered = existingManifests.filter(
    (m) => !m.version || normalizeVersion(m.version) !== normalizedVersion,
  );
  filtered.push(manifest);
  registry.set(agent_id, filtered);
  writeRegistry(registry);

  log.info(
    `[AgentInstaller] Agent installed: ${agent_id}@${normalizedVersion}, ` +
      `platform=${platformKey}, file_size=${downloadResult.fileSize}, ` +
      `elapsed=${Date.now() - t0}ms`,
  );

  return {
    agent_id,
    status: "available",
    binary_path: targetBinaryPath,
    file_type: fileType === "tar.gz" ? "tar.gz" : fileType,
    file_size: downloadResult.fileSize,
    file_count: fileType === "executable" ? undefined : fileCount,
    version: normalizedVersion,
    source_url: platformEntry.url,
    action: "installed",
    installed: true,
    previous_version: undefined,
    platform: platformKey,
  };
}

/**
 * 判断是否是系统/运行时命令（不需要在压缩包中查找）
 *
 * 这些命令由系统或 Electron 内置提供，Agent 压缩包中只包含脚本/资源文件。
 */
function isSystemCommand(command: string): boolean {
  const systemCommands = new Set([
    "node",
    "python",
    "python3",
    "bash",
    "sh",
    "zsh",
    "ruby",
    "perl",
    "java",
    "dotnet",
  ]);
  return systemCommands.has(path.basename(command));
}

/** 在解压目录中查找入口可执行文件 */
function findEntryFile(extractDir: string, command: string): string | null {
  // 1. 直接在根目录查找
  const directPath = path.join(extractDir, command);
  if (fs.existsSync(directPath)) return directPath;

  // 2. 递归查找
  const files = listFilesRecursive(extractDir);
  for (const file of files) {
    if (path.basename(file) === command) return file;
  }

  return null;
}

// =============================================================================
// 查询、检查、卸载
// =============================================================================

/** 列出已安装的 Agent */
export function listAgents(): ListAgentsResponse {
  ensureDirectories();
  const registry = readRegistry();

  const agents = [];
  for (const [agentId, manifests] of registry.entries()) {
    // 取最新版本
    const latest = manifests.sort((a, b) => b.installed_at - a.installed_at)[0];
    agents.push({
      agent_id: agentId,
      install_type: latest.install_type,
      status: checkAgentStatus(latest),
      version: latest.version,
      binary_path: latest.binary_path,
      installed_at: latest.installed_at,
    });
  }

  return {
    system_info: getSystemInfo(),
    agents,
    total: agents.length,
    install_dir: getAgentInstallDir(),
  };
}

/** 检查 Agent 状态 */
export function checkAgent(
  agentId: string,
  version?: string,
): CheckAgentResponse {
  ensureDirectories();
  const registry = readRegistry();
  const manifests = registry.get(agentId);

  const systemInfo = getSystemInfo();

  if (!manifests || manifests.length === 0) {
    return {
      system_info: systemInfo,
      agent: {
        agent_id: agentId,
        install_type: "unknown",
        installed: false,
        status: "not_installed",
        version: undefined,
        version_check_supported: false,
        static_checks: {
          file_exists: false,
          executable: false,
          in_path: false,
        },
      },
    };
  }

  // 查找指定版本或最新版本
  let manifest: AgentManifest;
  if (version) {
    const found = manifests.find(
      (m) =>
        m.version && normalizeVersion(m.version) === normalizeVersion(version),
    );
    if (!found) {
      return {
        system_info: systemInfo,
        agent: {
          agent_id: agentId,
          install_type: "unknown",
          installed: false,
          status: "not_installed",
          version: undefined,
          version_check_supported: false,
          static_checks: {
            file_exists: false,
            executable: false,
            in_path: false,
          },
        },
      };
    }
    manifest = found;
  } else {
    manifest = manifests.sort((a, b) => b.installed_at - a.installed_at)[0];
  }

  const binaryExists = fs.existsSync(manifest.binary_path);
  let executable = false;
  try {
    const stat = fs.statSync(manifest.binary_path);
    executable = (stat.mode & 0o111) !== 0;
  } catch {
    // 文件不存在
  }

  // 使用 which 验证 command 是否在 PATH 中
  const inPath = !!resolveCustomAgentBinary(manifest.command);

  return {
    system_info: systemInfo,
    agent: {
      agent_id: agentId,
      install_type: manifest.install_type,
      installed: true,
      status: checkAgentStatus(manifest),
      version: manifest.version,
      version_check_supported: !!manifest.version,
      static_checks: {
        file_exists: binaryExists,
        executable,
        in_path: inPath,
      },
    },
  };
}

/** 检查 Agent 状态 */
function checkAgentStatus(manifest: AgentManifest): AgentInstallStatus {
  if (!fs.existsSync(manifest.binary_path)) return "broken";
  try {
    const stat = fs.statSync(manifest.binary_path);
    if ((stat.mode & 0o111) === 0) return "broken";
  } catch {
    return "broken";
  }
  return "available";
}

/** 卸载 Agent */
export function uninstallAgent(
  agentId: string,
  version?: string,
): UninstallAgentResponse {
  ensureDirectories();
  const registry = readRegistry();
  const manifests = registry.get(agentId);

  if (!manifests || manifests.length === 0) {
    throw new Error(`Agent not found: ${agentId}`);
  }

  // 拒绝卸载内置 Agent
  if (manifests.some((m) => m.install_type === "builtin")) {
    throw new Error("Cannot uninstall builtin agent");
  }

  const removedVersions: string[] = [];
  const command = manifests[0].command;

  if (version) {
    // 只卸载指定版本
    const normalizedVersion = normalizeVersion(version);
    const target = manifests.find(
      (m) => m.version && normalizeVersion(m.version) === normalizedVersion,
    );
    if (target) {
      removedVersions.push(target.version || normalizedVersion);
      // 删除版本目录
      const versionDir = getAgentVersionDir(agentId, normalizedVersion);
      if (fs.existsSync(versionDir)) {
        fs.rmSync(versionDir, { recursive: true, force: true });
      }
    }
    const remaining = manifests.filter(
      (m) => !m.version || normalizeVersion(m.version) !== normalizedVersion,
    );
    if (remaining.length > 0) {
      registry.set(agentId, remaining);
      // 更新符号链接指向最新版本
      const latest = remaining.sort(
        (a, b) => b.installed_at - a.installed_at,
      )[0];
      updateSymlink(agentId, command, latest.binary_path);
    } else {
      // 所有版本都已删除，清理 agent 目录和符号链接
      registry.delete(agentId);
      const agentDir = path.join(getAgentInstallDir(), agentId);
      if (fs.existsSync(agentDir)) {
        fs.rmSync(agentDir, { recursive: true, force: true });
      }
      removeSymlink(command);
    }
  } else {
    // 卸载所有版本
    for (const manifest of manifests) {
      removedVersions.push(manifest.version || "unknown");
    }
    // 删除整个 agent 目录
    const agentDir = path.join(getAgentInstallDir(), agentId);
    if (fs.existsSync(agentDir)) {
      fs.rmSync(agentDir, { recursive: true, force: true });
    }
    // 删除符号链接
    removeSymlink(command);
    registry.delete(agentId);
  }

  writeRegistry(registry);

  log.info(
    `[AgentInstaller] Agent uninstalled: ${agentId}, versions: ${removedVersions.join(", ")}`,
  );

  return {
    agent_id: agentId,
    uninstalled: true,
    install_type: manifests[0].install_type,
    removed_versions: removedVersions,
  };
}

// =============================================================================
// 符号链接管理
// =============================================================================

/** 更新符号链接指向新的二进制路径 */
function updateSymlink(
  agentId: string,
  command: string,
  newBinaryPath: string,
): void {
  const globalBinDir = getAgentBinDir();
  const symlinkPath = path.join(globalBinDir, command);

  // 删除旧符号链接
  if (fs.existsSync(symlinkPath)) {
    fs.unlinkSync(symlinkPath);
  }

  // 创建新符号链接
  try {
    fs.symlinkSync(newBinaryPath, symlinkPath);
  } catch (err) {
    if (process.platform === "win32") {
      fs.copyFileSync(newBinaryPath, symlinkPath);
    } else {
      log.warn(
        `[AgentInstaller] Failed to update symlink for ${command}: ${err}`,
      );
    }
  }
}

/** 删除符号链接 */
function removeSymlink(command: string): void {
  const globalBinDir = getAgentBinDir();
  const symlinkPath = path.join(globalBinDir, command);

  if (fs.existsSync(symlinkPath)) {
    fs.unlinkSync(symlinkPath);
  }
}

// =============================================================================
// 自定义 Agent 二进制解析
// =============================================================================

/**
 * 解析自定义 Agent 的二进制路径
 *
 * 查找顺序：
 * 1. node / node.exe → 应用内 bundled Node（GUI 进程 PATH 通常无 nvm node）
 * 2. acp-agent/bin/{command}
 * 3. which {command}（PATH 中查找）
 */
export function resolveCustomAgentBinary(command: string): string | null {
  // 1. Node 解释器：优先 bundled，避免 Electron GUI 找不到 shell PATH 中的 node
  if (/^node(\.exe)?$/i.test(command.trim())) {
    const nodePath = getNodeBinPathWithFallback();
    if (nodePath) {
      log.info(
        `[AgentInstaller] resolveCustomAgentBinary: "${command}" → bundled node: ${nodePath}`,
      );
      return nodePath;
    }
  }

  // 2. 从安装目录查找
  const binPath = path.join(getAgentBinDir(), command);
  if (fs.existsSync(binPath)) {
    return binPath;
  }

  // 3. PATH 中查找（同步方式）
  try {
    const whichCmd = process.platform === "win32" ? "where" : "which";
    const result = execFileSync(whichCmd, [command], {
      encoding: "utf-8",
      timeout: 5000,
    });
    const resolvedPath = result.trim().split("\n")[0];
    if (resolvedPath && fs.existsSync(resolvedPath)) {
      return resolvedPath;
    }
  } catch {
    // which/where 命令失败
  }

  return null;
}

// =============================================================================
// 工具函数
// =============================================================================

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
