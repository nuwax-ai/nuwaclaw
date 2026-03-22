/**
 * AcpEngine — ACP protocol handler for claude-code & nuwaxcode.
 *
 * Both engines communicate via the Agent Client Protocol (NDJSON over stdin/stdout).
 * The only difference is the binary spawned:
 * - claude-code → claude-code-acp-ts
 * - nuwaxcode   → nuwaxcode acp
 */

import { EventEmitter } from "events";
import * as path from "path";
import * as fs from "fs";
import log from "electron-log";
import type { ChildProcess } from "child_process";
import {
  createAcpConnection,
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
import type { DetailedSession } from "@shared/types/sessions";
import { ACP_ABORT_TIMEOUT } from "@shared/constants";

/** Safe JSON.stringify that handles circular references */
function safeStringify(obj: unknown): string {
  try {
    return JSON.stringify(obj);
  } catch {
    return String(obj);
  }
}

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

  /** Get the PID of the underlying ACP process (for process registry) */
  getProcessPid(): number | undefined {
    return this.acpProcess?.pid;
  }

  // === Lifecycle ===

  async init(config: AgentConfig): Promise<boolean> {
    this.config = config;
    const envModel = config.env?.OPENCODE_MODEL || config.env?.ANTHROPIC_MODEL;
    log.info(`${this.logTag} 🚀 初始化配置`, {
      engine: this.engineName,
      config_model: config.model || "未设置",
      env_model: envModel || "未设置",
      baseUrl: config.baseUrl || "(default)",
      apiKey_set: !!config.apiKey,
      workspaceDir: config.workspaceDir,
      env_keys: config.env ? Object.keys(config.env) : [],
      mcpServers: config.mcpServers ? Object.keys(config.mcpServers) : [],
    });
    try {
      // Build ACP client handler (callbacks from agent → client)
      const clientHandler = this.buildClientHandler();

      // Resolve binary path and args for the engine type
      const { binPath, binArgs, isNative } = resolveAcpBinary(this.engineName);

      // For nuwaxcode: inject config via OPENCODE_CONFIG_CONTENT env var
      const spawnEnv = { ...(config.env || {}) };
      if (this.engineName === "nuwaxcode") {
        const configObj: Record<string, unknown> = {};

        // 1. MCP servers injection
        if (config.mcpServers && Object.keys(config.mcpServers).length > 0) {
          const mcpConfig: Record<string, unknown> = {};
          for (const [name, srv] of Object.entries(config.mcpServers)) {
            if ("url" in srv && srv.url) {
              // URL 类型（来自 PersistentMcpBridge）
              const urlSrv = srv as { url: string; type?: string };
              mcpConfig[name] = {
                type: urlSrv.type === "sse" ? "sse" : "streamable-http",
                url: urlSrv.url,
                enabled: true,
              };
            } else if ("command" in srv) {
              // stdio 类型（降级）
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

        // 2. Permission bypass (question: deny to avoid interactive prompts)
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
            mcp_servers: configObj.mcp
              ? Object.keys(configObj.mcp as Record<string, unknown>)
              : [],
            permission: "all allow",
            content: configContent,
          },
        );
      }

      // Spawn ACP binary and create ClientSideConnection
      const {
        connection,
        process: proc,
        isolatedHome,
        cleanup,
      } = await createAcpConnection(
        {
          binPath,
          binArgs,
          isNative,
          workspaceDir: config.workspaceDir,
          apiKey: config.apiKey,
          baseUrl: config.baseUrl,
          model: config.model,
          env: spawnEnv,
          engineType: this.engineName,
          purpose: config.purpose ?? "engine",
        },
        clientHandler,
      );

      this.acpConnection = connection;
      this.acpProcess = proc;
      this.isolatedHome = isolatedHome;
      this.processCleanup = cleanup; // 🔧 FIX: Store cleanup function

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
      const acp = await loadAcpSdk();
      const initResult = await connection.initialize({
        protocolVersion: acp.PROTOCOL_VERSION,
        clientCapabilities: {},
      });

      log.info(`${this.logTag} ACP initialized`, {
        protocolVersion: initResult.protocolVersion,
      });

      this._ready = true;
      this.emit("ready");
      return true;
    } catch (error) {
      log.error(`${this.logTag} Init failed:`, error);
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
        log.info(`${this.logTag} 🧹 已清理隔离目录: ${this.isolatedHome}`);
      } catch (e) {
        log.warn(`${this.logTag} 隔离目录清理失败:`, e);
      }
      this.isolatedHome = null;
    }

    this.acpConnection = null;
    this.sessions.clear();
    this.activePromptSessions.clear();
    this.activePromptRejects.clear();
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

    const sessionCwd = opts?.cwd || this.config.workspaceDir;

    // Build _meta with systemPrompt if provided (skip if empty or whitespace only)
    const systemPromptTrimmed = opts?.systemPrompt?.trim();
    const _meta = systemPromptTrimmed
      ? {
          systemPrompt: {
            append: systemPromptTrimmed,
          },
        }
      : undefined;

    const newSessionParams = {
      cwd: sessionCwd,
      mcpServers,
      _meta,
    };
    log.info(
      `${this.logTag} newSession: cwd=${sessionCwd}, mcpServers=${mcpServers.length}, hasSystemPrompt=${!!opts?.systemPrompt}`,
    );
    log.debug(`${this.logTag} newSession debug`, {
      systemPrompt: systemPromptTrimmed,
      systemPromptLength: systemPromptTrimmed?.length ?? 0,
      mcpServersJson: JSON.stringify(mcpServers, null, 2),
    });
    const t0 = Date.now();
    let acpResult: { sessionId: string };
    try {
      acpResult = await this.acpConnection.newSession(newSessionParams);
    } catch (err) {
      log.error(
        `${this.logTag} ❌ ACP newSession 失败 (${Date.now() - t0}ms):`,
        err,
      );
      throw err;
    }
    log.info(
      `${this.logTag} ✅ ACP newSession 完成 (${Date.now() - t0}ms), acpSessionId=${acpResult.sessionId}`,
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

    this.emit("computer:promptStart", {
      sessionId,
      acpSessionId: session.acpSessionId,
      requestId: _opts?.messageID,
    });

    let resultText = "";
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
      log.info(`${this.logTag} 📤 ACP prompt 发送中...`);

      const result = await new Promise<{ stopReason: string }>(
        (resolve, reject) => {
          this.activePromptRejects.set(sessionId, reject);

          this.acpConnection!.prompt({
            sessionId: session.acpSessionId!,
            prompt: promptContent,
          }).then(
            (res) => {
              log.info(
                `${this.logTag} 📥 ACP prompt resolved (${Date.now() - promptStartTime}ms):`,
                safeStringify(res),
              );
              resolve(res);
            },
            (err) => {
              log.error(
                `${this.logTag} 📥 ACP prompt rejected (${Date.now() - promptStartTime}ms):`,
                err,
              );
              reject(err);
            },
          );
        },
      );

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

      const errMsg =
        error instanceof Error
          ? error.message
          : typeof error === "object" && error !== null
            ? safeStringify(error)
            : String(error);
      this.emit("computer:promptEnd", {
        sessionId,
        acpSessionId: session.acpSessionId,
        reason: "error",
        description: errMsg,
        openLongMemory: session.openLongMemory,
        memoryModel: session.memoryModel,
      });

      this.emit("session.error", {
        sessionId,
        error: errMsg,
      });
    } finally {
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
      log.info(`${this.logTag} 📨 chat() 收到请求`, {
        user_id: request.user_id,
        project_id: request.project_id,
        session_id: request.session_id,
        request_id: request.request_id,
        agent_config: redactStringForLog(
          safeStringify(redactForLog(request.agent_config)),
        ),
        model_provider: redactForLog(request.model_provider),
        config_model: this.config.model || "未设置",
        env_model: envModel || "未设置",
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

      if (request.session_id) {
        session = this.sessions.get(request.session_id);
      }
      if (!session && request.project_id) {
        session = this.findSessionByProjectId(request.project_id) ?? undefined;
      }

      if (!session) {
        const projectId = request.project_id || `proj-${Date.now()}`;
        const projectDir = path.join(
          this.config.workspaceDir,
          "computer-project-workspace",
          request.user_id,
          projectId,
        );
        log.info(`${this.logTag} 📁 项目工作目录: ${projectDir}`);

        // context_servers 已由 ensureEngineForRequest() 同步到 proxy 聚合代理
        // (nuwax-mcp-stdio-proxy)，不再单独传给 createSession()，
        // 避免 claude-code 重复 spawn 导致 Windows 弹窗和资源浪费
        if (request.agent_config?.context_servers) {
          const servers = request.agent_config.context_servers;
          const serverNames = Object.keys(servers).filter(
            (n) => servers[n]?.enabled !== false,
          );
          log.info(
            `${this.logTag} 🔌 context_servers (已由 proxy 聚合): ${serverNames.join(", ") || "(无)"}`,
          );
        }

        const newSession = await this.createSession({
          title: projectId,
          cwd: projectDir,
          mcpServers: this.config.mcpServers,
          systemPrompt: request.system_prompt,
        });
        session = this.sessions.get(newSession.id)!;
        session.projectId = request.project_id;
      }

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

      // 4. Async prompt
      this.promptAsync(session.id, [{ type: "text", text: enhancedPrompt }]);

      // 5. Return HttpResult<ChatResponse>
      const chatResponse: ComputerChatResponse = {
        project_id: request.project_id || session.id,
        session_id: session.id,
        error: null,
        request_id: request.request_id,
      };

      log.info(`${this.logTag} ✅ chat() 响应: session_id=${session.id}`);

      return {
        code: "0000",
        message: "成功",
        data: chatResponse,
        tid: null,
        success: true,
      };
    } catch (error) {
      const errorMsg =
        error instanceof Error
          ? error.message
          : typeof error === "object" && error !== null
            ? safeStringify(error)
            : String(error);
      log.error(`${this.logTag} ❌ chat() 失败: ${errorMsg}`);
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

    const selected =
      params.options.find((o) => o.kind === "allow_always") ||
      params.options.find((o) => o.kind === "allow_once") ||
      params.options[0];

    if (selected) {
      log.info(
        `${this.logTag} 🔓 权限自动放行: tool=${params.toolCall.title}, kind=${selected.kind}, optionId=${selected.optionId}`,
      );
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
