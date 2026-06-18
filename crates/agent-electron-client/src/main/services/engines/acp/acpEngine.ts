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
import { ACP_SESSION_CANCELLED_ERROR_CODE } from "@shared/constants";
import type { SandboxProcessConfig } from "@shared/types/sandbox";
import {
  getAcpEngineSandboxCapabilities,
  isOpencodeAcpEngine,
} from "./sandbox/acpEngineSandbox";
import { resolveAcpSandboxProcessConfig } from "./sandbox/acpSandboxPolicy";
import {
  buildOpencodeSpawnConfig,
  describeOpencodeSandboxActive,
  stripGuiMcpFromOpencodeConfigContent,
} from "./sandbox/opencodeAcpSpawnConfig";
import {
  createAcpConnection,
  getMcpTransportSnapshot,
  loadAcpSdk,
  resolveAcpBinary,
  type AcpClientSideConnection,
  type AcpClientHandler,
  type AcpSessionUpdate,
  type AcpPermissionRequest,
  type AcpPermissionResponse,
} from "./acpClient";
import {
  AcpTerminalManager,
  createTerminalManagerForSandbox,
} from "./acpTerminalManager";
import { AcpPermissionCoordinator } from "./permission/permissionCoordinator";
import {
  buildNewSessionParams,
  type NewSessionOpts,
} from "./acpNewSessionParams";
import {
  toErrorMessage,
  isPromptCancellation,
  createSessionCancelledError,
  isMcpReconnectFailure as isMcpReconnectFailureWith,
  executePromptWithRetry,
} from "./acpPromptRetry";
import {
  recordUserMessageToMemory,
  buildMemoryEnhancedPrompt,
} from "./acpChatMemory";
import { mapAcpUpdateToEvents } from "./acpUpdateMapper";
import type {
  AgentConfig,
  AgentEngineType,
  AcpSessionStatus,
  SdkSession,
  MessageWithParts,
  PromptOptions,
  AssistantMessage,
  TextPart,
} from "../types";
import type {
  HttpResult,
  ComputerChatRequest,
  ComputerChatResponse,
  UnifiedSessionMessage,
  ModelProviderConfig,
} from "@shared/types/computerTypes";
import { redactForLog, redactStringForLog } from "../../utils/logRedact";
import {
  killProcessTree,
  killProcessTreeGraceful,
} from "../../utils/processTree";
import { processRegistry } from "../../system/processRegistry";
import { t } from "../../i18n";
import { resolveComputerProjectWorkspaceDir } from "../../workspacePaths";
import type { DetailedSession } from "@shared/types/sessions";
import { ACP_ABORT_TIMEOUT } from "@shared/constants";
import { APP_DATA_DIR_NAME } from "../../constants";
import { perfEmitter } from "../perf/perfEmitter";
import { firstTokenTrace } from "../perf/firstTokenTrace";
import { resolveEffectiveMode, type AcpMode } from "@shared/types/acpMode";
import {
  approvalInterventionService,
  isComputerPermissionResolveRequest,
  toComputerPermissionProgressData,
} from "../../intervention";
import {
  normalizePermissionGatedToolUpdate,
  type PermissionGatedToolInputCache,
} from "./permission/permissionGatedToolUpdate";
import type {
  NotifyResolvedRequest,
  NotifyResolvedResponse,
  ComputerNotifyResolvedRequest,
} from "@shared/types/intervention";
import { safeStringify } from "../utils/safeStringify";

const MCP_RETRY_DELAY_MS = 1200;
const MCP_RECONNECT_WINDOW_MS = 4000;
const COMPAT_MCP_WARMUP_DELAY_MS = 1200;
// 该文案会透传到上层调用方/界面，必须走 i18n，避免在非英文语言下出现硬编码英文提示。
// 使用函数延迟求值，避免模块加载时 t() 在 initI18n() 之前执行
function getMcpReconnectPromptMessage(): string {
  return t("Claw.Errors.mcpReconnectRetryLater");
}
const NUWAX_MCP_INIT_POLICY_DEFAULT: NonNullable<
  PromptOptions["mcpInitPolicy"]
> = "non_blocking";
const NUWAX_MCP_INIT_TIMEOUT_MS_DEFAULT = 500;

