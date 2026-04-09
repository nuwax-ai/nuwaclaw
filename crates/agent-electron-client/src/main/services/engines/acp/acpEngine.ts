/**
 * AcpEngine — ACP protocol handler for claude-code & nuwaxcode.
 *
 * Both engines communicate via the Agent Client Protocol (NDJSON over stdin/stdout).
 * The only difference is the binary spawned:
 * - claude-code → claude-code-acp-ts
 * - nuwaxcode   → nuwaxcode acp
 */

import { EventEmitter } from "events";
import * as os from "os";
import * as path from "path";
import * as fs from "fs";
import log from "electron-log";
import type { ChildProcess } from "child_process";
import { FEATURES } from "@shared/featureFlags";
import { getGuiAgentServerUrl } from "@main/services/packages/guiAgentServer";
import { getWindowsMcpUrl } from "@main/services/packages/windowsMcp";
import { isWindows } from "@main/services/system/shellEnv";
import {
  getResourcesPath,
  getAppEnv,
  getBundledGitBashPath,
} from "@main/services/system/dependencies";
import {
  getSandboxPolicy,
  resolveSandboxType,
  getBundledLinuxBwrapPath,
  getBundledWindowsSandboxHelperPath,
} from "@main/services/sandbox/policy";
import { SandboxError, SandboxErrorCode } from "@shared/errors/sandbox";
import type { SandboxProcessConfig } from "@shared/types/sandbox";
import {
  createAcpConnection,
  getMcpTransportSnapshot,
  isMcpReconnectWindowActive,
  loadAcpSdk,
  resolveAcpBinary,
  type AcpClientSideConnection,
  type AcpClientHandler,
  type AcpSessionUpdate,
  type AcpAgentMessageChunk,
  type AcpAgentThoughtChunk,
  type AcpToolCall,
  type AcpToolCallUpdate,
  type AcpSessionInfoUpdate,
  type AcpPermissionRequest,
  type AcpPermissionResponse,
  type AcpPermissionOption,
  type AcpMcpServer,
  type AcpEnvVariable,
} from "./acpClient";
import { AcpTerminalManager } from "./acpTerminalManager";
import { evaluateStrictWritePermission } from "./strictPermissionGuard";
import type {
  AgentConfig,
  AcpSessionStatus,
  SdkSession,
  MessageWithParts,
  PromptOptions,
  AssistantMessage,
  TextPart,
} from "../unifiedAgent";
import type {
  HttpResult,
  ComputerChatRequest,
  ComputerChatResponse,
  UnifiedSessionMessage,
  ModelProviderConfig,
} from "@shared/types/computerTypes";
import { memoryService } from "../../memory";
import type { ModelConfig } from "../../memory/types";
import { redactForLog, redactStringForLog } from "../../utils/logRedact";
import {
  killProcessTree,
  killProcessTreeGraceful,
} from "../../utils/processTree";
import { processRegistry } from "../../system/processRegistry";
import { t } from "../../i18n";
import type { DetailedSession } from "@shared/types/sessions";
import { ACP_ABORT_TIMEOUT } from "@shared/constants";
import { APP_DATA_DIR_NAME } from "../../constants";
import { perfEmitter } from "../perf/perfEmitter";
import { firstTokenTrace } from "../perf/firstTokenTrace";

/** Safe JSON.stringify that handles circular references */
function safeStringify(obj: unknown): string {
  try {
    return JSON.stringify(obj);
  } catch {
    return String(obj);
  }
}

const MCP_RETRY_DELAY_MS = 1200;
const MCP_RECONNECT_WINDOW_MS = 4000;
const GUI_MCP_NAME = "gui-agent";
// 该文案会透传到上层调用方/界面，必须走 i18n，避免在非英文语言下出现硬编码英文提示。
// 使用函数延迟求值，避免模块加载时 t() 在 initI18n() 之前执行
function getMcpReconnectPromptMessage(): string {
  return t("Claw.Errors.mcpReconnectRetryLater");
}

function isGuiMcpName(name: string): boolean {
  return name.trim().toLowerCase() === GUI_MCP_NAME;
}
const NUWAX_MCP_INIT_POLICY_DEFAULT: NonNullable<
  PromptOptions["mcpInitPolicy"]
> = "non_blocking";
const NUWAX_MCP_INIT_TIMEOUT_MS_DEFAULT = 500;

interface AcpSession {
  id: string;
  title?: string;
  acpSessionId?: string;
  createdAt: number;
  status: AcpSessionStatus;
  projectId?: string;
  lastActivity?: number;
  openLongMemory?: boolean; // 记忆开关，用于事件处理器判断
  memoryModel?: string; // 记忆处理使用的模型名（来自 model_provider.default_model）
}

// Session counter removed — ACP protocol UUID is used as canonical session.id

export class AcpEngine extends EventEmitter {
  private config: AgentConfig | null = null;
  private _ready = false;
  private acpConnection: AcpClientSideConnection | null = null;
  private acpProcess: ChildProcess | null = null;
  private isolatedHome: string | null = null;
  /** 🔧 FIX: Store cleanup function to properly dispose of event listeners */
  private processCleanup: (() => void) | null = null;
  /** Sandbox resource cleanup (temp profiles, etc.) */
  private sandboxCleanup: (() => void) | null = null;
  /** Terminal manager for ACP terminal/* methods (per-command sandboxing) */
  private terminalManager: AcpTerminalManager | null = null;
  /** Stored sandbox config for use in createSession (MCP Bash injection) */
  private storedSandboxConfig: SandboxProcessConfig | null = null;
  private sessions = new Map<string, AcpSession>();
  private pendingPermissions = new Map<
    string,
    {
      resolve: (r: AcpPermissionResponse) => void;
      options: AcpPermissionOption[];
    }
  >();
  private activePromptSessions = new Set<string>();
  private activePromptRejects = new Map<string, (reason: Error) => void>();
  private strictPermissionSnapshotLoggedSessions = new Set<string>();
  private logTag: string;

  private readonly _engineName: "claude-code" | "nuwaxcode";

  constructor(engineName: "claude-code" | "nuwaxcode" = "claude-code") {
    super();
    this._engineName = engineName;
    this.logTag = `[AcpEngine:${engineName}]`;
  }

  get isReady(): boolean {
    return this._ready && this.acpConnection !== null;
  }

  /** Engine type (claude-code | nuwaxcode), used by UnifiedAgent for provider detection */
  get engineName(): "claude-code" | "nuwaxcode" {
    return this._engineName;
  }

  /** Number of active sessions in this engine */
  get sessionCount(): number {
    return this.sessions.size;
  }

  /** Get the current engine configuration */
  get currentConfig(): AgentConfig | null {
    return this.config;
  }

  /**
   * 更新引擎配置（复用预热引擎时调用，确保 mcpServers 等与本请求的 effectiveConfig 一致，
   * 否则 createSession 会使用 init 时的旧 MCP 配置，导致动态 context_servers 不生效）。
   */
  updateConfig(config: AgentConfig): void {
    this.config = config;
  }

  getActivePromptCount(): number {
    return this.activePromptSessions.size;
  }

  private toErrorMessage(error: unknown): string {
    return error instanceof Error
      ? error.message
      : typeof error === "object" && error !== null
        ? safeStringify(error)
        : String(error);
  }

  private isPromptCancellationError(errorMsg: string): boolean {
    const lower = errorMsg.toLowerCase();
    return (
      lower.includes("session is terminating") ||
      lower.includes("abort") ||
      lower.includes("cancel") ||
      errorMsg.includes("会话已取消") ||
      errorMsg.includes("Session cancelled")
    );
  }

  private isMcpReconnectErrorMessage(errorMsg: string): boolean {
    const lower = errorMsg.toLowerCase();
    return (
      (lower.includes("transport error") &&
        (lower.includes("sse stream disconnected") ||
          lower.includes("typeerror: terminated"))) ||
      lower.includes("sse stream disconnected") ||
      lower.includes("typeerror: terminated") ||
      lower.includes("mcp session reconnected") ||
      lower.includes("connection terminated") ||
      lower.includes("stream disconnected")
    );
  }

  private isMcpReconnectFailure(errorMsg: string): boolean {
    if (this.engineName !== "nuwaxcode") return false;
    return (
      this.isMcpReconnectErrorMessage(errorMsg) ||
      isMcpReconnectWindowActive(this.acpProcess, MCP_RECONNECT_WINDOW_MS)
    );
  }

  private buildPromptMeta(
    opts?: PromptOptions,
  ): Record<string, unknown> | undefined {
    const meta: Record<string, unknown> = {};
    if (opts?.messageID) {
      meta.requestId = opts.messageID;
      meta.request_id = opts.messageID;
    }
    if (this.engineName === "nuwaxcode") {
      const policy = opts?.mcpInitPolicy ?? NUWAX_MCP_INIT_POLICY_DEFAULT;
      if (policy) {
        meta.mcpInitPolicy = policy;
      }
      const timeoutMs =
        opts?.mcpInitTimeoutMs ?? NUWAX_MCP_INIT_TIMEOUT_MS_DEFAULT;
      if (
        typeof timeoutMs === "number" &&
        Number.isFinite(timeoutMs) &&
        timeoutMs >= 0
      ) {
        meta.mcpInitTimeoutMs = Math.floor(timeoutMs);
      }
    }
    return Object.keys(meta).length > 0 ? meta : undefined;
  }

