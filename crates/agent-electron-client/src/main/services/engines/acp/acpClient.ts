/**
 * ACP Client - Agent Client Protocol connection manager for Electron
 *
 * Spawns an ACP-compatible agent binary as a subprocess and communicates
 * via NDJSON over stdio. Uses @agentclientprotocol/sdk's ClientSideConnection + ndJsonStream.
 *
 * Supported engines:
 * - claude-code:  spawn `claude-code-acp-ts` (npm-local dependency)
 * - nuwaxcode:    spawn `nuwaxcode acp` (npm-local dependency)
 *
 * References Tauri client's rcoder_impl.rs pattern:
 * - Binaries installed as npm-local dependencies in ~/.nuwaclaw/node_modules/.bin/
 * - CLAUDE_CODE_ACP_PATH env var points to claude-code-acp-ts binary
 * - ACP protocol uses NDJSON (newline-delimited JSON) over stdin/stdout
 */

import { spawn, ChildProcess } from "child_process";
import { Readable, Writable, Transform } from "stream";
import * as path from "path";
import * as os from "os";
import * as fs from "fs";
import { app } from "electron";
import log from "electron-log";
import { getAppEnv } from "../../system/dependencies";
import { APP_DATA_DIR_NAME } from "../../constants";
import { APP_NAME_IDENTIFIER } from "../../../../shared/constants";
import { isWindows } from "../../system/shellEnv";
import { spawnJsFile, resolveNpmPackageEntry } from "../../utils/spawnNoWindow";
import { processRegistry } from "../../system/processRegistry";
import { killProcessTreeGraceful } from "../../utils/processTree";

// ==================== Types ====================

/** ACP MCP Server types (matching @agentclientprotocol/sdk schema) */
export interface AcpEnvVariable {
  name: string;
  value: string;
}

export interface AcpHttpHeader {
  name: string;
  value: string;
}

export type AcpMcpServer =
  | { name: string; command: string; args: string[]; env: AcpEnvVariable[] }
  | { name: string; url: string; headers: AcpHttpHeader[]; type: "http" }
  | { name: string; url: string; headers: AcpHttpHeader[]; type: "sse" };

/** ACP SDK module shape (loaded dynamically since it's ESM) */
export interface AcpSdkModule {
  ndJsonStream: (
    input: WritableStream,
    output: ReadableStream<Uint8Array>,
  ) => unknown;
  ClientSideConnection: new (
    clientFactory: (agent: unknown) => unknown,
    stream: unknown,
  ) => AcpClientSideConnection;
  PROTOCOL_VERSION: number;
}

/** ClientSideConnection interface */
export interface AcpClientSideConnection {
  initialize(params: {
    protocolVersion: number;
    clientCapabilities?: Record<string, unknown>;
  }): Promise<{
    protocolVersion: number;
    agentCapabilities?: Record<string, unknown>;
  }>;

  newSession(params: {
    cwd: string;
    mcpServers: Array<AcpMcpServer>;
    _meta?: { [key: string]: unknown } | null;
  }): Promise<{ sessionId: string }>;

  prompt(params: {
    sessionId: string;
    prompt: Array<{
      type: string;
      text?: string;
      uri?: string;
      mimeType?: string;
    }>;
  }): Promise<{ stopReason: string }>;

  cancel(params: { sessionId: string }): Promise<void>;

  closed: Promise<void>;
}

/** ACP Client handler interface (callbacks from agent → client) */
export interface AcpClientHandler {
  sessionUpdate?(params: {
    sessionId: string;
    update: AcpSessionUpdate;
  }): Promise<void>;

  requestPermission?(
    params: AcpPermissionRequest,
  ): Promise<AcpPermissionResponse>;

  readTextFile?(params: {
    sessionId: string;
    uri: string;
  }): Promise<{ content: string }>;

  writeTextFile?(params: {
    sessionId: string;
    uri: string;
    content: string;
  }): Promise<Record<string, never>>;
}

/** ACP session update types */
export type AcpSessionUpdate =
  | AcpAgentMessageChunk
  | AcpAgentThoughtChunk
  | AcpToolCall
  | AcpToolCallUpdate
  | AcpSessionInfoUpdate
  | AcpUsageUpdate
  | { sessionUpdate: string; [key: string]: unknown };

export interface AcpAgentMessageChunk {
  sessionUpdate: "agent_message_chunk";
  content: { type: string; text?: string };
}

export interface AcpAgentThoughtChunk {
  sessionUpdate: "agent_thought_chunk";
  content: { type: string; text?: string };
}

