/**
 * Windows-MCP manager (Electron integration)
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { spawn } from "child_process";
import { createRequire } from "module";
import { app } from "electron";
import log from "electron-log";
import { ElectronProcessRunner } from "./windowsMcpRunner.js";
import {
  getAppEnv,
  getResourcesPath,
  getUvBinPath,
} from "../system/dependencies";
import { isWindows } from "../system/shellEnv";
import { getGuiMcpPort } from "./guiAgentServer";
import { killProcessTreesListeningOnTcpPort } from "../utils/processTree";
import { APP_DATA_DIR_NAME } from "../constants";
import { t } from "../i18n";

type WindowsMcpManagerType = import("agent-gui-server").WindowsMcpManager;
type ProcessConfig = import("agent-gui-server").ProcessConfig;

type InstallSource = "offline" | "online-fallback";

interface WindowsMcpBundleManifest {
  packageName: string;
  version: string;
  resolvedSpec: string;
  generatedAt: string;
  files: string[];
}

interface WindowsMcpInstallRequest {
  packageName: string;
  version: string | null;
  resolvedSpec: string;
  runtimeVersionKey: string;
}

interface WindowsMcpRuntimeReceipt {
  schemaVersion: 1;
  packageName: string;
  version: string | null;
  resolvedSpec: string;
  source: InstallSource;
  installedAt: string;
  runtimeRoot: string;
  integrity: "ok";
}

interface RuntimeInfo {
  runtimeRoot: string;
  binPath: string;
  request: WindowsMcpInstallRequest;
}

interface CommandResult {
  code: number;
  stdout: string;
  stderr: string;
  spawnError?: string;
}

const WINDOWS_MCP_PACKAGE_NAME = "windows-mcp";
const WINDOWS_MCP_MANIFEST_FILE = "manifest.json";
const WINDOWS_MCP_RECEIPT_FILE = "receipt.json";
const WINDOWS_MCP_LOCK_FILE = "install.lock";
const INSTALL_LOCK_TIMEOUT_MS = 45_000;
const INSTALL_LOCK_STALE_MS = 5 * 60 * 1000;

let windowsMcpManager: WindowsMcpManagerType | null = null;
let processRunner: ElectronProcessRunner | null = null;
const runtimeRequire = createRequire(__filename);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getWindowsMcpBundleRoot(): string {
  return path.join(getResourcesPath(), "windows-mcp");
}

function getWindowsMcpWheelsDir(): string {
  return path.join(getWindowsMcpBundleRoot(), "wheels");
}

function getWindowsMcpManifestPath(): string {
  return path.join(getWindowsMcpBundleRoot(), WINDOWS_MCP_MANIFEST_FILE);
}

function getWindowsMcpDataRoot(): string {
  return path.join(
    app.getPath("home"),
    APP_DATA_DIR_NAME,
    "windows-mcp-runtime",
  );
}

function safeVersionSegment(version: string): string {
  return version.replace(/[^A-Za-z0-9._-]/g, "_");
}

function getRuntimeRoot(request: WindowsMcpInstallRequest): string {
  return path.join(getWindowsMcpDataRoot(), request.runtimeVersionKey);
}

function getRuntimeBinPath(runtimeRoot: string): string {
  return path.join(runtimeRoot, "bin", "windows-mcp.exe");
}

function getRuntimeReceiptPath(runtimeRoot: string): string {
  return path.join(runtimeRoot, WINDOWS_MCP_RECEIPT_FILE);
}

function buildInstallRequest(
  manifest: WindowsMcpBundleManifest | null,
): WindowsMcpInstallRequest {
  if (manifest) {
    return {
      packageName: manifest.packageName,
      version: manifest.version,
      resolvedSpec: manifest.resolvedSpec,
      runtimeVersionKey: safeVersionSegment(manifest.version),
    };
  }

  log.warn(
    "[WindowsMcp] Bundle manifest missing or invalid; using unpinned install request",
  );
  return {
    packageName: WINDOWS_MCP_PACKAGE_NAME,
    version: null,
    resolvedSpec: WINDOWS_MCP_PACKAGE_NAME,
    runtimeVersionKey: "unversioned",
  };
}

function readWindowsMcpBundleManifest(): WindowsMcpBundleManifest | null {
  const manifestPath = getWindowsMcpManifestPath();
  if (!fs.existsSync(manifestPath)) {
    return null;
  }

  try {
    const parsed = JSON.parse(
      fs.readFileSync(manifestPath, "utf-8"),
    ) as Partial<WindowsMcpBundleManifest>;

    if (
      typeof parsed.packageName !== "string" ||
      typeof parsed.version !== "string" ||
      typeof parsed.resolvedSpec !== "string" ||
      typeof parsed.generatedAt !== "string" ||
      !Array.isArray(parsed.files)
    ) {
      return null;
    }

    return {
      packageName: parsed.packageName,
      version: parsed.version,
      resolvedSpec: parsed.resolvedSpec,
      generatedAt: parsed.generatedAt,
      files: parsed.files.filter(
        (item): item is string => typeof item === "string",
      ),
    };
  } catch (error) {
    log.warn("[WindowsMcp] Failed to read bundle manifest:", error);
    return null;
  }
}

function readRuntimeReceipt(
  runtimeRoot: string,
): WindowsMcpRuntimeReceipt | null {
  const receiptPath = getRuntimeReceiptPath(runtimeRoot);
  if (!fs.existsSync(receiptPath)) {
    return null;
  }

  try {
    const parsed = JSON.parse(
      fs.readFileSync(receiptPath, "utf-8"),
    ) as Partial<WindowsMcpRuntimeReceipt>;

    if (
      parsed.schemaVersion !== 1 ||
      typeof parsed.packageName !== "string" ||
      typeof parsed.resolvedSpec !== "string" ||
      (parsed.version !== null && typeof parsed.version !== "string") ||
      typeof parsed.source !== "string" ||
      typeof parsed.installedAt !== "string" ||
      typeof parsed.runtimeRoot !== "string" ||
      parsed.integrity !== "ok"
    ) {
      return null;
    }

    return {
      schemaVersion: 1,
      packageName: parsed.packageName,
      version: parsed.version ?? null,
      resolvedSpec: parsed.resolvedSpec,
      source: parsed.source as InstallSource,
      installedAt: parsed.installedAt,
      runtimeRoot: parsed.runtimeRoot,
      integrity: "ok",
    };
  } catch {
    return null;
  }
}

function writeRuntimeReceipt(
  runtimeRoot: string,
  request: WindowsMcpInstallRequest,
  source: InstallSource,
): void {
  const receipt: WindowsMcpRuntimeReceipt = {
    schemaVersion: 1,
    packageName: request.packageName,
    version: request.version,
    resolvedSpec: request.resolvedSpec,
    source,
    installedAt: new Date().toISOString(),
    runtimeRoot,
    integrity: "ok",
  };

  fs.writeFileSync(
    getRuntimeReceiptPath(runtimeRoot),
    JSON.stringify(receipt, null, 2),
    "utf-8",
  );
}

function isRuntimeReady(
  runtimeRoot: string,
  request: WindowsMcpInstallRequest,
): boolean {
  const binPath = getRuntimeBinPath(runtimeRoot);
  if (!fs.existsSync(binPath)) {
    return false;
  }

  const receipt = readRuntimeReceipt(runtimeRoot);
  if (!receipt) {
    return false;
  }

  if (receipt.packageName !== request.packageName) {
    return false;
  }
  if (receipt.resolvedSpec !== request.resolvedSpec) {
    return false;
  }
  if (request.version && receipt.version !== request.version) {
    return false;
  }

  return true;
}

function quoteArgForLog(arg: string): string {
  return arg.includes(" ") ? `"${arg}"` : arg;
}

function commandForLog(command: string, args: string[]): string {
  return `${command} ${args.map(quoteArgForLog).join(" ")}`;
}

async function runCommand(
  command: string,
  args: string[],
  options: {
    cwd: string;
    env: Record<string, string>;
  },
): Promise<CommandResult> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let spawnError: string | undefined;

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      spawnError = error.message;
    });

    child.on("close", (code) => {
      resolve({
        code: code ?? -1,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        spawnError,
      });
    });
  });
}

function buildRuntimeWindowsMcpEnv(
  runtimeRoot: string,
  options?: { forInstall?: boolean },
): Record<string, string> {
  const env: Record<string, string> = {
    ...getAppEnv({ includeSystemPath: true }),
    ANONYMIZED_TELEMETRY: "false",
    UV_TOOL_DIR: path.join(runtimeRoot, ".uv-tool"),
    UV_TOOL_BIN_DIR: path.join(runtimeRoot, "bin"),
  };

  if (!options?.forInstall) {
    env.UV_NO_INSTALL = "1";
  } else {
    delete env.UV_NO_INSTALL;
  }

  log.info(
    `[WindowsMcp] Using runtime UV dirs: UV_TOOL_DIR=${env.UV_TOOL_DIR}, UV_TOOL_BIN_DIR=${env.UV_TOOL_BIN_DIR}`,
  );

  return env;
}

async function withInstallLock<T>(task: () => Promise<T>): Promise<T> {
  const lockPath = path.join(getWindowsMcpDataRoot(), WINDOWS_MCP_LOCK_FILE);
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });

  const startedAt = Date.now();

  for (;;) {
    try {
      const fd = fs.openSync(lockPath, "wx");
      fs.writeFileSync(
        fd,
        JSON.stringify(
          {
            pid: process.pid,
            createdAt: new Date().toISOString(),
            host: os.hostname(),
          },
          null,
          2,
        ),
        "utf-8",
      );

      try {
        return await task();
      } finally {
        try {
          fs.closeSync(fd);
        } catch {
          // ignore
        }
        try {
          fs.rmSync(lockPath, { force: true });
        } catch {
          // ignore
        }
      }
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err.code !== "EEXIST") {
        throw error;
      }

      let isStale = false;
      try {
        const stat = fs.statSync(lockPath);
        isStale = Date.now() - stat.mtimeMs > INSTALL_LOCK_STALE_MS;
      } catch {
        isStale = true;
      }

      if (isStale) {
        try {
          fs.rmSync(lockPath, { force: true });
          continue;
        } catch {
          // ignore and continue waiting
        }
      }

      if (Date.now() - startedAt > INSTALL_LOCK_TIMEOUT_MS) {
        throw new Error(
          `Timed out waiting for windows-mcp install lock: ${lockPath}`,
        );
      }

      await sleep(250);
    }
  }
}

function buildInstallError(
  title: string,
  command: string,
  args: string[],
  result: CommandResult,
): string {
  const lines = [
    title,
    `command: ${commandForLog(command, args)}`,
    `exitCode: ${result.code}`,
  ];
  if (result.spawnError) {
    lines.push(`spawnError: ${result.spawnError}`);
  }
  if (result.stderr) {
    lines.push(`stderr: ${result.stderr}`);
  }
  if (result.stdout) {
    lines.push(`stdout: ${result.stdout}`);
  }
  return lines.join("\n");
}

async function installWindowsMcpRuntime(
  runtimeRoot: string,
  request: WindowsMcpInstallRequest,
): Promise<InstallSource> {
  const uvBinPath = getUvBinPath();
  if (!fs.existsSync(uvBinPath)) {
    throw new Error(`Bundled uv not found: ${uvBinPath}`);
  }

  fs.rmSync(runtimeRoot, { recursive: true, force: true });
  fs.mkdirSync(runtimeRoot, { recursive: true });

  const env = buildRuntimeWindowsMcpEnv(runtimeRoot, { forInstall: true });
  const installCwd = runtimeRoot;
  const wheelsDir = getWindowsMcpWheelsDir();

  const offlineArgs = [
    "tool",
    "install",
    "--force",
    "--no-index",
    "--find-links",
    wheelsDir,
    request.resolvedSpec,
  ];

  let offlineError: string | null = null;
  if (fs.existsSync(wheelsDir) && fs.readdirSync(wheelsDir).length > 0) {
    log.info(
      `[WindowsMcp] offline_install_start command=${commandForLog(uvBinPath, offlineArgs)}`,
    );
    const offlineResult = await runCommand(uvBinPath, offlineArgs, {
      cwd: installCwd,
      env,
    });

    if (offlineResult.code === 0) {
      log.info("[WindowsMcp] offline_install_success");
      return "offline";
    }

    offlineError = buildInstallError(
      "Offline install failed",
      uvBinPath,
      offlineArgs,
      offlineResult,
    );
    log.warn(`[WindowsMcp] offline_install_fail\n${offlineError}`);
  } else {
    offlineError = `Offline wheels not found: ${wheelsDir}`;
    log.warn(`[WindowsMcp] offline_install_fail ${offlineError}`);
  }

  const onlineArgs = ["tool", "install", "--force", request.resolvedSpec];
  log.info(
    `[WindowsMcp] online_fallback_start offline_failed_then_online=true command=${commandForLog(uvBinPath, onlineArgs)}`,
  );
  const onlineResult = await runCommand(uvBinPath, onlineArgs, {
    cwd: installCwd,
    env,
  });

  if (onlineResult.code === 0) {
    log.info("[WindowsMcp] online_fallback_success");
    return "online-fallback";
  }

  const onlineError = buildInstallError(
    "Online fallback install failed",
    uvBinPath,
    onlineArgs,
    onlineResult,
  );
  log.warn(`[WindowsMcp] online_fallback_fail\n${onlineError}`);

  throw new Error(`${offlineError}\n\n${onlineError}`);
}

async function cleanupOldWindowsMcpRuntimes(
  currentRuntimeRoot: string,
): Promise<void> {
  const dataRoot = getWindowsMcpDataRoot();
  if (!fs.existsSync(dataRoot)) {
    return;
  }

  const entries = fs
    .readdirSync(dataRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const fullPath = path.join(dataRoot, entry.name);
      let mtimeMs = 0;
      try {
        mtimeMs = fs.statSync(fullPath).mtimeMs;
      } catch {
        // ignore stat failure
      }
      return { fullPath, mtimeMs };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs);

  const currentNormalized = path.resolve(currentRuntimeRoot);
  let keptOld = 0;

  for (const entry of entries) {
    if (path.resolve(entry.fullPath) === currentNormalized) {
      continue;
    }

    if (keptOld < 1) {
      keptOld += 1;
      continue;
    }

    try {
      fs.rmSync(entry.fullPath, { recursive: true, force: true });
      log.info(`[WindowsMcp] Removed old runtime: ${entry.fullPath}`);
    } catch (error) {
      log.warn("[WindowsMcp] Failed to remove old runtime:", error);
    }
  }
}

async function ensureWindowsMcpRuntime(options?: {
  forceReinstall?: boolean;
}): Promise<RuntimeInfo> {
  const manifest = readWindowsMcpBundleManifest();
  const request = buildInstallRequest(manifest);
  const runtimeRoot = getRuntimeRoot(request);
  const binPath = getRuntimeBinPath(runtimeRoot);

  log.info(
    `[WindowsMcp] runtime_check runtimeRoot=${runtimeRoot} spec=${request.resolvedSpec} forceReinstall=${String(options?.forceReinstall ?? false)}`,
  );

  if (!options?.forceReinstall && isRuntimeReady(runtimeRoot, request)) {
    return { runtimeRoot, binPath, request };
  }

  return withInstallLock(async () => {
    if (!options?.forceReinstall && isRuntimeReady(runtimeRoot, request)) {
      return { runtimeRoot, binPath, request };
    }

    const source = await installWindowsMcpRuntime(runtimeRoot, request);
    writeRuntimeReceipt(runtimeRoot, request, source);
    await cleanupOldWindowsMcpRuntimes(runtimeRoot);

    if (!fs.existsSync(binPath)) {
      throw new Error(
        `windows-mcp executable not found after install: ${binPath}`,
      );
    }

    return { runtimeRoot, binPath, request };
  });
}

function isTrampolineScriptPathError(errorMessage: string): boolean {
  const lower = errorMessage.toLowerCase();
  return (
    lower.includes("uv trampoline failed to canonicalize script path") ||
    lower.includes("failed to canonicalize script path")
  );
}

function getWindowsMcpManager(): WindowsMcpManagerType {
  if (!isWindows()) {
    throw new Error("WindowsMcpManager is only available on Windows");
  }
  if (!windowsMcpManager) {
    const resourcesPath = getResourcesPath();
    const libBundlePath = path.join(
      resourcesPath,
      "agent-gui-server",
      "dist",
      "lib.bundle.cjs",
    );
    const { WindowsMcpManager: WMM } = runtimeRequire(libBundlePath) as {
      WindowsMcpManager: new (cfg: {
        healthCheckInterval: number;
        startupTimeout: number;
        healthCheckTimeout: number;
        maxRestarts: number;
      }) => WindowsMcpManagerType;
    };
    windowsMcpManager = new WMM({
      healthCheckInterval: 30000,
      startupTimeout: 30000,
      healthCheckTimeout: 5000,
      maxRestarts: 3,
    });
    processRunner = new ElectronProcessRunner();
    windowsMcpManager.setProcessRunner(processRunner);
    log.info(
      "[WindowsMcp] WindowsMcpManager initialized from bundled agent-gui-server",
    );
  }
  return windowsMcpManager;
}

async function startWindowsMcpInternal(allowSelfHeal: boolean): Promise<{
  success: boolean;
  port?: number;
  error?: string;
}> {
  const runtime = await ensureWindowsMcpRuntime();

  const buildConfig = (_port: number): ProcessConfig => ({
    command: runtime.binPath,
    args: [
      "--transport",
      "streamable-http",
      "--host",
      "127.0.0.1",
      "--port",
      getGuiMcpPort().toString(),
    ],
    cwd: path.dirname(runtime.binPath),
    env: buildRuntimeWindowsMcpEnv(runtime.runtimeRoot),
  });

  const port = getGuiMcpPort();
  try {
    log.info(`[WindowsMcp] Pre-start port sweep for ${port}...`);
    await killProcessTreesListeningOnTcpPort(port);
    await sleep(450);
  } catch (error) {
    log.warn("[WindowsMcp] Pre-start port sweep:", error);
  }

  log.info(`[WindowsMcp] Starting (runtime) on port ${port}...`);

  const result = await getWindowsMcpManager().start(port, buildConfig);

  if (result.success) {
    log.info(`[WindowsMcp] Started successfully on port ${result.port}`);
    return result;
  }

  const err = result.error ?? "";
  log.error(`[WindowsMcp] Failed to start: ${err}`);

  if (allowSelfHeal && isTrampolineScriptPathError(err)) {
    log.warn(
      "[WindowsMcp] self_heal_triggered reason=canonicalize_script_path",
    );

    try {
      await getWindowsMcpManager().stop();
    } catch {
      // ignore
    }

    try {
      await ensureWindowsMcpRuntime({ forceReinstall: true });
      const retry = await startWindowsMcpInternal(false);
      log.info(
        `[WindowsMcp] self_heal_retry_result success=${String(retry.success)} error=${retry.error ?? ""}`,
      );
      if (retry.success) {
        return retry;
      }
      return {
        success: false,
        error: `${err}\nSelf-heal retry failed: ${retry.error ?? "unknown error"}`,
      };
    } catch (selfHealError) {
      const message =
        selfHealError instanceof Error
          ? selfHealError.message
          : String(selfHealError);
      log.error(`[WindowsMcp] self-heal failed: ${message}`);
      return {
        success: false,
        error: `${err}\nSelf-heal failed: ${message}`,
      };
    }
  }

  const likelyPortConflict =
    err.includes("10048") ||
    err.includes("EADDRINUSE") ||
    err.includes("Address already in use") ||
    err.includes("ready within timeout");

  if (likelyPortConflict) {
    return {
      success: false,
      error: `${err} — ${t("Claw.WindowsMcp.portInUseHint", { port: String(port) })}`,
    };
  }

  return result;
}

export async function startWindowsMcp(): Promise<{
  success: boolean;
  port?: number;
  error?: string;
}> {
  if (!isWindows()) {
    log.info("[WindowsMcp] Skipped: not Windows platform");
    return { success: true };
  }

  const status = getWindowsMcpManager().getStatus();
  if (status.running) {
    return { success: true, port: status.port };
  }

  try {
    return await startWindowsMcpInternal(true);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.error(`[WindowsMcp] Failed before start: ${message}`);
    return { success: false, error: message };
  }
}

export async function stopWindowsMcp(): Promise<{
  success: boolean;
  error?: string;
}> {
  if (!isWindows()) {
    return { success: true };
  }

  log.info("[WindowsMcp] Stopping...");
  const result = await getWindowsMcpManager().stop();

  try {
    await killProcessTreesListeningOnTcpPort(getGuiMcpPort());
  } catch (error) {
    log.warn("[WindowsMcp] TCP port sweep after stop:", error);
  }

  if (result.success) {
    log.info("[WindowsMcp] Stopped successfully");
  } else {
    log.error(`[WindowsMcp] Failed to stop: ${result.error}`);
  }

  return result;
}

export function getWindowsMcpStatus() {
  if (!isWindows()) {
    return { running: false };
  }
  return getWindowsMcpManager().getStatus();
}

export function getWindowsMcpUrl(): string | null {
  if (!isWindows()) {
    return null;
  }
  const status = getWindowsMcpManager().getStatus();
  if (!status.running || status.port === undefined) {
    return null;
  }
  return `http://127.0.0.1:${status.port}/mcp`;
}

export function isWindowsMcpAvailable(): boolean {
  if (!isWindows()) {
    return false;
  }

  const uvBinPath = getUvBinPath();
  const bundleRoot = getWindowsMcpBundleRoot();
  return fs.existsSync(uvBinPath) && fs.existsSync(bundleRoot);
}