interface AcpSession {
  id: string;
  title?: string;
  acpSessionId?: string;
  /** Session working directory (ACP newSession cwd). */
  cwd?: string;
  createdAt: number;
  status: AcpSessionStatus;
  mcpServerCount?: number;
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
  private permissionGatedToolRawInputs = new Map<
    string,
    PermissionGatedToolInputCache
  >();
  /** 权限决策链与权限会话状态（决策逻辑见 permission/permissionCoordinator.ts） */
  private readonly permissions: AcpPermissionCoordinator;

  setEffectiveMode(acpSessionId: string, mode: AcpMode): void {
    this.permissions.setEffectiveMode(acpSessionId, mode);
  }

  private activePromptSessions = new Set<string>();
  private activePromptRejects = new Map<string, (reason: Error) => void>();
  private logTag: string;

  private readonly _engineName: string;

  constructor(engineName: string = "claude-code") {
    super();
    this._engineName = engineName;
    this.logTag = `[AcpEngine:${engineName}]`;
    this.permissions = new AcpPermissionCoordinator(this.logTag);
  }

  get isReady(): boolean {
    return this._ready && this.acpConnection !== null;
  }

  /** Engine type (claude-code | nuwaxcode), used by UnifiedAgent for provider detection */
  get engineName(): AgentEngineType {
    return this._engineName as AgentEngineType;
  }

  /** Number of active sessions in this engine */
  get sessionCount(): number {
    return this.sessions.size;
  }

  /** Get the current engine configuration */
  get currentConfig(): AgentConfig | null {
    return this.config;
  }