export interface AcpToolCall {
  sessionUpdate: "tool_call";
  toolCallId: string;
  title: string;
  kind?: string;
  status: string;
  rawInput?: unknown;
  content?: Array<{ type: string; [key: string]: unknown }>;
  locations?: unknown[];
}

export interface AcpToolCallUpdate {
  sessionUpdate: "tool_call_update";
  toolCallId: string;
  status: string;
  rawOutput?: unknown;
  content?: Array<{ type: string; [key: string]: unknown }>;
}

export interface AcpSessionInfoUpdate {
  sessionUpdate: "session_info_update";
  title?: string;
  [key: string]: unknown;
}

export interface AcpUsageUpdate {
  sessionUpdate: "usage_update";
  [key: string]: unknown;
}

export type AcpPermissionOptionKind =
  | "allow_once"
  | "allow_always"
  | "reject_once"
  | "reject_always";

export interface AcpPermissionOption {
  optionId: string;
  kind: AcpPermissionOptionKind;
  name: string;
}

export interface AcpPermissionRequest {
  sessionId: string;
  toolCall: {
    toolCallId: string;
    title?: string | null;
    kind?: string | null;
    rawInput?: unknown;
  };
  options: AcpPermissionOption[];
}

export interface AcpPermissionResponse {
  outcome: {
    outcome: "selected" | "cancelled";
    optionId?: string;
  };
}

/** Config for creating an ACP connection */
export interface AcpConnectionConfig {
  /** Binary path to spawn (e.g. claude-code-acp-ts or nuwaxcode) */
  binPath: string;
  /** Binary arguments (e.g. [] for claude-code-acp-ts, ['acp'] for nuwaxcode) */
  binArgs: string[];
  /** Whether the binary is a native executable (not a JS file) */
  isNative?: boolean;
  workspaceDir: string;
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  env?: Record<string, string>;
  /** Engine type for process registry tracking */
  engineType?: "claude-code" | "nuwaxcode";
  /** Purpose of this process (for process registry) */
  purpose?: "engine" | "warm-pool";
}

/** Result of creating an ACP connection */
export interface AcpConnectionResult {
  connection: AcpClientSideConnection;
  process: ChildProcess;
  /** Isolated HOME directory created for this ACP process (for cleanup) */
  isolatedHome: string;
  /**
   * 🔧 FIX: Cleanup function to properly dispose of the ACP process.
   * Removes all event listeners to prevent handle leaks.
   *
   * IMPORTANT: Call this before destroying the process to release Windows handles!
   */
  cleanup: () => void;
}

// ==================== SDK Loader ====================

let _acpSdkPromise: Promise<AcpSdkModule> | null = null;

/**
 * Dynamically load the ACP SDK (@agentclientprotocol/sdk).
 *
 * Uses `new Function('s', 'return import(s)')` to bypass CJS → ESM restriction
 * (tsc compiles import() to require() in CJS mode).
 */
export function loadAcpSdk(): Promise<AcpSdkModule> {
  if (!_acpSdkPromise) {
    const dynamicImport = new Function(
      "specifier",
      "return import(specifier)",
    ) as (specifier: string) => Promise<AcpSdkModule>;

    _acpSdkPromise = dynamicImport("@agentclientprotocol/sdk").catch(
      (error) => {
        log.error("[AcpClient] Failed to load ACP SDK:", error);
        _acpSdkPromise = null;
        throw error;
      },
    );
  }

  return _acpSdkPromise;
}

// ==================== Binary Path ====================

/** Get ~/.nuwaclaw/ base directory */
function getAppDataDir(): string {
  return path.join(app.getPath("home"), APP_DATA_DIR_NAME);
}

/**
 * Get ACP package directory
 */
function getAcpPackageDir(packageName: string): string | null {
  const nodeModules = path.join(
    app.getPath("home"),
    APP_DATA_DIR_NAME,
    "node_modules",
  );
  const packageDir = path.join(nodeModules, packageName);
  return fs.existsSync(packageDir) ? packageDir : null;
}

/**
 * Resolve ACP binary path for a given engine type.
 *
 * - claude-code → ~/.nuwaclaw/node_modules/claude-code-acp-ts (JS entry, spawned via node)
 * - nuwaxcode   → native Go binary (spawned directly, not via node)
 *
 * For nuwaxcode, we resolve the platform-specific native binary directly
 * instead of going through the JS wrapper (nuwaxcode/bin/nuwaxcode).
 *
 * Reasons:
 * 1. The JS wrapper uses `spawnSync(binary, args, { stdio: 'inherit' })`
 *    without `windowsHide: true`, causing console popup on Windows.
 * 2. The intermediate Node.js process adds an unnecessary process layer
 *    that can interfere with SIGTERM propagation and stdio piping.
 * 3. Spawning the native binary directly is faster and more reliable.
 *
 * Returns `isNative: true` when the binary should be spawned directly
 * (not via `node`).
 */