  private async sleep(ms: number): Promise<void> {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, ms);
    });
  }

  private isStrictSandboxActiveForNuwaxcode(): boolean {
    return (
      this.engineName === "nuwaxcode" &&
      this.storedSandboxConfig?.enabled === true &&
      this.storedSandboxConfig.mode === "strict"
    );
  }

  /** Get the PID of the underlying ACP process (for process registry) */
  getProcessPid(): number | undefined {
    return this.acpProcess?.pid;
  }

  // === Lifecycle ===

  async init(config: AgentConfig): Promise<boolean> {
    const timer = perfEmitter.start();
    firstTokenTrace.trace("acp.init.start", { engine: this.engineName });
    this.config = config;
    const envModel = config.env?.OPENCODE_MODEL || config.env?.ANTHROPIC_MODEL;
    log.info(`${this.logTag} 🚀 Init config`, {
      engine: this.engineName,
      config_model: config.model || "(not set)",
      env_model: envModel || "(not set)",
      baseUrl: config.baseUrl || "(default)",
      apiKey_set: !!config.apiKey,
      workspaceDir: config.workspaceDir,
      env_keys: config.env ? Object.keys(config.env) : [],
      mcpServers: config.mcpServers ? Object.keys(config.mcpServers) : [],
    });
    try {
      const configTimer = perfEmitter.start();

      // Resolve binary path and args for the engine type
      const { binPath, binArgs, isNative } = resolveAcpBinary(this.engineName);

      // For nuwaxcode: inject config via OPENCODE_CONFIG_CONTENT env var
      const spawnEnv = { ...(config.env || {}) };
      if (this.engineName === "nuwaxcode") {
        const configObj: Record<string, unknown> = {};
        const isWarmupProcess = spawnEnv.NUWAX_AGENT_WARMUP === "1";

        // A/B test mode: inject MCP into OPENCODE_CONFIG_CONTENT again.
        // This restores legacy dual-path injection (static config + ACP newSession).
        // NOTE: warmup 进程也必须注入 MCP，否则复用 warmup 后会出现 MCP.tools() 为空。
        if (config.mcpServers && Object.keys(config.mcpServers).length > 0) {
          const mcpConfig: Record<string, unknown> = {};
          for (const [name, srv] of Object.entries(config.mcpServers)) {
            if ("url" in srv && srv.url) {
              const urlSrv = srv as { url: string; type?: string };
              mcpConfig[name] = {
                type: urlSrv.type === "sse" ? "sse" : "streamable-http",
                url: urlSrv.url,
                enabled: true,
              };
            } else if ("command" in srv) {
              const stdioSrv = srv as {
                command: string;
                args?: string[];
                env?: Record<string, string>;
              };
              mcpConfig[name] = {
                type: "local",
                command: [stdioSrv.command, ...(stdioSrv.args || [])],
                environment: stdioSrv.env || {},
                enabled: true,
              };
            }
          }
          configObj.mcp = mcpConfig;
        }

        // 1. Permission bypass (question: deny to avoid interactive prompts)
        configObj.permission = {
          edit: "allow",
          bash: "allow",
          webfetch: "allow",
          doom_loop: "allow",
          external_directory: "allow",
          question: "deny",
        };

        const configContent = JSON.stringify(configObj);
        spawnEnv.OPENCODE_CONFIG_CONTENT = configContent;
        log.info(
          `${this.logTag} 🔌 nuwaxcode config 注入 (OPENCODE_CONFIG_CONTENT)`,
          {
            mcp_injection: isWarmupProcess
              ? "enabled (legacy dual-path for A/B, warmup process)"
              : "enabled (legacy dual-path for A/B)",
            mcp_servers: configObj.mcp
              ? Object.keys(configObj.mcp as Record<string, unknown>)
              : [],
            permission: {
              edit: "allow",
              bash: "allow",
              webfetch: "allow",
              doom_loop: "allow",
              external_directory: "allow",
              question: "deny",
            },
            content: configContent,
          },
        );
      }

      // Spawn ACP binary and create ClientSideConnection
      configTimer.end("acp.init.config", { engine: this.engineName });

      // Resolve sandbox policy for process-level wrapping
      let sandboxConfig: SandboxProcessConfig | undefined;
      try {
        const policy = getSandboxPolicy();
        if (policy.enabled) {
          const resolved = await resolveSandboxType(policy);
          if (resolved.type !== "none") {
            sandboxConfig = {
              enabled: true,
              type: resolved.type,
              mode: policy.mode,
              autoFallback: policy.autoFallback,
              projectWorkspaceDir: config.workspaceDir,
              networkEnabled: true, // 引擎需要网络访问（API 调用）
              fallback: "degrade_to_off",
              linuxBwrapPath: getBundledLinuxBwrapPath() ?? undefined,
              windowsSandboxHelperPath:
                getBundledWindowsSandboxHelperPath() ?? undefined,
              windowsSandboxMode: policy.windowsMode,
            };
            log.info(`${this.logTag} Sandbox config resolved:`, {
              type: resolved.type,
              mode: policy.mode,
              autoFallback: policy.autoFallback,
              degraded: resolved.degraded,
            });
          }
        }
      } catch (e) {
        if (
          e instanceof SandboxError &&
          e.code === SandboxErrorCode.SANDBOX_UNAVAILABLE
        ) {
          throw e;
        }
        log.warn(
          `${this.logTag} Sandbox policy parse failed, running without sandbox:`,
          e,
        );
      }

      // Per-command sandboxing for nuwaxcode on Windows:
      // Process-level wrapping is bypassed (EPERM), so inject sandbox helper config
      // into OPENCODE_CONFIG_CONTENT so nuwaxcode can self-sandbox individual commands.
      // Must happen AFTER sandboxConfig is resolved.
      if (
        sandboxConfig?.enabled &&
        sandboxConfig.type === "windows-sandbox" &&
        this.engineName === "nuwaxcode" &&
        sandboxConfig.windowsSandboxHelperPath
      ) {
        try {
          const existingConfig = JSON.parse(
            spawnEnv.OPENCODE_CONFIG_CONTENT as string,
          ) as Record<string, unknown>;
          existingConfig.sandbox = {
            helper_path: sandboxConfig.windowsSandboxHelperPath,
            mode: sandboxConfig.windowsSandboxMode ?? "workspace-write",
            network_enabled: true, // engine always needs network (API calls)
          };
          spawnEnv.OPENCODE_CONFIG_CONTENT = JSON.stringify(existingConfig);
          log.info(
            `${this.logTag} per-command sandbox config injected`,
            existingConfig.sandbox,
          );
        } catch (e) {
          log.warn(
            `${this.logTag} failed to inject sandbox config into OPENCODE_CONFIG_CONTENT:`,
            e,
          );
        }
      }

      // GUI MCP (gui-agent) and sandbox are mutually exclusive for now.
      // Remove gui-agent from legacy OPENCODE_CONFIG_CONTENT injection path
      // when sandbox is enabled, so nuwaxcode won't bootstrap GUI MCP.
      if (
        this.engineName === "nuwaxcode" &&
        sandboxConfig?.enabled &&
        spawnEnv.OPENCODE_CONFIG_CONTENT
      ) {
        try {
          const injectedConfig = JSON.parse(
            spawnEnv.OPENCODE_CONFIG_CONTENT,
          ) as {
            mcp?: Record<string, unknown>;
          };
          if (injectedConfig.mcp) {
            let removed = 0;
            for (const key of Object.keys(injectedConfig.mcp)) {
              if (isGuiMcpName(key)) {
                delete injectedConfig.mcp[key];
                removed += 1;
              }
            }
            if (removed > 0) {
              spawnEnv.OPENCODE_CONFIG_CONTENT = JSON.stringify(injectedConfig);
              log.warn(
                `${this.logTag} Removed gui-agent MCP from OPENCODE_CONFIG_CONTENT because sandbox is enabled`,
                { removed },
              );
            }
          }
        } catch (e) {
          log.warn(
            `${this.logTag} Failed to enforce gui-agent/sandbox mutual exclusion in OPENCODE_CONFIG_CONTENT`,
            e,
          );
        }
      }

      // Create Terminal Manager for per-command sandboxing via ACP Terminal API.
      // claude-code-acp-ts uses terminal/create for bash execution.
      // On Windows, this routes through nuwax-sandbox-helper.exe run.
      // On macOS/Linux, commands are executed directly.
      if (
        sandboxConfig?.enabled &&
        sandboxConfig.type === "windows-sandbox" &&
        sandboxConfig.windowsSandboxHelperPath
      ) {
        this.terminalManager = new AcpTerminalManager({
          windowsSandboxHelperPath: sandboxConfig.windowsSandboxHelperPath,
          windowsSandboxMode: sandboxConfig.windowsSandboxMode,
          networkEnabled: sandboxConfig.networkEnabled ?? true,
          writablePaths: sandboxConfig.projectWorkspaceDir
            ? [sandboxConfig.projectWorkspaceDir]
            : [],
          mode: sandboxConfig.mode,
        });
        log.info(
          `${this.logTag} Terminal manager initialized (Windows sandbox)`,
        );
      } else {
        this.terminalManager = new AcpTerminalManager();
        log.info(
          `${this.logTag} Terminal manager initialized (direct execution)`,
        );
      }

      // Store sandbox config for use in createSession (MCP Bash injection)
      this.storedSandboxConfig = sandboxConfig ?? null;

      // Build ACP client handler AFTER terminalManager is initialized
      // so that getClientHandlers() spread includes terminal methods.
      const clientHandler = this.buildClientHandler();

      const spawnTimer = perfEmitter.start();
      const {
        connection,
        process: proc,
        isolatedHome,
        cleanup,
        sandboxCleanup: acpSandboxCleanup,
      } = await createAcpConnection(
        {
          binPath,
          binArgs,
          isNative,
          workspaceDir: config.workspaceDir,
          apiKey: config.apiKey,
          baseUrl: config.baseUrl,
          model: config.model,
          apiProtocol: config.apiProtocol,
          env: spawnEnv,
          engineType: this.engineName,
          purpose: config.purpose ?? "engine",
          sandbox: sandboxConfig,
        },
        clientHandler,
      );

      spawnTimer.end("acp.init.spawn", { engine: this.engineName });

      this.acpConnection = connection;
      this.acpProcess = proc;
      this.isolatedHome = isolatedHome;
      this.processCleanup = cleanup; // 🔧 FIX: Store cleanup function
      this.sandboxCleanup = acpSandboxCleanup ?? null;

      // Handle process exit
      proc.on("exit", (code, signal) => {
        const exitPid = proc.pid;
        log.info(`${this.logTag} ACP process exited`, { code, signal });
        // Unregister from process registry
        if (exitPid) {
          processRegistry.unregister(exitPid);
          // Kill remaining child processes (MCP proxy + MCP servers).
          // The parent ACP process is already dead, but children may still be alive.
          // Use killProcessTree which handles both process group kill and
          // recursive descendant kill (for when detached didn't create a new PGID).
          killProcessTree(exitPid, "SIGTERM").catch(() => {});
        }
        if (this._ready) {
          this._ready = false;
          this.acpConnection = null;
          this.acpProcess = null;

          // Reject all active prompts so they don't hang
          for (const [, reject] of this.activePromptRejects) {
            reject(new Error(`ACP process exited unexpectedly (code=${code})`));
          }
          this.activePromptRejects.clear();

          this.emit(
            "error",
            new Error(`ACP process exited unexpectedly (code=${code})`),
          );
        }
      });

      // Initialize ACP protocol handshake
      const handshakeTimer = perfEmitter.start();
      const acp = await loadAcpSdk();
      const initResult = await connection.initialize({
        protocolVersion: acp.PROTOCOL_VERSION,
        clientCapabilities: {
          terminal: true, // Enable ACP Terminal API (terminal/create, etc.)
        },
      });

      handshakeTimer.end("acp.init.handshake", { engine: this.engineName });

      log.info(`${this.logTag} ACP initialized`, {
        protocolVersion: initResult.protocolVersion,
        agentCapabilities: initResult.agentCapabilities,
      });

      this._ready = true;
      this.emit("ready");
      timer.end("acp.init.total", { engine: this.engineName });
      firstTokenTrace.trace("acp.init.ready", { engine: this.engineName });
      return true;
    } catch (error) {
      log.error(`${this.logTag} Init failed:`, error);
      firstTokenTrace.trace(
        "acp.init.failed",
        { engine: this.engineName },
        {
          error:
            error instanceof Error
              ? error.message
              : typeof error === "object"
                ? safeStringify(error)
                : String(error),
        },
      );
      // Ensure spawned process is cleaned up on init failure
      await this.destroy().catch(() => {});
      this.emit(
        "error",
        error instanceof Error ? error : new Error(String(error)),
      );
      return false;
    }
  }

  async destroy(): Promise<void> {
    // Cancel all active sessions
    for (const [, session] of this.sessions) {
      if (session.acpSessionId && this.activePromptSessions.has(session.id)) {
        try {
          await this.acpConnection?.cancel({ sessionId: session.acpSessionId });
        } catch (e) {
          log.warn(`${this.logTag} Cancel session error on destroy:`, e);
        }
      }
    }

    // Reject all pending permissions
    for (const [id, pending] of this.pendingPermissions) {
      pending.resolve({ outcome: { outcome: "cancelled" } });
      this.pendingPermissions.delete(id);
    }

    // Reject all active prompts
    for (const [sessionId, reject] of this.activePromptRejects) {
      reject(new Error("AcpEngine destroyed"));
      this.activePromptRejects.delete(sessionId);
    }

    // Kill ACP process tree (prevents zombie child processes)
    if (this.acpProcess) {
      const pid = this.acpProcess.pid;
      log.info(`${this.logTag} Killing ACP process tree, pid=${pid}`);
      // Unregister from process registry before killing
      if (pid) {
        processRegistry.unregister(pid);
      }
      try {
        // 🔧 FIX: Call cleanup function first to remove all event listeners
        // This prevents handle leaks by releasing references to stdout/stderr/stdin
        if (this.processCleanup) {
          this.processCleanup();
          this.processCleanup = null;
        }

        // Additional safety: remove listeners directly
        this.acpProcess.stdout?.removeAllListeners();
        this.acpProcess.stderr?.removeAllListeners();
        this.acpProcess.stdin?.removeAllListeners();
        this.acpProcess.removeAllListeners();

        if (pid) {
          // Use process tree kill to ensure all child processes are cleaned up
          await killProcessTreeGraceful(pid, 5000);
          log.info(
            `${this.logTag} killProcessTreeGraceful completed for pid=${pid}`,
          );
        } else {
          this.acpProcess.kill();
        }
      } catch (e) {
        log.warn(`${this.logTag} Process kill error:`, e);
      }
      this.acpProcess = null;
    }

    // Cleanup isolated HOME directory
    if (this.isolatedHome) {
      try {
        fs.rmSync(this.isolatedHome, { recursive: true, force: true });
        log.info(
          `${this.logTag} 🧹 Cleaned isolated directory: ${this.isolatedHome}`,
        );
      } catch (e) {
        log.warn(`${this.logTag} Isolated directory cleanup failed:`, e);
      }
      this.isolatedHome = null;
    }

    // Cleanup sandbox resources (temp seatbelt profiles, etc.)
    if (this.sandboxCleanup) {
      try {
        this.sandboxCleanup();
      } catch (e) {
        log.warn(`${this.logTag} Sandbox resource cleanup failed:`, e);
      }
      this.sandboxCleanup = null;
    }

    // Cleanup terminal manager (kill running processes, release resources)
    if (this.terminalManager) {
      try {
        await this.terminalManager.releaseAll();
      } catch (e) {
        log.warn(`${this.logTag} Terminal manager cleanup failed:`, e);
      }
      this.terminalManager = null;
    }

    this.acpConnection = null;
    this.sessions.clear();
    this.activePromptSessions.clear();
    this.activePromptRejects.clear();
    this.strictPermissionSnapshotLoggedSessions.clear();
    this.config = null;
    this._ready = false;
    log.info(`${this.logTag} Destroyed`);
    this.emit("destroyed");
  }

  // === Session Management ===

  async createSession(opts?: {
    title?: string;
    cwd?: string;
    mcpServers?: Record<
      string,
      {
        command?: string;
        args?: string[];
        env?: Record<string, string>;
        url?: string;
        type?: string;
      }
    >;
    systemPrompt?: string;
    requestId?: string;
  }): Promise<SdkSession> {
    if (!this.acpConnection || !this.config) {
      throw new Error("AcpEngine not initialized");
    }

    // Build mcpServers array for ACP (McpServerStdio format)
    const mcpServers: AcpMcpServer[] = [];

    const toAcpMcpServer = (
      name: string,
      srv: {
        command?: string;
        args?: string[];
        env?: Record<string, string>;
        url?: string;
        type?: string;
      },
    ): AcpMcpServer => {
      // HTTP/SSE URL 类型（来自 PersistentMcpBridge）
      if ("url" in srv && srv.url) {
        return {
          name,
          url: srv.url,
          headers: [],
          type: (srv.type || "http") as "http" | "sse",
        };
      }
      // stdio 类型（降级）
      const envVars: AcpEnvVariable[] = [];
      if (srv.env) {
        for (const [k, v] of Object.entries(srv.env)) {
          envVars.push({ name: k, value: v });
        }
      }
      return {
        name,
        command: srv.command!,
        args: srv.args || [],
        env: envVars,
      };
    };

    // 1. Global MCP servers from config
    if (this.config.mcpServers) {
      for (const [name, srv] of Object.entries(this.config.mcpServers)) {
        mcpServers.push(toAcpMcpServer(name, srv));
      }
    }

    // 2. Per-request MCP servers
    if (opts?.mcpServers) {
      for (const [name, srv] of Object.entries(opts.mcpServers)) {
        if (mcpServers.some((m) => m.name === name)) continue;
        mcpServers.push(toAcpMcpServer(name, srv));
      }
    }

    const sandboxEnabled = this.storedSandboxConfig?.enabled === true;

    // GUI MCP (gui-agent) and sandbox are mutually exclusive for now.
    // Drop gui-agent from both global and per-request MCP inputs when sandbox is on.
    if (sandboxEnabled) {
      const before = mcpServers.length;
      const filtered = mcpServers.filter(
        (server) => !isGuiMcpName(server.name),
      );
      const removed = before - filtered.length;
      if (removed > 0) {
        mcpServers.length = 0;
        mcpServers.push(...filtered);
        log.warn(
          `${this.logTag} Removed gui-agent MCP from session request because sandbox is enabled`,
          { removed },
        );
      }
    }

    // [临时测试代码 - 正式发布前将 .env.production 中 INJECT_GUI_MCP 设为 false]
    // 通过 FEATURES.INJECT_GUI_MCP 控制是否注入 GUI Agent MCP（由 .env.development/.env.production 在运行时决定）
    // 用于本地开发/打包测试 GUI 桌面自动化功能，正式发布时由服务器下发 context_servers
    // macOS/Linux：内嵌 agent-gui-server → getGuiAgentServerUrl()
    // Windows：独立 windows-mcp 子进程（uv）→ getWindowsMcpUrl()；getGuiAgentServerUrl() 在 Win 上恒为 null
    if (
      FEATURES.INJECT_GUI_MCP &&
      !sandboxEnabled &&
      !mcpServers.some((m) => isGuiMcpName(m.name))
    ) {
      const guiMcpUrl = isWindows()
        ? getWindowsMcpUrl()
        : getGuiAgentServerUrl();
      if (guiMcpUrl) {
        mcpServers.push({
          name: GUI_MCP_NAME,
          url: guiMcpUrl,
          headers: [],
          type: "http",
        });
        log.info(`${this.logTag} 🔧 Injecting GUI Agent MCP: ${guiMcpUrl}`);
      }
    } else if (FEATURES.INJECT_GUI_MCP && sandboxEnabled) {
      log.info(
        `${this.logTag} Skip GUI Agent MCP injection because sandbox is enabled`,
      );
    }

    // 3. Sandboxed Bash MCP — replace built-in Bash with sandboxed version on Windows
    // Disables Claude Code's internal Bash (which runs unsandboxed) and provides
    // an MCP "Bash" tool that routes all commands through nuwax-sandbox-helper.exe run.
    log.info(
      `${this.logTag} 🔍 Sandbox check: engine=${this.engineName}, sandboxEnabled=${this.storedSandboxConfig?.enabled}, type=${this.storedSandboxConfig?.type}, helperPath=${this.storedSandboxConfig?.windowsSandboxHelperPath ?? "(none)"}`,
    );
    if (
      this.engineName === "claude-code" &&
      this.storedSandboxConfig?.enabled &&
      this.storedSandboxConfig.type === "windows-sandbox" &&
      this.storedSandboxConfig.windowsSandboxHelperPath
    ) {
      const nodePath = process.execPath; // Electron's Node
      // Use getResourcesPath() for both dev and packaged resolution.
      // Script is bundled at resources/sandboxed-bash-mcp/sandboxed-bash-mcp.mjs
      const scriptPath = path.join(
        getResourcesPath(),
        "sandboxed-bash-mcp",
        "sandboxed-bash-mcp.mjs",
      );
      const resolvedScriptPath = path.resolve(scriptPath);

      // Build PATH with bundled tools (node, git, etc.) so sandboxed shell
      // can find them even under a restricted token with minimal PATH.
      const appEnv = getAppEnv({ includeSystemPath: false });
      const gitBashPath = getBundledGitBashPath();

      mcpServers.push({
        name: "sandboxed-bash",
        command: nodePath,
        args: [resolvedScriptPath],
        env: [
          { name: "ELECTRON_RUN_AS_NODE", value: "1" },
          {
            name: "NUWAX_SANDBOX_HELPER_PATH",
            value: this.storedSandboxConfig.windowsSandboxHelperPath,
          },
          {
            name: "NUWAX_SANDBOX_MODE",
            value:
              this.storedSandboxConfig.windowsSandboxMode ?? "workspace-write",
          },
          {
            name: "NUWAX_SANDBOX_NETWORK_ENABLED",
            value:
              (this.storedSandboxConfig.networkEnabled ?? true) ? "1" : "0",
          },
          {
            name: "NUWAX_SANDBOX_WRITABLE_ROOTS",
            value: JSON.stringify(
              this.storedSandboxConfig.projectWorkspaceDir
                ? [this.storedSandboxConfig.projectWorkspaceDir]
                : [],
            ),
          },
          // Pass bundled tools PATH for sandboxed shell execution
          ...(appEnv.PATH
            ? [{ name: "NUWAX_SANDBOX_PATH", value: appEnv.PATH }]
            : []),
          // Pass Git Bash path so MCP script can use bash instead of PowerShell
          ...(gitBashPath
            ? [{ name: "NUWAX_SANDBOX_GIT_BASH_PATH", value: gitBashPath }]
            : []),
        ],
      });
      log.info(
        `${this.logTag} 🔒 Sandboxed Bash MCP injected (Windows, mode=${this.storedSandboxConfig.windowsSandboxMode ?? "workspace-write"})`,
      );
    }

    // Sandbox mode — shared by sandboxed-fs MCP injection and disallowedTools below.
    const sandboxMode = this.storedSandboxConfig?.mode ?? "compat";
    const isStrictOrCompat = sandboxMode !== "permissive";

    // 4. Sandboxed FS MCP — replace built-in Write/Edit with sandboxed versions on Windows
    // Only injected in strict and compat modes. Permissive mode leaves built-in tools enabled.
    // - strict:  only workspace + TEMP/TMP
    // - compat:  workspace + TEMP/TMP + APPDATA/LOCALAPPDATA
    if (
      this.engineName === "claude-code" &&
      this.storedSandboxConfig?.enabled &&
      this.storedSandboxConfig.type === "windows-sandbox" &&
      isStrictOrCompat
    ) {
      const nodePath = process.execPath;
      const fsScriptPath = path.join(
        getResourcesPath(),
        "sandboxed-fs-mcp",
        "sandboxed-fs-mcp.mjs",
      );
      const resolvedFsScriptPath = path.resolve(fsScriptPath);

      mcpServers.push({
        name: "sandboxed-fs",
        command: nodePath,
        args: [resolvedFsScriptPath],
        env: [
          { name: "ELECTRON_RUN_AS_NODE", value: "1" },
          {
            name: "NUWAX_SANDBOX_MODE",
            value: sandboxMode,
          },
          {
            name: "NUWAX_SANDBOX_WRITABLE_ROOTS",
            value: JSON.stringify(
              this.storedSandboxConfig.projectWorkspaceDir
                ? [this.storedSandboxConfig.projectWorkspaceDir]
                : [],
            ),
          },
          // Pass TEMP/TMP explicitly for temp file validation
          ...(process.env.TEMP
            ? [{ name: "TEMP", value: process.env.TEMP }]
            : []),
          ...(process.env.TMP ? [{ name: "TMP", value: process.env.TMP }] : []),
          // Pass APPDATA/LOCALAPPDATA for compat mode
          ...(process.env.APPDATA
            ? [{ name: "APPDATA", value: process.env.APPDATA }]
            : []),
          ...(process.env.LOCALAPPDATA
            ? [{ name: "LOCALAPPDATA", value: process.env.LOCALAPPDATA }]
            : []),
        ],
      });
      log.info(
        `${this.logTag} 🔒 Sandboxed FS MCP injected (Windows, mode=${sandboxMode})`,
      );
    }

    const sessionCwd = opts?.cwd || this.config.workspaceDir;

    // Build _meta with systemPrompt if provided (skip if empty or whitespace only)
    const systemPromptTrimmed = opts?.systemPrompt?.trim();
    const requestId = opts?.requestId;
    const isWindowsSandbox =
      this.engineName === "claude-code" &&
      this.storedSandboxConfig?.enabled === true &&
      this.storedSandboxConfig.type === "windows-sandbox";

    const _meta: Record<string, unknown> | undefined = (() => {
      const meta: Record<string, unknown> = {};
      if (systemPromptTrimmed) {
        meta.systemPrompt = { append: systemPromptTrimmed };
      }
      if (requestId) {
        meta.requestId = requestId;
        meta.request_id = requestId;
      }
      // Disable built-in tools on Windows sandbox — replaced by MCP sandboxed tools.
      // claude-code-acp-ts reads _meta.claudeCode.options.disallowedTools and merges
      // with its default disallowedTools (["AskUserQuestion"]).
      // - Bash is always blocked (replaced by sandboxed-bash MCP)
      // - Write/Edit/NotebookEdit are blocked in strict/compat (replaced by sandboxed-fs MCP)
      // - In permissive mode, built-in Write/Edit/NotebookEdit remain available
      if (isWindowsSandbox) {
        const disallowed = ["Bash"];
        if (isStrictOrCompat) {
          disallowed.push("Write", "Edit", "NotebookEdit");
        }
        meta.claudeCode = {
          options: {
            disallowedTools: disallowed,
          },
        };
      }
      return Object.keys(meta).length > 0 ? meta : undefined;
    })();

    const newSessionParams = {
      cwd: sessionCwd,
      mcpServers,
      _meta,
    };
    firstTokenTrace.trace(
      "acp.new_session.sent",
      { projectId: opts?.title, engine: this.engineName, requestId },
      {
        cwd: sessionCwd,
        mcpCount: mcpServers.length,
        hasMetaRequestId: !!requestId,
      },
    );
    log.info(
      `${this.logTag} newSession: cwd=${sessionCwd}, mcpServers=${mcpServers.length}, hasSystemPrompt=${!!opts?.systemPrompt}`,
    );
    log.debug(`${this.logTag} newSession debug`, {
      systemPrompt: systemPromptTrimmed,
      systemPromptLength: systemPromptTrimmed?.length ?? 0,
      mcpServersJson: JSON.stringify(mcpServers, null, 2),
    });
    const timer = perfEmitter.start();
    let acpResult: { sessionId: string };
    try {
      acpResult = await this.acpConnection.newSession(newSessionParams);
    } catch (err) {
      log.error(`${this.logTag} ❌ ACP newSession failed:`, err);
      throw err;
    }
    const createMs = timer.end("acp.session.create", {
      mcpCount: mcpServers.length,
    });

    log.info(
      `${this.logTag} ✅ ACP newSession 完成 (${createMs}ms), acpSessionId=${acpResult.sessionId}`,
    );
    firstTokenTrace.trace(
      "acp.new_session.done",
      {
        sessionId: acpResult.sessionId,
        projectId: opts?.title,
        engine: this.engineName,
      },
      { createMs, mcpCount: mcpServers.length },
    );

    const sessionId = acpResult.sessionId;
    const session: AcpSession = {
      id: sessionId,
      title: opts?.title,
      acpSessionId: sessionId,
      createdAt: Date.now(),
      status: "idle",
      lastActivity: Date.now(),
    };
    this.sessions.set(sessionId, session);

    log.info(`${this.logTag} Session created`, {
      sessionId,
    });

    return {
      id: sessionId,
      title: session.title,
      time: { created: session.createdAt },
    };
  }

  async listSessions(): Promise<SdkSession[]> {
    return Array.from(this.sessions.values()).map((s) => ({
      id: s.id,
      title: s.title,
      time: { created: s.createdAt },
    }));
  }

  /**
   * List sessions with detailed status info (for Sessions tab).
   */
  listSessionsDetailed(): DetailedSession[] {
    return Array.from(this.sessions.values()).map((s) => ({
      id: s.id,
      title: s.title,
      engineType: this._engineName,
      projectId: s.projectId,
      status: s.status,
      createdAt: s.createdAt,
      lastActivity: s.lastActivity,
    }));
  }

  async getSession(id: string): Promise<SdkSession> {
    const s = this.sessions.get(id);
    if (!s) throw new Error(`Session not found: ${id}`);
    return { id: s.id, title: s.title, time: { created: s.createdAt } };
  }

  async deleteSession(id: string): Promise<boolean> {
    return this.sessions.delete(id);
  }

  async abortSession(id?: string): Promise<boolean> {
    if (!this.acpConnection) return false;

    const cancelOne = async (
      sessionId: string,
      session: AcpSession,
    ): Promise<void> => {
      if (!session.acpSessionId) {
        log.warn(
          `${this.logTag} Session ${sessionId} has no acpSessionId, skip cancel`,
        );
        return;
      }

      session.status = "terminating";

      // 0. Kill any terminals associated with this session
      if (this.terminalManager) {
        try {
          await this.terminalManager.releaseForSession(sessionId);
        } catch (e) {
          log.warn(
            `${this.logTag} Terminal cleanup for session ${sessionId} failed:`,
            e,
          );
        }
      }

      // 1. Reject local prompt immediately for fast UX feedback.
      const reject = this.activePromptRejects.get(sessionId);
      if (reject) {
        reject(new Error("Session cancelled"));
        this.activePromptRejects.delete(sessionId);
      }

      this.activePromptSessions.delete(sessionId);

      // 2. Send cancel to ACP binary
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          this.acpConnection!.cancel({ sessionId: session.acpSessionId }),
          new Promise<void>((_, reject) => {
            timer = setTimeout(
              () => reject(new Error("Abort timeout")),
              ACP_ABORT_TIMEOUT,
            );
          }),
        ]);
      } catch (e) {
        log.warn(`${this.logTag} Cancel error/timeout for ${sessionId}:`, e);
      } finally {
        if (timer !== undefined) clearTimeout(timer);
      }

      session.status = "idle";
      session.lastActivity = Date.now();
    };

    if (id) {
      const session = this.sessions.get(id);
      if (!session || !this.activePromptSessions.has(id)) {
        return false;
      }
      await cancelOne(id, session);
      return true;
    } else {
      const cancellable = Array.from(this.sessions.entries()).filter(
        ([sessionId, session]) =>
          session.acpSessionId && this.activePromptSessions.has(sessionId),
      );
      const cancelled = cancellable.length > 0;
      await Promise.all(
        cancellable.map(([sessionId, session]) =>
          cancelOne(sessionId, session),
        ),
      );
      return cancelled;
    }
  }

  // === Prompt (Core) ===

  async prompt(
    sessionId: string,
    parts: Array<{ type: string; text?: string; [key: string]: unknown }>,
    _opts?: PromptOptions,
  ): Promise<MessageWithParts> {
    const timer = perfEmitter.start();
    if (!this.acpConnection || !this.config) {
      throw new Error("AcpEngine not initialized");
    }

    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session not found: ${sessionId}`);
    if (!session.acpSessionId)
      throw new Error(`Session has no ACP session: ${sessionId}`);
    if (session.status === "terminating") {
      throw new Error("Session is terminating");
    }

    const promptContent: Array<{
      type: string;
      text?: string;
      uri?: string;
      mimeType?: string;
    }> = [];
    for (const part of parts) {
      if (part.type === "text" && part.text) {
        promptContent.push({ type: "text", text: part.text });
      }
    }

    if (promptContent.length === 0) throw new Error("Empty prompt");

    this.activePromptSessions.add(sessionId);
    session.status = "active";
    session.lastActivity = Date.now();

    const waitTimer = perfEmitter.start();
    timer.end("acp.prompt.prepare", { sessionId });

    this.emit("computer:promptStart", {
      sessionId,
      acpSessionId: session.acpSessionId,
      requestId: _opts?.messageID,
    });
    firstTokenTrace.trace(
      "acp.prompt.start_event",
      {
        requestId: _opts?.messageID,
        sessionId,
        projectId: session.projectId,
        engine: this.engineName,
      },
      { acpSessionId: session.acpSessionId },
    );

    let resultText = "";
    const promptSentAt = Date.now();
    let firstUpdateAt: number | undefined;
    const onProgress = (message: UnifiedSessionMessage) => {
      if (message.sessionId !== sessionId) return;
      if (message.subType !== "agent_message_chunk") return;
      if (firstUpdateAt !== undefined) return;
      firstUpdateAt = Date.now();
      firstTokenTrace.trace(
        "acp.prompt.first_update",
        {
          requestId: _opts?.messageID,
          sessionId,
          projectId: session.projectId,
          engine: this.engineName,
        },
        { latencyMs: firstUpdateAt - promptSentAt },
      );
      perfEmitter.duration(
        "acp.prompt.sendToFirstUpdate",
        firstUpdateAt - promptSentAt,
        {
          sessionId,
        },
      );
      perfEmitter.point("acp.prompt.firstUpdate", { sessionId });
    };
    this.on("computer:progress", onProgress);

    try {
      log.info(`${this.logTag} Starting prompt`, {
        sessionId,
        acpSessionId: session.acpSessionId,
        promptLength: promptContent.length,
        promptPreview: promptContent
          .map((p) => p.text?.substring(0, 100))
          .join(", "),
      });

      const promptStartTime = Date.now();
      perfEmitter.point("acp.prompt.sent", { sessionId });
      log.info(`${this.logTag} 📤 ACP prompt sending...`);
      firstTokenTrace.trace("acp.prompt.sent", {
        requestId: _opts?.messageID,
        sessionId,
        projectId: session.projectId,
        engine: this.engineName,
      });

      const result = await new Promise<{ stopReason: string }>(
        (resolve, reject) => {
          this.activePromptRejects.set(sessionId, reject);

          const promptParams = {
            sessionId: session.acpSessionId!,
            prompt: promptContent,
            _meta: this.buildPromptMeta(_opts),
          };
          if (this.engineName === "nuwaxcode") {
            log.info(`${this.logTag} acp.prompt.meta`, {
              sessionId,
              requestId: _opts?.messageID,
              mcpInitPolicy: promptParams._meta?.mcpInitPolicy,
              mcpInitTimeoutMs: promptParams._meta?.mcpInitTimeoutMs,
            });
          }

          const runPromptWithRetry = async () => {
            const maxAttempts = this.engineName === "nuwaxcode" ? 2 : 1;
            let attempt = 1;
            while (true) {
              try {
                const res = await this.acpConnection!.prompt(promptParams);
                log.info(
                  `${this.logTag} 📥 ACP prompt resolved (${Date.now() - promptStartTime}ms, attempt=${attempt}):`,
                  safeStringify(res),
                );
                return res;
              } catch (err) {
                const errMsg = this.toErrorMessage(err);
                const canRetry =
                  attempt < maxAttempts &&
                  !this.isPromptCancellationError(errMsg) &&
                  this.isMcpReconnectFailure(errMsg);

                if (!canRetry) {
                  log.error(
                    `${this.logTag} 📥 ACP prompt rejected (${Date.now() - promptStartTime}ms, attempt=${attempt}):`,
                    err,
                  );
                  throw err;
                }

                const telemetry = getMcpTransportSnapshot(this.acpProcess);
                log.warn(
                  `${this.logTag} ⚠️ 检测到 MCP 重连窗口，自动重试 prompt（attempt=${attempt + 1}/${maxAttempts}）`,
                  {
                    sessionId,
                    error: errMsg,
                    telemetry,
                  },
                );
                firstTokenTrace.trace(
                  "acp.prompt.retry.mcp_reconnect",
                  {
                    requestId: _opts?.messageID,
                    sessionId,
                    projectId: session.projectId,
                    engine: this.engineName,
                  },
                  {
                    attempt,
                    nextAttempt: attempt + 1,
                    delayMs: MCP_RETRY_DELAY_MS,
                    error: errMsg,
                    telemetry,
                  },
                );
                await this.sleep(MCP_RETRY_DELAY_MS);
                attempt += 1;
              }
            }
          };

          runPromptWithRetry().then(resolve).catch(reject);
        },
      );

      const completedAt = Date.now();
      waitTimer.end("acp.prompt.wait", {
        sessionId,
        stopReason: result.stopReason,
      });
      perfEmitter.point("acp.prompt.completed", {
        sessionId,
        stopReason: result.stopReason,
      });
      firstTokenTrace.trace(
        "acp.prompt.completed",
        {
          requestId: _opts?.messageID,
          sessionId,
          projectId: session.projectId,
          engine: this.engineName,
        },
        {
          stopReason: result.stopReason,
          totalMs: completedAt - promptSentAt,
          firstUpdateToDoneMs:
            firstUpdateAt !== undefined
              ? completedAt - firstUpdateAt
              : undefined,
        },
      );
      if (firstUpdateAt !== undefined) {
        perfEmitter.duration(
          "acp.prompt.firstUpdateToDone",
          completedAt - firstUpdateAt,
          {
            sessionId,
            stopReason: result.stopReason,
          },
        );
      }

      log.info(`${this.logTag} Prompt completed`, {
        sessionId,
        stopReason: result.stopReason,
      });

      this.emit("computer:promptEnd", {
        sessionId,
        acpSessionId: session.acpSessionId,
        reason: result.stopReason,
        description: `Prompt completed: ${result.stopReason}`,
        openLongMemory: session.openLongMemory,
        memoryModel: session.memoryModel,
      });

      this.emit("session.idle", {
        sessionId,
        openLongMemory: session.openLongMemory,
        memoryModel: session.memoryModel,
      });
    } catch (error) {
      log.error(`${this.logTag} Prompt failed:`, error);
      const errMsg = this.toErrorMessage(error);
      const isMcpReconnect = this.isMcpReconnectFailure(errMsg);
      const promptEndReason = isMcpReconnect ? "mcp_reconnecting" : "error";
      const promptEndDescription = isMcpReconnect
        ? getMcpReconnectPromptMessage()
        : errMsg;
      firstTokenTrace.trace(
        "acp.prompt.failed",
        {
          requestId: _opts?.messageID,
          sessionId,
          projectId: session.projectId,
          engine: this.engineName,
        },
        {
          error: errMsg,
          reason: promptEndReason,
        },
      );

      this.emit("computer:promptEnd", {
        sessionId,
        acpSessionId: session.acpSessionId,
        reason: promptEndReason,
        description: promptEndDescription,
        openLongMemory: session.openLongMemory,
        memoryModel: session.memoryModel,
      });

      this.emit("session.error", {
        sessionId,
        error: errMsg,
        reason: promptEndReason,
      });
    } finally {
      this.off("computer:progress", onProgress);
      this.activePromptSessions.delete(sessionId);
      this.activePromptRejects.delete(sessionId);
      // Always set idle: normal completion or after cancel (cancelOne may have set terminating).
      session.status = "idle";
      session.lastActivity = Date.now();
    }

    return {
      info: {
        role: "assistant",
        content: [{ type: "text", text: resultText }],
      } as unknown as AssistantMessage,
      parts: [{ type: "text", text: resultText } as unknown as TextPart],
    };
  }

  async promptAsync(
    sessionId: string,
    parts: Array<{ type: string; text?: string; [key: string]: unknown }>,
    opts?: PromptOptions,
  ): Promise<void> {
    this.prompt(sessionId, parts, opts).catch((error) => {
      log.error(`${this.logTag} promptAsync error:`, error);
    });
  }

  // === Permission Response ===

  respondPermission(
    permissionId: string,
    response: "once" | "always" | "reject",
  ): void {
    const pending = this.pendingPermissions.get(permissionId);
    if (!pending) {
      log.warn(`${this.logTag} No pending permission for:`, permissionId);
      return;
    }

    if (response === "reject") {
      pending.resolve({ outcome: { outcome: "cancelled" } });
    } else {
      const targetKind = response === "always" ? "allow_always" : "allow_once";
      const optionId =
        pending.options.find((o) => o.kind === targetKind)?.optionId ??
        pending.options[0]?.optionId;
      if (!optionId) {
        log.warn(
          `${this.logTag} No valid option for permission response, cancelling`,
        );
        pending.resolve({ outcome: { outcome: "cancelled" } });
      } else {
        pending.resolve({
          outcome: { outcome: "selected", optionId },
        });
      }
    }
  }

  // === Legacy compat ===

  async claudePrompt(message: string): Promise<string> {
    const session = await this.createSession({ title: "temp" });
    try {
      const result = await this.prompt(session.id, [
        { type: "text", text: message },
      ]);
      const text = result.parts
        .filter((p) => (p as any).type === "text")
        .map((p) => (p as any).text || "")
        .join("");
      return text;
    } finally {
      this.deleteSession(session.id);
    }
  }

  // === Session Status & rcoder-compat Methods ===

  getSessionStatus(sessionId: string): AcpSessionStatus | null {
    const session = this.sessions.get(sessionId);
    return session?.status ?? null;
  }

  findSessionByProjectId(projectId: string): AcpSession | null {
    if (!projectId) return null;
    for (const [, session] of this.sessions) {
      // Match by explicit projectId, internal session id, or ACP session id
      if (
        session.projectId === projectId ||
        session.id === projectId ||
        session.acpSessionId === projectId
      ) {
        return session;
      }
    }
    return null;
  }

  private shouldReinitForModelProvider(mp: ModelProviderConfig): boolean {
    if (!this.config) return false;

    const apiKey = mp.api_key || "";
    const baseUrl = mp.base_url || "";
    const model = mp.model || "";

    if (!apiKey && !baseUrl && !model) return false;

    const currentKey = this.config.apiKey || "";
    const currentUrl = this.config.baseUrl || "";
    const currentModel = this.config.model || "";

    return (
      (!!apiKey && apiKey !== currentKey) ||
      (!!baseUrl && baseUrl !== currentUrl) ||
      (!!model && model !== currentModel)
    );
  }

  async chat(
    request: ComputerChatRequest,
  ): Promise<HttpResult<ComputerChatResponse>> {
    const timer = perfEmitter.start();
    firstTokenTrace.trace("acp.chat.enter", {
      requestId: request.request_id,
      sessionId: request.session_id,
      projectId: request.project_id,
      engine: this.engineName,
    });
    if (!this.acpConnection || !this.config) {
      return {
        code: "5000",
        message: "Agent not initialized",
        data: null,
        tid: null,
        success: false,
      };
    }

    try {
      const envModel =
        this.config.env?.OPENCODE_MODEL || this.config.env?.ANTHROPIC_MODEL;
      log.info(`${this.logTag} 📨 chat() request received`, {
        user_id: request.user_id,
        project_id: request.project_id,
        session_id: request.session_id,
        request_id: request.request_id,
        agent_config: redactStringForLog(
          safeStringify(redactForLog(request.agent_config)),
        ),
        model_provider: redactForLog(request.model_provider),
        config_model: this.config.model || "(not set)",
        env_model: envModel || "(not set)",
        baseUrl_set: !!this.config.baseUrl,
        apiKey_set: !!this.config.apiKey,
        env_keys: this.config.env ? Object.keys(this.config.env) : [],
        system_prompt_length: request.system_prompt
          ? request.system_prompt.length
          : 0,
        prompt_length: request.prompt?.length ?? 0,
        has_original_user_prompt: !!request.original_user_prompt,
        open_long_memory: request.open_long_memory === true,
      });

      if (
        request.model_provider &&
        this.shouldReinitForModelProvider(request.model_provider)
      ) {
        if (this.activePromptSessions.size > 0) {
          log.warn(
            `${this.logTag} ⚠️ model_provider 变更但有 ${this.activePromptSessions.size} 个活跃 prompt，跳过 reinit，使用当前配置`,
          );
        } else {
          log.info(
            `${this.logTag} 🔄 model_provider 变更，重新初始化 ACP 连接...`,
          );
          const newConfig: AgentConfig = {
            ...this.config,
            apiKey: request.model_provider.api_key || this.config.apiKey,
            baseUrl: request.model_provider.base_url || this.config.baseUrl,
            model: request.model_provider.model || this.config.model,
            apiProtocol:
              request.model_provider.api_protocol || this.config.apiProtocol,
          };
          await this.destroy();
          const ok = await this.init(newConfig);
          if (!ok) {
            return {
              code: "5000",
              message: "Failed to reinit with new model_provider",
              data: null,
              tid: null,
              success: false,
            };
          }
        }
      }

      // 1. Find existing session or create new
      let session: AcpSession | undefined;
      let isNewSession = false;

      if (request.session_id) {
        session = this.sessions.get(request.session_id);
      }
      if (!session && request.project_id) {
        session = this.findSessionByProjectId(request.project_id) ?? undefined;
      }

      if (!session) {
        isNewSession = true;
        const projectId = request.project_id || `proj-${Date.now()}`;
        const projectDir = path.join(
          this.config.workspaceDir,
          "computer-project-workspace",
          request.user_id,
          projectId,
        );
        log.info(`${this.logTag} 📁 Project workspace: ${projectDir}`);

        // PERF: 会话创建阶段

        // context_servers 已由 ensureEngineForRequest() 同步到 proxy 聚合代理
        // (nuwax-mcp-stdio-proxy)，不再单独传给 createSession()，
        // 避免 claude-code 重复 spawn 导致 Windows 弹窗和资源浪费
        if (request.agent_config?.context_servers) {
          const servers = request.agent_config.context_servers;
          const serverNames = Object.keys(servers).filter(
            (n) => servers[n]?.enabled !== false,
          );
          log.info(
            `${this.logTag} 🔌 context_servers (aggregated by proxy): ${serverNames.join(", ") || "(none)"}`,
          );
        }

        const newSession = await this.createSession({
          title: projectId,
          cwd: projectDir,
          mcpServers: this.config.mcpServers,
          systemPrompt: request.system_prompt,
          requestId: request.request_id,
        });
        session = this.sessions.get(newSession.id)!;
        session.projectId = request.project_id;
        firstTokenTrace.trace(
          "acp.chat.session_created",
          {
            requestId: request.request_id,
            sessionId: session.id,
            projectId: request.project_id,
            engine: this.engineName,
          },
          { projectDir },
        );
      } else {
        firstTokenTrace.trace("acp.chat.session_reused", {
          requestId: request.request_id,
          sessionId: session.id,
          projectId: request.project_id,
          engine: this.engineName,
        });
      }

      timer.end("acp.chat.sessionSetup", {
        stage: "session_setup",
        sessionId: session.id,
        isNewSession,
        engine: this.engineName,
        model: this.config.model || envModel || "(not set)",
      });
      firstTokenTrace.trace(
        "acp.chat.session_ready",
        {
          requestId: request.request_id,
          sessionId: session.id,
          projectId: request.project_id,
          engine: this.engineName,
        },
        { isNewSession },
      );

      // 2. Record user message to MemoryService
      // 获取纯净用户输入（仅使用 original_user_prompt，不回退到 prompt）
      const pureUserPrompt = request.original_user_prompt || "";
      // 决定是否启用记忆（默认 false）
      const enableMemory = request.open_long_memory === true;

      // 存储记忆开关到 session，供事件处理器使用
      session.openLongMemory = enableMemory;
      // 存储记忆处理使用的模型名（优先使用 model_provider.default_model）
      session.memoryModel =
        request.model_provider?.default_model || this.config.model || "";

      // 如果 original_user_prompt 为空，打印错误日志
      if (!pureUserPrompt) {
        log.error(
          `${this.logTag} original_user_prompt 为空，无法进行记忆处理`,
          {
            session_id: session.id,
            request_id: request.request_id,
          },
        );
      }

      if (
        memoryService.isInitialized() &&
        this.config &&
        enableMemory &&
        pureUserPrompt
      ) {
        try {
          const modelConfig: ModelConfig = {
            provider: this.engineName.includes("claude")
              ? "anthropic"
              : "openai",
            model:
              request.model_provider?.default_model || this.config.model || "",
            apiKey: this.config.apiKey || "",
            baseUrl: this.config.baseUrl,
            apiProtocol:
              request.model_provider?.api_protocol || this.config.apiProtocol,
          };
          memoryService.handleMessage(
            session.id,
            { role: "user", content: pureUserPrompt },
            modelConfig,
          );
        } catch (error) {
          log.warn(
            `${this.logTag} Failed to record user message to memory:`,
            error,
          );
        }
      }

      // 3. Inject memory context into prompt
      let enhancedPrompt = request.prompt;
      const memoryTimer = perfEmitter.start();
      if (memoryService.isInitialized() && enableMemory && pureUserPrompt) {
        try {
          // 使用纯净用户输入进行记忆搜索
          const promptForMemory = pureUserPrompt.trim();
          log.debug(
            `${this.logTag} Memory search query: "${promptForMemory.slice(0, 100)}"`,
          );

          const memoryContext =
            await memoryService.getInjectionContext(promptForMemory);
          if (memoryContext && memoryContext.trim()) {
            enhancedPrompt = `<memory-context>
以下是关于用户的已知信息，请在回答时参考：
${memoryContext}
</memory-context>

用户问题：${request.prompt}`;
            log.info(
              `${this.logTag} Injected memory context (${memoryContext.length} chars)`,
            );
          }
        } catch (error) {
          log.warn(`${this.logTag} Failed to inject memory context:`, error);
        }
      }
      memoryTimer.end("acp.chat.memoryInject", {
        stage: "记忆注入",
        enabled: enableMemory,
      });

      // 4. Async prompt
      const promptOptions: PromptOptions = {
        messageID: request.request_id,
      };
      if (this.engineName === "nuwaxcode") {
        promptOptions.mcpInitPolicy = NUWAX_MCP_INIT_POLICY_DEFAULT;
        promptOptions.mcpInitTimeoutMs = NUWAX_MCP_INIT_TIMEOUT_MS_DEFAULT;
      }
      this.promptAsync(session.id, [{ type: "text", text: enhancedPrompt }], {
        ...promptOptions,
      });
      firstTokenTrace.trace("acp.prompt.dispatched", {
        requestId: request.request_id,
        sessionId: session.id,
        projectId: request.project_id,
        engine: this.engineName,
      });

      timer.end("acp.chat.total", {
        stage: "total",
        sessionId: session.id,
        isNewSession,
        engine: this.engineName,
        model: this.config.model || "(not set)",
      });

      // 5. Return HttpResult<ChatResponse>
      const chatResponse: ComputerChatResponse = {
        project_id: request.project_id || session.id,
        session_id: session.id,
        error: null,
        request_id: request.request_id,
        is_new_session: isNewSession,
      };

      log.info(`${this.logTag} ✅ chat() response: session_id=${session.id}`);
      firstTokenTrace.trace(
        "acp.chat.return",
        {
          requestId: request.request_id,
          sessionId: session.id,
          projectId: request.project_id,
          engine: this.engineName,
        },
        { success: true },
      );

      return {
        code: "0000",
        message: "success",
        data: chatResponse,
        tid: null,
        success: true,
      };
    } catch (error) {
      const rawErrorMsg = this.toErrorMessage(error);
      const errorMsg = this.isMcpReconnectFailure(rawErrorMsg)
        ? getMcpReconnectPromptMessage()
        : rawErrorMsg;
      log.error(`${this.logTag} ❌ chat() failed: ${rawErrorMsg}`);
      firstTokenTrace.trace(
        "acp.chat.failed",
        {
          requestId: request.request_id,
          sessionId: request.session_id,
          projectId: request.project_id,
          engine: this.engineName,
        },
        { error: rawErrorMsg, userMessage: errorMsg },
      );
      return {
        code: "5000",
        message: errorMsg,
        data: null,
        tid: null,
        success: false,
      };
    }
  }

  // === Internal: Build ACP Client Handler ===

  private buildClientHandler(): AcpClientHandler {
    if (!this.terminalManager) {
      log.warn(
        `${this.logTag} ⚠️ buildClientHandler called with no terminalManager — terminal methods will be missing`,
      );
    }
    return {
      sessionUpdate: async (params: {
        sessionId: string;
        update: AcpSessionUpdate;
      }): Promise<void> => {
        this.handleAcpSessionUpdate(params.sessionId, params.update);
      },

      requestPermission: async (
        params: AcpPermissionRequest,
      ): Promise<AcpPermissionResponse> => {
        return this.handlePermissionRequest(params);
      },

      // Terminal API handlers — delegated to AcpTerminalManager
      ...(this.terminalManager?.getClientHandlers() ?? {}),
    };
  }

  // === Internal: ACP → SSE Event Mapping ===

  private handleAcpSessionUpdate(
    acpSessionId: string,
    update: AcpSessionUpdate,
  ): void {
    const session = this.sessions.get(acpSessionId);
    if (!session) {
      log.warn(`${this.logTag} Unknown ACP session:`, acpSessionId);
      return;
    }

    session.lastActivity = Date.now();

    const shouldSuppressUpdates =
      session.status === "terminating" &&
      update.sessionUpdate !== "session_end" &&
      update.sessionUpdate !== "error";
    if (shouldSuppressUpdates) {
      log.debug(
        `${this.logTag} Suppress update while terminating: ${update.sessionUpdate}`,
      );
      return;
    }

    // Debug: log every ACP session update event
    log.info(
      `${this.logTag} 📩 ACP sessionUpdate: type=${update.sessionUpdate}, sessionId=${acpSessionId}`,
    );

    // sessionId and acpSessionId are the same UUID
    this.emit("computer:progress", {
      sessionId: acpSessionId,
      acpSessionId: acpSessionId,
      messageType: "agentSessionUpdate",
      subType: update.sessionUpdate,
      data: update,
      timestamp: new Date().toISOString(),
    } satisfies UnifiedSessionMessage);

    switch (update.sessionUpdate) {
      case "agent_message_chunk": {
        const u = update as AcpAgentMessageChunk;
        this.emit("message.part.updated", {
          sessionId: acpSessionId,
          type: "text",
          text: u.content?.text || "",
        });
        break;
      }

      case "agent_thought_chunk": {
        const u = update as AcpAgentThoughtChunk;
        this.emit("message.part.updated", {
          sessionId: acpSessionId,
          type: "reasoning",
          thinking: u.content?.text || "",
        });
        break;
      }

      case "tool_call": {
        const u = update as AcpToolCall;
        this.emit("message.part.updated", {
          sessionId: acpSessionId,
          type: "tool",
          toolCallId: u.toolCallId,
          name: u.title,
          kind: u.kind,
          status: u.status,
          input: u.rawInput,
          content: u.content,
        });
        break;
      }

      case "tool_call_update": {
        const u = update as AcpToolCallUpdate;
        this.emit("message.part.updated", {
          sessionId: acpSessionId,
          type: "tool",
          toolCallId: u.toolCallId,
          status: u.status,
          output: u.rawOutput,
          content: u.content,
        });
        break;
      }

      case "session_info_update": {
        const u = update as AcpSessionInfoUpdate;
        if (u.title) {
          session.title = u.title;
        }
        this.emit("session.updated", {
          sessionId: acpSessionId,
          title: u.title,
        });
        break;
      }

      case "usage_update": {
        log.info(`${this.logTag} 📊 Usage update:`, safeStringify(update));
        break;
      }

      default: {
        log.info(
          `${this.logTag} ❓ Unhandled ACP update: ${update.sessionUpdate}`,
          safeStringify(update),
        );
      }
    }
  }

  // === Internal: Permission Handling ===

  private async handlePermissionRequest(
    params: AcpPermissionRequest,
  ): Promise<AcpPermissionResponse> {
    const acpSessionId = params.sessionId;
    if (!this.sessions.has(acpSessionId)) {
      return { outcome: { outcome: "cancelled" } };
    }

    // Deny question-type requests (interactive prompts that would block the agent)
    if (params.toolCall.kind === "question") {
      log.info(
        `${this.logTag} 🚫 拒绝 question 类型请求: tool=${params.toolCall.title}`,
      );
      return { outcome: { outcome: "cancelled" } };
    }

    const strictEnabled = this.isStrictSandboxActiveForNuwaxcode();
    const strictCheck = evaluateStrictWritePermission(params, {
      strictEnabled,
      workspaceDir: this.config?.workspaceDir,
      projectWorkspaceDir: this.storedSandboxConfig?.projectWorkspaceDir,
      isolatedHome: this.isolatedHome,
      appDataDir: path.join(os.homedir(), APP_DATA_DIR_NAME),
      tempDirs: [
        os.tmpdir(),
        process.env.TMPDIR,
        process.env.TMP,
        process.env.TEMP,
      ],
    });
    if (strictEnabled) {
      if (!this.strictPermissionSnapshotLoggedSessions.has(acpSessionId)) {
        this.strictPermissionSnapshotLoggedSessions.add(acpSessionId);
        log.debug(`${this.logTag} strict writable roots snapshot`, {
          acpSessionId,
          workspaceDir: this.config?.workspaceDir,
          projectWorkspaceDir: this.storedSandboxConfig?.projectWorkspaceDir,
          isolatedHome: this.isolatedHome,
          writableRoots: strictCheck.writableRoots,
        });
      }
      const strictTrace = {
        reason: strictCheck.reason,
        isWriteRequest: strictCheck.isWriteRequest,
        toolKind: params.toolCall.kind,
        toolTitle: params.toolCall.title,
        candidatePaths: strictCheck.candidatePaths,
        resolvedPaths: strictCheck.resolvedPaths,
        writableRoots: strictCheck.writableRoots,
      };
      if (strictCheck.isWriteRequest) {
        log.debug(`${this.logTag} strict permission evaluation`, strictTrace);
      } else {
        log.debug(
          `${this.logTag} strict permission skipped (non-write request)`,
          strictTrace,
        );
      }
    }
    if (strictCheck.blocked) {
      log.debug(`${this.logTag} strict write permission blocked`, {
        reason: strictCheck.reason,
        toolKind: params.toolCall.kind,
        toolTitle: params.toolCall.title,
        candidatePaths: strictCheck.candidatePaths,
        resolvedPaths: strictCheck.resolvedPaths,
        writableRoots: strictCheck.writableRoots,
      });
      return { outcome: { outcome: "cancelled" } };
    }

    const strictWriteMode = strictEnabled && strictCheck.isWriteRequest;
    const selected = strictWriteMode
      ? params.options.find((o) => o.kind === "allow_once")
      : params.options.find((o) => o.kind === "allow_always") ||
        params.options.find((o) => o.kind === "allow_once") ||
        params.options[0];

    if (strictWriteMode && !selected) {
      log.debug(
        `${this.logTag} strict write permission blocked (allow_once option missing)`,
        {
          toolKind: params.toolCall.kind,
          toolTitle: params.toolCall.title,
        },
      );
      return { outcome: { outcome: "cancelled" } };
    }

    if (selected) {
      if (strictWriteMode) {
        log.debug(`${this.logTag} strict write permission allowed_once`, {
          toolKind: params.toolCall.kind,
          toolTitle: params.toolCall.title,
          optionId: selected.optionId,
          candidatePaths: strictCheck.candidatePaths,
          resolvedPaths: strictCheck.resolvedPaths,
        });
      } else {
        log.info(
          `${this.logTag} 🔓 权限自动放行: tool=${params.toolCall.title}, kind=${selected.kind}, optionId=${selected.optionId}`,
        );
      }
      return {
        outcome: { outcome: "selected", optionId: selected.optionId },
      };
    }

    log.warn(
      `${this.logTag} ⚠️ 权限请求无可选项,取消: tool=${params.toolCall.title}`,
    );
    return { outcome: { outcome: "cancelled" } };
  }
}