  /** The sandbox strictness mode used when this engine was initialized */
  get sandboxMode(): string {
    return this.storedSandboxConfig?.mode ?? "compat";
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

  // 错误分类与重试逻辑见 acpPromptRetry.ts；此处为绑定引擎上下文的薄封装。

  private isMcpReconnectFailure(errorMsg: string): boolean {
    return isMcpReconnectFailureWith(errorMsg, {
      isOpencodeEngine: isOpencodeAcpEngine(this.engineName),
      acpProcess: this.acpProcess,
      reconnectWindowMs: MCP_RECONNECT_WINDOW_MS,
    });
  }

  private buildPromptMeta(
    opts?: PromptOptions,
  ): Record<string, unknown> | undefined {
    const meta: Record<string, unknown> = {};
    if (opts?.messageID) {
      meta.requestId = opts.messageID;
      meta.request_id = opts.messageID;
    }
    if (isOpencodeAcpEngine(this.engineName)) {
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

  private getEnabledContextServerNames(
    contextServers?: Record<string, { enabled?: boolean } | undefined>,
  ): string[] {
    if (!contextServers) return [];
    return Object.keys(contextServers).filter(
      (name) => contextServers[name]?.enabled !== false,
    );
  }

  private shouldDelayCompatMcpWarmup(params: {
    isNewSession: boolean;
    mcpServerCount: number;
    contextServerCount: number;
  }): boolean {
    if (!params.isNewSession) return false;
    if (this.engineName !== "claude-code") return false;
    if (this.storedSandboxConfig?.enabled !== true) return false;
    if (this.storedSandboxConfig.mode !== "compat") return false;
    if (params.mcpServerCount <= 0) return false;
    if (params.contextServerCount <= 0) return false;
    return true;
  }

  private async waitForCompatMcpWarmupIfNeeded(params: {
    sessionId: string;
    requestId?: string;
    isNewSession: boolean;
    mcpServerCount: number;
    contextServerNames: string[];
  }): Promise<void> {
    const shouldWait = this.shouldDelayCompatMcpWarmup({
      isNewSession: params.isNewSession,
      mcpServerCount: params.mcpServerCount,
      contextServerCount: params.contextServerNames.length,
    });

    log.debug(`${this.logTag} [DEBUG] Compat MCP warmup decision`, {
      sessionId: params.sessionId,
      requestId: params.requestId,
      shouldWait,
      sandboxEnabled: this.storedSandboxConfig?.enabled === true,
      sandboxMode: this.storedSandboxConfig?.mode ?? "(none)",
      mcpServerCount: params.mcpServerCount,
      contextServerNames: params.contextServerNames,
      waitMs: shouldWait ? COMPAT_MCP_WARMUP_DELAY_MS : 0,
    });

    if (!shouldWait) return;

    const startedAt = Date.now();
    log.debug(`${this.logTag} [DEBUG] Compat MCP warmup wait start`, {
      sessionId: params.sessionId,
      requestId: params.requestId,
      waitMs: COMPAT_MCP_WARMUP_DELAY_MS,
    });
    await this.sleep(COMPAT_MCP_WARMUP_DELAY_MS);
    log.debug(`${this.logTag} [DEBUG] Compat MCP warmup wait done`, {
      sessionId: params.sessionId,
      requestId: params.requestId,
      waitMs: Date.now() - startedAt,
    });
  }

  private get sandboxCaps() {
    return getAcpEngineSandboxCapabilities(this.engineName);
  }

  private isStrictSandboxActiveForEngine(): boolean {
    return (
      this.sandboxCaps.supportsStrictSessionGuard &&
      this.storedSandboxConfig?.enabled === true &&
      this.storedSandboxConfig.mode === "strict"
    );
  }

  private resolveCodexAuthMethod(
    config: AgentConfig,
    spawnEnv: Record<string, string>,
  ): "codex-api-key" | "openai-api-key" | null {
    if (this.engineName !== "codex-cli") return null;

    const hasCodexApiKey = !!(
      config.apiKey?.trim() || spawnEnv.CODEX_API_KEY?.trim()
    );
    if (hasCodexApiKey) return "codex-api-key";

    const hasOpenAIApiKey = !!spawnEnv.OPENAI_API_KEY?.trim();
    if (hasOpenAIApiKey) return "openai-api-key";

    return null;
  }

  private async authenticateCodexWithEnv(
    connection: AcpClientSideConnection,
    config: AgentConfig,
    spawnEnv: Record<string, string>,
  ): Promise<void> {
    const methodId = this.resolveCodexAuthMethod(config, spawnEnv);
    if (!methodId) return;

    if (typeof connection.authenticate !== "function") {
      log.warn(
        `${this.logTag} ACP connection does not expose authenticate(); env API key may not be activated`,
      );
      return;
    }

    await connection.authenticate({ methodId });
    log.info(`${this.logTag} ACP env auth activated`, { methodId });
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
      // For custom agents, use customEngineCommand; otherwise use engineName
      const resolveEngine = config.customEngineCommand || this.engineName;
      const {
        binPath,
        binArgs: resolvedBinArgs,
        isNative,
      } = resolveAcpBinary(resolveEngine);
      // For custom agents, append agent_server.args as spawn arguments
      const binArgs = config.customEngineArgs
        ? [...resolvedBinArgs, ...config.customEngineArgs]
        : resolvedBinArgs;

      // For nuwaxcode: inject config via OPENCODE_CONFIG_CONTENT env var
      const spawnEnv = { ...(config.env || {}) };

      // Resolve sandbox policy early (OpenCode spawn config + process wrap + createSession).
      const sandboxResolved = await resolveAcpSandboxProcessConfig(
        config.workspaceDir,
        this.logTag,
      );
      if (sandboxResolved.unavailable) {
        throw sandboxResolved.unavailable;
      }
      const sandboxConfig = sandboxResolved.config;

      if (this.sandboxCaps.usesOpencodeSpawnConfig) {
        const isWarmupProcess = spawnEnv.NUWAX_AGENT_WARMUP === "1";
        const { configObj, sandboxApply: opencodeSandboxApply } =
          buildOpencodeSpawnConfig({
            mcpServers: config.mcpServers,
            model: config.model,
            sandboxConfig,
            workspaceDir: config.workspaceDir,
            applySandbox: (opts) =>
              this.sandboxCaps.applyOpencodeSpawnSandbox(opts),
          });

        spawnEnv.OPENCODE_CONFIG_CONTENT = JSON.stringify(configObj);
        if (
          opencodeSandboxApply?.opencodeSandboxConfigInjected &&
          configObj.sandbox
        ) {
          spawnEnv.NUWAX_AGENT_SANDBOX_CONFIG = JSON.stringify(
            configObj.sandbox,
          );
        }
        const effectivePerm = configObj.permission as Record<string, string>;
        log.info(
          `${this.logTag} 🔌 OpenCode ACP config injected (OPENCODE_CONFIG_CONTENT)`,
          {
            engine: this.engineName,
            mcp_injection: isWarmupProcess
              ? "enabled (legacy dual-path for A/B, warmup process)"
              : "enabled (legacy dual-path for A/B)",
            mcp_servers: configObj.mcp
              ? Object.keys(configObj.mcp as Record<string, unknown>)
              : [],
            permission: effectivePerm,
            sandbox_active: describeOpencodeSandboxActive(opencodeSandboxApply),
          },
        );
        if (opencodeSandboxApply) {
          if (opencodeSandboxApply.opencodeSandboxConfigInjected) {
            log.info(
              `${this.logTag} OPENCODE sandbox config injected (engine=${this.engineName}, v${opencodeSandboxApply.engineVersion})`,
            );
          } else {
            log.info(
              `${this.logTag} OpenCode ACP compat sandbox (engine=${this.engineName}, v${opencodeSandboxApply.engineVersion ?? "?"}): helper serve + sandboxed-bash/fs MCP`,
              {
                builtinBashDenied: opencodeSandboxApply.builtinBashDenied,
                builtinEditDenied: opencodeSandboxApply.builtinEditDenied,
              },
            );
          }
        }
      }

      // Spawn ACP binary and create ClientSideConnection
      configTimer.end("acp.init.config", { engine: this.engineName });

      // GUI MCP (gui-agent) and sandbox are mutually exclusive for now.
      if (this.sandboxCaps.usesOpencodeSpawnConfig && sandboxConfig?.enabled) {
        stripGuiMcpFromOpencodeConfigContent(spawnEnv, this.logTag);
      }

      // Create Terminal Manager for per-command sandboxing via ACP Terminal API.
      // claude-code-acp-ts uses terminal/create for bash execution.
      // On Windows, this routes through nuwax-sandbox-helper.exe run.
      // On macOS/Linux, commands are executed directly.
      this.terminalManager = createTerminalManagerForSandbox(
        sandboxConfig,
        this.logTag,
      );

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
      await this.authenticateCodexWithEnv(connection, config, spawnEnv);

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

    // Reject all pending permissions (session-mode state is cleared at the
    // end of destroy — see permissions.destroy() below)
    this.permissions.cancelAllPending();

    // Reject all active prompts
    for (const [sessionId, reject] of this.activePromptRejects) {
      reject(new Error("AcpEngine destroyed"));
      this.activePromptRejects.delete(sessionId);
    }
    this.permissionGatedToolRawInputs.clear();

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
    this.permissions.destroy();
    approvalInterventionService.destroy();
    this.config = null;
    this._ready = false;
    log.info(`${this.logTag} Destroyed`);
    this.emit("destroyed");
  }

  // === Session Management ===

  async createSession(opts?: NewSessionOpts): Promise<SdkSession> {
    if (!this.acpConnection || !this.config) {
      throw new Error("AcpEngine not initialized");
    }

    // MCP 聚合、GUI MCP 注入/互斥、沙箱 MCP 注入、_meta 构建
    // 见 acpNewSessionParams.ts
    const { sessionCwd, mcpServers, _meta } = buildNewSessionParams(opts, {
      config: this.config,
      storedSandboxConfig: this.storedSandboxConfig,
      engineName: this.engineName,
      logTag: this.logTag,
    });

    const systemPromptTrimmed = opts?.systemPrompt?.trim();
    const requestId = opts?.requestId;

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
      `${this.logTag} ✅ ACP newSession completed (${createMs}ms), acpSessionId=${acpResult.sessionId}`,
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
      cwd: sessionCwd,
      createdAt: Date.now(),
      status: "idle",
      mcpServerCount: mcpServers.length,
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
      engineType: this._engineName as AgentEngineType,
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
        reject(createSessionCancelledError());
        this.activePromptRejects.delete(sessionId);
      }

      this.activePromptSessions.delete(sessionId);

      approvalInterventionService.cancelByAcpSession(sessionId);
      this.permissions.clearSession(sessionId);

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
          if (this.sandboxCaps.usesOpencodePromptBehaviors) {
            log.info(`${this.logTag} acp.prompt.meta`, {
              sessionId,
              requestId: _opts?.messageID,
              mcpInitPolicy: promptParams._meta?.mcpInitPolicy,
              mcpInitTimeoutMs: promptParams._meta?.mcpInitTimeoutMs,
            });
          }

          executePromptWithRetry(
            () => this.acpConnection!.prompt(promptParams),
            {
              maxAttempts: this.sandboxCaps.usesOpencodePromptBehaviors ? 2 : 1,
              retryDelayMs: MCP_RETRY_DELAY_MS,
              logTag: this.logTag,
              sessionId,
              promptStartTime,
              shouldRetry: (err, errMsg) =>
                !isPromptCancellation(err) &&
                this.isMcpReconnectFailure(errMsg),
              getRetryTelemetry: () => getMcpTransportSnapshot(this.acpProcess),
              onRetry: (info) => {
                firstTokenTrace.trace(
                  "acp.prompt.retry.mcp_reconnect",
                  {
                    requestId: _opts?.messageID,
                    sessionId,
                    projectId: session.projectId,
                    engine: this.engineName,
                  },
                  { ...info },
                );
              },
            },
          )
            .then(resolve)
            .catch(reject);
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
      const errMsg = toErrorMessage(error);
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
    this.permissions.respond(permissionId, response);
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
    const model = mp.model || mp.default_model || "";

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
      const { mode: effectiveMode, isFallback } = resolveEffectiveMode(
        request.agent_config?.agent_server?.agent_mode,
      );
      if (isFallback) {
        log.warn(
          `${this.logTag} Unknown agent_mode "${request.agent_config?.agent_server?.agent_mode}", fail-safe to "ask"`,
        );
      }
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
            `${this.logTag} ⚠️ model_provider changed with ${this.activePromptSessions.size} active prompt(s); skipping reinit, keeping current config`,
          );
        } else {
          log.info(
            `${this.logTag} 🔄 model_provider changed, reinitializing ACP connection...`,
          );
          const newConfig: AgentConfig = {
            ...this.config,
            apiKey: request.model_provider.api_key || this.config.apiKey,
            baseUrl: request.model_provider.base_url || this.config.baseUrl,
            model:
              request.model_provider.model ||
              request.model_provider.default_model ||
              this.config.model,
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
      // 会话查找：优先使用 agent_work_dir
      if (!session && request.agent_work_dir) {
        session =
          this.findSessionByProjectId(request.agent_work_dir) ?? undefined;
      }
      if (!session && request.project_id) {
        session = this.findSessionByProjectId(request.project_id) ?? undefined;
      }

      if (!session) {
        isNewSession = true;
        // 工作目录构建：优先使用 agent_work_dir
        const workDirId =
          request.agent_work_dir || request.project_id || `proj-${Date.now()}`;
        const projectDir = resolveComputerProjectWorkspaceDir(
          this.config.workspaceDir,
          request.user_id,
          workDirId,
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
          title: workDirId,
          cwd: projectDir,
          mcpServers: this.config.mcpServers,
          systemPrompt: request.system_prompt,
          requestId: request.request_id,
        });
        session = this.sessions.get(newSession.id)!;
        // 会话绑定：存储 agent_work_dir
        session.projectId = request.agent_work_dir || request.project_id;
        firstTokenTrace.trace(
          "acp.chat.session_created",
          {
            requestId: request.request_id,
            sessionId: session.id,
            projectId: request.project_id,
            agentWorkDir: request.agent_work_dir,
            engine: this.engineName,
          },
          { projectDir },
        );
      } else {
        firstTokenTrace.trace("acp.chat.session_reused", {
          requestId: request.request_id,
          sessionId: session.id,
          projectId: request.project_id,
          agentWorkDir: request.agent_work_dir,
          engine: this.engineName,
        });
      }

      if (session.acpSessionId) {
        this.setEffectiveMode(session.acpSessionId, effectiveMode);
        // 每次 chat 请求刷新该会话的 tool_approval_rules（不传则清除，保持向后兼容）
        this.permissions.setSessionApprovalRules(
          session.acpSessionId,
          request.agent_config?.agent_server?.tool_approval_rules,
        );
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

      // 2. Record user message to MemoryService（见 acpChatMemory.ts）
      // 获取纯净用户输入（仅使用 original_user_prompt，不回退到 prompt）
      const pureUserPrompt = request.original_user_prompt || "";
      // 决定是否启用记忆（默认 false）
      const enableMemory = request.open_long_memory === true;

      // 存储记忆开关到 session，供事件处理器使用
      session.openLongMemory = enableMemory;
      // 存储记忆处理使用的模型名（优先使用 model_provider.default_model）
      session.memoryModel =
        request.model_provider?.default_model || this.config.model || "";

      recordUserMessageToMemory({
        sessionId: session.id,
        requestId: request.request_id,
        pureUserPrompt,
        enableMemory,
        modelProvider: request.model_provider,
        engineName: this.engineName,
        config: this.config,
        logTag: this.logTag,
      });

      // 3. Inject memory context into prompt
      const memoryTimer = perfEmitter.start();
      const enhancedPrompt = await buildMemoryEnhancedPrompt({
        prompt: request.prompt,
        pureUserPrompt,
        enableMemory,
        logTag: this.logTag,
      });
      memoryTimer.end("acp.chat.memoryInject", {
        stage: "memory_injection",
        enabled: enableMemory,
      });

      const contextServerNames = this.getEnabledContextServerNames(
        request.agent_config?.context_servers as
          | Record<string, { enabled?: boolean } | undefined>
          | undefined,
      );
      await this.waitForCompatMcpWarmupIfNeeded({
        sessionId: session.id,
        requestId: request.request_id,
        isNewSession,
        mcpServerCount: session.mcpServerCount ?? 0,
        contextServerNames,
      });

      // 4. Async prompt
      const promptOptions: PromptOptions = {
        messageID: request.request_id,
      };
      if (this.sandboxCaps.usesOpencodePromptBehaviors) {
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
      const rawErrorMsg = toErrorMessage(error);
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

    const { update: normalizedUpdate, delay } =
      normalizePermissionGatedToolUpdate(
        update,
        this.permissionGatedToolRawInputs,
      );
    if (delay) {
      log.debug(
        `${this.logTag} Delay permission-gated tool update until completed result`,
        {
          sessionId: acpSessionId,
          sessionUpdate: normalizedUpdate.sessionUpdate,
          toolCallId: (normalizedUpdate as any).toolCallId,
          status: (normalizedUpdate as any).status,
        },
      );
      return;
    }

    // sessionId and acpSessionId are the same UUID
    this.emit("computer:progress", {
      sessionId: acpSessionId,
      acpSessionId: acpSessionId,
      messageType: "agentSessionUpdate",
      subType: normalizedUpdate.sessionUpdate,
      data: normalizedUpdate,
      timestamp: new Date().toISOString(),
    } satisfies UnifiedSessionMessage);

    // ACP update → 内部事件映射见 acpUpdateMapper.ts
    const mapped = mapAcpUpdateToEvents(
      acpSessionId,
      normalizedUpdate,
      this.logTag,
    );
    if (mapped.sessionTitle) {
      session.title = mapped.sessionTitle;
    }
    for (const { event, payload } of mapped.events) {
      this.emit(event, payload);
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

    // 决策链（question 拒绝 → strict guard → tool_approval_rules → agent_mode）
    // 见 permission/permissionCoordinator.ts
    const decision = this.permissions.evaluate(params, {
      strictEnabled: this.isStrictSandboxActiveForEngine(),
      sandboxMode: this.sandboxMode,
      workspaceDir: this.config?.workspaceDir,
      projectWorkspaceDir: this.storedSandboxConfig?.projectWorkspaceDir,
      sessionWorkspaceDir: this.sessions.get(acpSessionId)?.cwd,
      isolatedHome: this.isolatedHome,
      appDataDir: path.join(os.homedir(), APP_DATA_DIR_NAME),
      tempDirs: [
        os.tmpdir(),
        process.env.TMPDIR,
        process.env.TMP,
        process.env.TEMP,
      ].filter(Boolean) as string[],
    });

    if (decision.kind === "cancel") {
      return { outcome: { outcome: "cancelled" } };
    }
    if (decision.kind === "select") {
      return {
        outcome: { outcome: "selected", optionId: decision.optionId },
      };
    }

    // ask：走 approvalInterventionService 人工审批
    const appSessionId = acpSessionId;

    const { interventionRequest, acpResponsePromise } =
      approvalInterventionService.createPending({
        engine: this.engineName,
        appSessionId,
        acpSessionId,
        acpRequest: params,
      });

    log.info(
      `${this.logTag} 📋 Permission pending (ask mode): id=${interventionRequest.id} tool=${params.toolCall.title}`,
    );

    this.emit("computer:progress", {
      sessionId: appSessionId,
      acpSessionId,
      messageType: "acpRequestPermission",
      subType: "request_permission",
      data: toComputerPermissionProgressData({
        acpRequest: params,
        interventionId: interventionRequest.id,
        revision: interventionRequest.revision,
      }),
      timestamp: new Date().toISOString(),
    });

    return acpResponsePromise;
  }

  resolvePermissionIntervention(
    payload: NotifyResolvedRequest | ComputerNotifyResolvedRequest,
  ): NotifyResolvedResponse {
    if (isComputerPermissionResolveRequest(payload)) {
      return approvalInterventionService.resolveFromComputerPermissionCallback(
        payload,
      );
    }
    return approvalInterventionService.resolveFromCallback(payload);
  }
}