export function resolveAcpBinary(engine: "claude-code" | "nuwaxcode"): {
  binPath: string;
  binArgs: string[];
  isNative: boolean;
} {
  if (engine === "claude-code") {
    const packageDir = getAcpPackageDir("claude-code-acp-ts");
    const entryPath = packageDir
      ? resolveNpmPackageEntry(packageDir, "claude-code-acp-ts")
      : null;
    return {
      binPath: entryPath || "",
      binArgs: [],
      isNative: false,
    };
  }

  // nuwaxcode: resolve platform-specific native binary directly
  const nativePath = resolveNuwaxcodeNativeBinary();
  if (nativePath) {
    log.info(`[AcpClient] nuwaxcode: 使用原生二进制: ${nativePath}`);
    return {
      binPath: nativePath,
      binArgs: ["acp"],
      isNative: true,
    };
  }

  // Fallback: use JS wrapper (will have Windows popup issue)
  log.warn("[AcpClient] nuwaxcode: 未找到原生二进制，回退到 JS wrapper");
  const packageDir = getAcpPackageDir("nuwaxcode");
  const entryPath = packageDir
    ? resolveNpmPackageEntry(packageDir, "nuwaxcode")
    : null;
  return {
    binPath: entryPath || "",
    binArgs: ["acp"],
    isNative: false,
  };
}

/**
 * Resolve the platform-specific nuwaxcode native binary path.
 *
 * nuwaxcode npm package uses optionalDependencies with platform-specific packages:
 * - nuwaxcode-darwin-arm64/bin/nuwaxcode
 * - nuwaxcode-windows-x64/bin/nuwaxcode.exe
 * - nuwaxcode-linux-x64/bin/nuwaxcode
 * etc.
 *
 * Logic mirrors nuwaxcode/bin/nuwaxcode JS wrapper.
 */
function resolveNuwaxcodeNativeBinary(): string | null {
  const platformMap: Record<string, string> = {
    darwin: "darwin",
    linux: "linux",
    win32: "windows",
  };
  const archMap: Record<string, string> = {
    x64: "x64",
    arm64: "arm64",
    arm: "arm",
  };

  const platform = platformMap[os.platform()] || os.platform();
  const arch = archMap[os.arch()] || os.arch();
  const binary = platform === "windows" ? "nuwaxcode.exe" : "nuwaxcode";
  const base = `nuwaxcode-${platform}-${arch}`;

  // Search from nuwaxcode package dir upwards for the platform package
  const nuwaxcodeDir = getAcpPackageDir("nuwaxcode");
  if (!nuwaxcodeDir) return null;

  let current = path.dirname(nuwaxcodeDir); // node_modules/
  while (true) {
    const candidate = path.join(current, base, "bin", binary);
    if (fs.existsSync(candidate)) {
      return candidate;
    }
    // Also check inside node_modules/ if current is not already
    const nmCandidate = path.join(current, "node_modules", base, "bin", binary);
    if (fs.existsSync(nmCandidate)) {
      return nmCandidate;
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }

  return null;
}

// ==================== Connection Factory ====================

/**
 * Create an ACP connection by spawning an agent binary and establishing
 * a ClientSideConnection over NDJSON stdin/stdout.
 *
 * Works with any ACP-compatible binary:
 * - claude-code-acp-ts (no args)
 * - nuwaxcode acp (args: ['acp'])
 */
export async function createAcpConnection(
  config: AcpConnectionConfig,
  clientHandler: AcpClientHandler,
): Promise<AcpConnectionResult> {
  const { binPath, binArgs } = config;

  if (!fs.existsSync(binPath)) {
    throw new Error(
      `ACP binary not found at: ${binPath}. Please install it first.`,
    );
  }

  // Build isolated environment (aligned with rcoder + engineManager pattern)
  // 1. Start with getAppEnv() for complete isolation (node/npm/uv paths, no system PATH)
  // 2. Create isolated HOME/config dir so Claude Code uses empty config (not user's global ~/.claude/)
  // 3. Only inject model vars from ACP-provided config

  // Create isolated HOME directory with empty .claude/ config
  // This prevents Claude Code from reading user's global ~/.claude/settings.json
  const runId = `acp-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
  const isolatedHome = path.join(
    os.tmpdir(),
    `${APP_NAME_IDENTIFIER}-${runId}`,
  );
  fs.mkdirSync(path.join(isolatedHome, ".claude"), { recursive: true });

  // 获取应用隔离环境变量（包含隔离的 PATH、npm、uv 配置等）
  const appEnv = getAppEnv();

  // 构建最终环境变量：以 appEnv 为基础，添加 ACP 特定配置
  const env: Record<string, string> = {
    ...appEnv, // 包含完全隔离的 PATH、NODE_PATH、npm/uv 配置等

    // Isolated HOME — Claude Code won't read user's global config
    HOME: isolatedHome,
    USERPROFILE: isolatedHome, // Windows

    // XDG 目录（Unix/Linux 标准，Windows 上也设置以兼容可能的工具）
    XDG_CONFIG_HOME: path.join(isolatedHome, ".config"),
    XDG_DATA_HOME: path.join(isolatedHome, ".local", "share"),
    XDG_CACHE_HOME: path.join(isolatedHome, ".cache"),

    // 引擎配置目录
    CLAUDE_CONFIG_DIR: path.join(isolatedHome, ".claude"),
    NUWAXCODE_CONFIG_DIR: path.join(isolatedHome, ".nuwaxcode"),

    // Disable non-essential traffic (aligned with rcoder ENV_DISABLE_NONESSENTIAL)
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
  };

  // Set model/api vars from ACP config only (never from user's global env)
  if (config.apiKey) {
    env.ANTHROPIC_API_KEY = config.apiKey;
    env.ANTHROPIC_AUTH_TOKEN = config.apiKey;
  }
  if (config.baseUrl) env.ANTHROPIC_BASE_URL = config.baseUrl;
  // config.model 必须由上层设置（ensureEngineForRequest 从 model_provider 或 agent_config env 提取）
  if (config.model) {
    env.ANTHROPIC_MODEL = config.model;
  } else {
    log.warn(
      "[AcpClient] ⚠️ config.model 未设置，引擎将使用内置默认模型（不推荐）",
    );
  }
  if (config.env) Object.assign(env, config.env);

  // Set CLAUDE_CODE_ACP_PATH for claude-code-acp-ts (matching Tauri's rcoder pattern)
  if (binPath.includes("claude-code-acp-ts")) {
    env.CLAUDE_CODE_ACP_PATH = binPath;
  }

  // 打印最终生效的模型配置（关键调试信息）
  log.info("[AcpClient] 🚀 Spawning ACP binary", {
    binPath,
    binArgs,
    cwd: config.workspaceDir,
    isolatedHome,
    ANTHROPIC_MODEL: env.ANTHROPIC_MODEL || "未设置",
    ANTHROPIC_BASE_URL: env.ANTHROPIC_BASE_URL || "未设置",
    ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY
      ? env.ANTHROPIC_API_KEY.slice(
          0,
          Math.min(8, Math.floor(env.ANTHROPIC_API_KEY.length / 2)),
        ) + "..."
      : "未设置",
    OPENCODE_MODEL: env.OPENCODE_MODEL || "未设置",
    OPENAI_BASE_URL: env.OPENAI_BASE_URL || "未设置",
    OPENAI_API_KEY: env.OPENAI_API_KEY
      ? env.OPENAI_API_KEY.slice(
          0,
          Math.min(8, Math.floor(env.OPENAI_API_KEY.length / 2)),
        ) + "..."
      : "未设置",
  });

  // 1. Spawn ACP binary
  // On Unix, use detached: true so the child gets its own process group,
  // enabling process.kill(-pid) to kill the entire tree on cleanup.
  const useDetached = !isWindows;
  let proc: ChildProcess;
  if (config.isNative) {
    // Native binary (e.g. nuwaxcode Go binary): spawn directly, no node wrapper
    // This avoids Windows console popup and eliminates the intermediate process
    proc = spawn(binPath, binArgs, {
      cwd: config.workspaceDir,
      env,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      detached: useDetached,
    });
    log.info(
      `[AcpClient] Spawned native binary directly: ${binPath} (detached=${useDetached})`,
    );
  } else {
    // JS file (e.g. claude-code-acp-ts): spawn via node using spawnJsFile
    proc = spawnJsFile(binPath, binArgs, {
      cwd: config.workspaceDir,
      env,
      stdio: ["pipe", "pipe", "pipe"],
      detached: useDetached,
    });
  }
  // Unref so the parent process can exit without waiting for the child
  // (we manage cleanup explicitly via killProcessTree)
  if (useDetached) {
    proc.unref();
  }

  // Register process in the process registry for orphan detection
  if (proc.pid) {
    processRegistry.register(proc.pid, {
      engineId: runId,
      engineType: config.engineType ?? "claude-code",
      purpose: config.purpose ?? "engine",
    });
  }

  // Log stderr — 详细输出所有内容
  proc.stderr?.on("data", (data: Buffer) => {
    const text = data.toString().trim();
    if (!text) return;
    const lower = text.toLowerCase();
    if (
      lower.includes("error") ||
      lower.includes("failed") ||
      lower.includes("enoent") ||
      lower.includes("spawn") ||
      lower.includes("mcp server") ||
      lower.includes("certificate") ||
      lower.includes("models.dev") ||
      lower.includes("providers") ||
      lower.includes("rate limit") ||
      lower.includes("使用上限")
    ) {
      log.error("[AcpClient stderr] 🔴", text);
    } else {
      log.warn("[AcpClient stderr]", text);
    }
  });

  proc.on("error", (error) => {
    log.error("[AcpClient] Process error:", error);
  });

  proc.on("exit", (code, signal) => {
    log.info("[AcpClient] Process exited", { code, signal });
  });

  /**
   * 使用 Transform 流对 stdout 做“仅打日志并透传”，避免与 SDK 争抢同一 Readable。
   * 若直接对 proc.stdout 同时 on('data') 和 Readable.toWeb(proc.stdout)，
   * Node 会形成两个消费者竞争，session/update 通知可能被 data 监听器消费，
   * SDK 收不到，导致没有 agent_message_chunk / agent_thought_chunk，前端无消息返回。
   * 0.8.1 能正常返回正是因为只有 SDK 一个消费者；新版曾加的 stdout 调试监听器导致回退。
   */
  const stdoutLogTransform = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      const text = chunk.toString();
      for (const line of text.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const preview =
          trimmed.length > 500 ? trimmed.substring(0, 500) + "..." : trimmed;
        log.info("[AcpClient stdout] 📥", preview);
      }
      this.push(chunk);
      callback();
    },
  });
  proc.stdout!.pipe(stdoutLogTransform);

  // Debug: log raw stdin NDJSON lines sent to ACP process (stdin 只写不读，无多消费者问题)
  const originalStdinWrite = proc.stdin!.write.bind(proc.stdin!);
  proc.stdin!.write = function (chunk: any, ...args: any[]) {
    const text =
      typeof chunk === "string" ? chunk : Buffer.from(chunk).toString();
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const preview =
        trimmed.length > 500 ? trimmed.substring(0, 500) + "..." : trimmed;
      log.info("[AcpClient stdin] 📤", preview);
    }
    return originalStdinWrite(chunk, ...args);
  } as any;

  // 2. Convert Node streams → Web streams（仅从 stdoutLogTransform 读，保证唯一消费者）
  // Wrap post-spawn setup in try/catch: if anything fails after spawn,
  // we must kill the process and unregister it to prevent orphans.
  let readable: ReadableStream<Uint8Array>;
  let writable: WritableStream;
  let acp: any;
  let stream: any;
  let connection: AcpClientSideConnection;

  try {
    readable = Readable.toWeb(stdoutLogTransform) as ReadableStream<Uint8Array>;
    writable = Writable.toWeb(proc.stdin!) as WritableStream;

    // 3. Load ACP SDK and create NDJSON stream
    acp = await loadAcpSdk();
    stream = acp.ndJsonStream(writable, readable);

    // 4. Create ClientSideConnection with client handler
    connection = new acp.ClientSideConnection(
      (_agent: unknown) => clientHandler,
      stream,
    ) as AcpClientSideConnection;
  } catch (e) {
    // Post-spawn setup failed — kill the spawned process to prevent orphan
    log.error("[AcpClient] Post-spawn setup failed, killing process:", e);
    if (proc.pid) {
      processRegistry.unregister(proc.pid);
      await killProcessTreeGraceful(proc.pid, 3000).catch(() => {});
    } else {
      proc.kill();
    }
    throw e;
  }

  // 🔧 FIX: Create cleanup function to properly dispose of event listeners
  // This prevents handle leaks by removing all event listeners before process termination
  const cleanup = () => {
    try {
      // Remove stdout listener (prevents handle leak)
      proc.stdout?.removeAllListeners();
      // Remove stderr listener (prevents handle leak)
      proc.stderr?.removeAllListeners();
      // Remove stdin listener (also restores the wrapped write function)
      proc.stdin?.removeAllListeners();
      // Remove process-level listeners (error, exit)
      proc.removeAllListeners();
      log.info(
        "[AcpClient] 🧹 Cleaned up event listeners to prevent handle leaks",
      );
    } catch (e) {
      log.warn("[AcpClient] Cleanup error:", e);
    }
  };

  return { connection, process: proc, isolatedHome, cleanup };
}
