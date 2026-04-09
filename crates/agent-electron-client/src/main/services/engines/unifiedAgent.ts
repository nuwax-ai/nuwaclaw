/**
 * Unified Agent Service
 *
 * Architecture:
 * - AcpEngine: ACP protocol (claude-code via claude-code-acp-ts, nuwaxcode via nuwaxcode acp)
 * - UnifiedAgentService: Event bus + engine proxy
 */

import { EventEmitter } from "events";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import log from "electron-log";
import { memoryService } from "../memory";
import type { ModelConfig } from "../memory/types";
import { perfEmitter } from "./perf/perfEmitter";
import { firstTokenTrace } from "./perf/firstTokenTrace";

// Re-export engine classes
export { AcpEngine } from "./acp/acpEngine";
export { mapAgentCommand, resolveAgentEnv } from "./agentHelpers";

import { AcpEngine } from "./acp/acpEngine";
import { loadAcpSdk } from "./acp/acpClient";
import { mapAgentCommand, resolveAgentEnv } from "./agentHelpers";
import { EngineWarmup } from "./engineWarmup";
import dependencies from "../system/dependencies";
import { getSandboxPolicy } from "../sandbox/policy";
import { processRegistry } from "../system/processRegistry";
import type { DetailedSession } from "@shared/types/sessions";
import { ENGINE_DESTROY_TIMEOUT } from "@shared/constants";

// Re-export computer types
export type {
  HttpResult,
  ComputerChatRequest,
  ComputerChatResponse,
  UnifiedSessionMessage,
  ModelProviderConfig,
  ComputerAgentStatusResponse,
  ComputerAgentStopResponse,
  ComputerAgentCancelResponse,
} from "@shared/types/computerTypes";
import type {
  ComputerChatRequest,
  ModelProviderConfig,
} from "@shared/types/computerTypes";
import { APP_DATA_DIR_NAME } from "../constants";
import type { McpServerEntry } from "../packages/mcp";
import {
  filterBridgeEntries,
  rawMcpServersEqual,
} from "../packages/mcpHelpers";

/** 环境变量记录类型 */
type EnvRecord = Record<string, string | undefined>;

// ==================== Types ====================

import type { AgentConfig, AgentEngineType } from "./types";
export type { AgentConfig, AgentEngineType };

export type AcpSessionStatus = "idle" | "pending" | "active" | "terminating";

// ==================== Message Types (replacing SDK types) ====================

export type MessageRole = "user" | "system" | "assistant";

export type PartType =
  | "text"
  | "reasoning"
  | "file"
  | "tool"
  | "step_start"
  | "step_finish"
  | "snapshot"
  | "patch";

export interface BasePart {
  type: PartType;
}

export interface TextPart extends BasePart {
  type: "text";
  text: string;
}

export interface ReasoningPart extends BasePart {
  type: "reasoning";
  thinking: string;
}

export interface FilePart extends BasePart {
  type: "file";
  uri?: string;
  mimeType?: string;
}

export interface ToolPart extends BasePart {
  type: "tool";
  toolCallId: string;
  name: string;
  kind?: string;
  status?: string;
  input?: string;
  output?: string;
  content?: string;
}

export interface StepStartPart extends BasePart {
  type: "step_start";
  stepId: string;
  title?: string;
}

export interface StepFinishPart extends BasePart {
  type: "step_finish";
  stepId: string;
  title?: string;
  result?: unknown;
}

export interface SnapshotPart extends BasePart {
  type: "snapshot";
  snapshotId: string;
}

export interface PatchPart extends BasePart {
  type: "patch";
  patchId: string;
  filePath?: string;
}

export type Part =
  | TextPart
  | ReasoningPart
  | FilePart
  | ToolPart
  | StepStartPart
  | StepFinishPart
  | SnapshotPart
  | PatchPart;

export interface BaseMessage {
  role: MessageRole;
  content: Part[];
}

export interface UserMessage extends BaseMessage {
  role: "user";
}

export interface AssistantMessage extends BaseMessage {
  role: "assistant";
}

export type Message = UserMessage | AssistantMessage;

export interface TextPartInput {
  type: "text";
  text: string;
}

export interface FilePartInput {
  type: "file";
  uri?: string;
  mimeType?: string;
}

export interface FileDiff {
  filePath: string;
  oldContent?: string;
  newContent?: string;
  hunks?: unknown[];
}

export interface MessageWithParts {
  info: Message;
  parts: Part[];
}

export interface PromptOptions {
  model?: { providerID: string; modelID: string };
  agent?: string;
  noReply?: boolean;
  system?: string;
  tools?: Record<string, boolean>;
  messageID?: string;
  mcpInitPolicy?: "blocking" | "non_blocking";
  mcpInitTimeoutMs?: number;
}

export interface CommandOptions {
  agent?: string;
  model?: string;
  messageID?: string;
}

export interface SdkSession {
  id: string;
  parentID?: string;
  title?: string;
  time?: { created: number; updated?: number };
  [key: string]: unknown;
}

export interface SessionStatus {
  [sessionId: string]: {
    status: string;
    [key: string]: unknown;
  };
}

export interface ToolInfo {
  name: string;
  description?: string;
  parameters?: Record<string, unknown>;
}

export interface ProviderInfo {
  id: string;
  name?: string;
  models?: Array<{ id: string; name?: string }>;
  [key: string]: unknown;
}

// ==================== UnifiedAgentService ====================

/** Maximum number of concurrent per-project engines to prevent resource leaks */
const MAX_ENGINES = 100;

export class UnifiedAgentService extends EventEmitter {
  /** Per-project engine registry: projectId → AcpEngine */
  private engines = new Map<string, AcpEngine>();
  /** Per-project effective config snapshot (for config-change detection) */
  private engineConfigs = new Map<string, AgentConfig>();
  /**
   * Per-project raw MCP servers snapshot (原始 request 格式，非 proxy 包装格式).
   * 用于 detectConfigChange 的 MCP 变更检测，避免与 proxy 包装格式的 currentConfig.mcpServers 做跨格式比较。
   */
  private engineRawMcpServers = new Map<
    string,
    Record<string, McpServerEntry>
  >();
  private engineType: AgentEngineType | null = null;
  private baseConfig: AgentConfig | null = null;
  private warmup: EngineWarmup = new EngineWarmup(
    this.engines,
    this.engineConfigs,
    this.engineRawMcpServers,
  );

  /** Buffer assistant text chunks per session for memory tracking */
  private assistantTextBuffers = new Map<string, string>();

  /**
   * Initialize the service with a base config.
   * Does NOT spawn a process — processes are created lazily per project_id
   * on the first chat request via getOrCreateEngine().
   */
  async init(config: AgentConfig): Promise<boolean> {
    if (this.engines.size > 0) {
      await this.destroy();
    }

    this.warmup.reactivate();
    this.baseConfig = config;
    this.engineType = config.engine;

    // Initialize MemoryService with app data directory (~/.nuwaclaw/)
    // Memory files should be stored in app data dir, not workspace dir
    try {
      const appDataDir = dependencies.getAppDataDir();
      await memoryService.init(appDataDir, {
        enabled: true,
        extraction: {
          enabled: true,
          implicitEnabled: true,
          explicitEnabled: true,
          guardLevel: "standard",
          trigger: {
            onEveryTurn: false,
            onSegmentFull: true,
            onSessionEnd: true,
            onIdleTimeout: true,
            idleTimeoutMs: 60000,
          },
          llm: {
            maxTokensPerExtract: 800,
            temperature: 0.3,
            maxRetries: 2,
          },
        },
      });

      // Provide model config to scheduler for cron-triggered LLM consolidation
      const modelConfig: ModelConfig = {
        provider: config.engine === "claude-code" ? "anthropic" : "openai",
        model: config.model || "",
        apiKey: config.apiKey || "",
        baseUrl: config.baseUrl,
      };
      memoryService.setSchedulerModelConfig(modelConfig);

      log.info(
        "[UnifiedAgent] MemoryService initialized with app data dir:",
        appDataDir,
      );
    } catch (error) {
      log.error("[UnifiedAgent] MemoryService initialization failed:", error);
    }

    log.info(
      "[UnifiedAgent] Service initialized (lazy mode, no process spawned)",
    );
    // 预加载 ACP SDK ESM 模块（claude-code-acp-ts 专项，避免首次 init 时串在关键路径）
    loadAcpSdk().catch(() => {});
    // 后台预做 memory 同步，避免首包 getOrCreateEngine 时 ensureMemoryReady 阻塞 ~500ms
    if (memoryService.isInitialized()) {
      memoryService.ensureMemoryReadyForSession().catch(() => {});
    }
    // 后台预热 MCP proxy bridge
    this.warmupMcpBridge();
    // 后台预热 nuwaxcode 引擎（非阻塞，省掉首次会话 ~2s 冷启动）
    // 始终预热 nuwaxcode，与 init engineType 无关
    this.warmup.start(this.baseConfig, (e) => this.forwardEvents(e));
    // Start process registry sweep to detect orphan ACP processes
    processRegistry.bindActivePidsFn(() => this.getActivePids());
    processRegistry.startPeriodicSweep(300_000);
    this.emit("ready");
    return true;
  }

  /**
   * Destroy all engines and reset the service.
   */
  async destroy(): Promise<void> {
    // Stop warmup timers first so no respawn callback runs during/after destroy.
    this.warmup.dispose();

    // Stop process registry sweep
    processRegistry.stopPeriodicSweep();

    // Trigger session-end memory extraction for each project
    if (memoryService.isInitialized() && this.baseConfig) {
      const modelConfig: ModelConfig = {
        provider: this.engineType === "claude-code" ? "anthropic" : "openai",
        model: this.baseConfig.model || "",
        apiKey: this.baseConfig.apiKey || "",
        baseUrl: this.baseConfig.baseUrl,
      };

      for (const projectId of this.engines.keys()) {
        try {
          await memoryService.onSessionEnd(projectId, modelConfig);
          log.info(
            `[UnifiedAgent] Session-end memory extraction completed for: ${projectId}`,
          );
        } catch (error) {
          log.error(
            `[UnifiedAgent] Session-end memory extraction failed for ${projectId}:`,
            error,
          );
        }
      }
      await memoryService.destroy();
    }

    const destroyPromises: Promise<void>[] = [];
    for (const [projectId, engine] of this.engines) {
      log.info(`[UnifiedAgent] Destroying engine for project: ${projectId}`);
      engine.removeAllListeners();
      // Wrap each engine destroy with a timeout to prevent hanging
      const destroyWithTimeout = Promise.race([
        engine.destroy(),
        new Promise<void>((resolve) => {
          setTimeout(() => {
            log.warn(
              `[UnifiedAgent] Engine destroy timeout for project: ${projectId}, force proceeding`,
            );
            resolve();
          }, ENGINE_DESTROY_TIMEOUT);
        }),
      ]);
      destroyPromises.push(destroyWithTimeout);
    }
    await Promise.all(destroyPromises);
    // Final sweep to kill any orphaned processes missed by normal destroy
    await processRegistry.killOrphans().catch(() => {});
    this.engines.clear();
    this.engineConfigs.clear();
    this.engineRawMcpServers.clear();
    this.assistantTextBuffers.clear();
    this.engineType = null;
    this.baseConfig = null;
    log.info("[UnifiedAgent] Service destroyed");
    this.emit("destroyed");
  }

  /**
   * Stop (kill) the engine for a specific project but preserve baseConfig.
   * Used by /computer/agent/stop — matches rcoder behavior:
   * cancel sessions + kill process; next /computer/chat will auto-recreate.
   */
  async stopEngine(projectId?: string): Promise<void> {
    if (projectId) {
      // Resolve the actual engine registry key (projectId may be a session_id)
      const registryKey = this.resolveEngineKey(projectId);
      if (registryKey) {
        const engine = this.engines.get(registryKey)!;
        engine.removeAllListeners();
        await engine.destroy();
        this.engines.delete(registryKey);
        this.engineConfigs.delete(registryKey);
        this.engineRawMcpServers.delete(registryKey);
        log.info(
          `[UnifiedAgent] Engine stopped for project: ${registryKey} (query=${projectId}, baseConfig preserved)`,
        );
      }
    } else {
      // Legacy: stop all engines in parallel
      const destroyPromises: Promise<void>[] = [];
      for (const [pid, engine] of this.engines) {
        engine.removeAllListeners();
        destroyPromises.push(engine.destroy());
        log.info(`[UnifiedAgent] Engine stopped for project: ${pid}`);
      }
      await Promise.all(destroyPromises);
      this.engines.clear();
      this.engineConfigs.clear();
      this.engineRawMcpServers.clear();
      log.info("[UnifiedAgent] All engines stopped (baseConfig preserved)");
    }
  }

  getEngineType(): AgentEngineType | null {
    return this.engineType;
  }

  getAgentConfig(): AgentConfig | null {
    return this.baseConfig;
  }

  /**
   * Get PIDs of all active ACP processes (engines + warm pool).
   * Used by ProcessRegistry sweep to distinguish active processes from orphans.
   */
  getActivePids(): Set<number> {
    const pids = new Set<number>();
    for (const engine of this.engines.values()) {
      const pid = engine.getProcessPid();
      if (pid) pids.add(pid);
    }
    return pids;
  }

  /** 后台预热 MCP proxy bridge */
  private warmupMcpBridge(): void {
    (async () => {
      try {
        const { syncMcpConfigToProxyAndReload } =
          await import("../packages/mcp");
        await syncMcpConfigToProxyAndReload({});
        log.debug("[UnifiedAgent] MCP proxy bridge warmup complete");
      } catch (err) {
        log.warn("[UnifiedAgent] MCP proxy bridge warmup failed:", err);
      }
    })().catch(() => {});
  }

  /**
   * 维护一个常驻 nuwaxcode warmup 池（与当前请求引擎解耦）。
   * - 不影响 claude-code 的原有请求路径
   * - 仅用于确保后续 nuwaxcode 新会话可命中预热
   */
  private ensureNuwaxWarmup(options?: {
    mcpServers?: AgentConfig["mcpServers"];
    reason?: string;
    allowWhenActiveEngines?: boolean;
    seedConfig?: Pick<
      AgentConfig,
      "apiKey" | "baseUrl" | "model" | "apiProtocol" | "env"
    >;
  }): void {
    if (!this.baseConfig) return;
    const warmupBaseConfig: AgentConfig = {
      ...this.baseConfig,
      ...(options?.seedConfig
        ? {
            apiKey: options.seedConfig.apiKey ?? this.baseConfig.apiKey,
            baseUrl: options.seedConfig.baseUrl ?? this.baseConfig.baseUrl,
            model: options.seedConfig.model ?? this.baseConfig.model,
            apiProtocol:
              options.seedConfig.apiProtocol ?? this.baseConfig.apiProtocol,
            env: {
              ...(this.baseConfig.env || {}),
              ...(options.seedConfig.env || {}),
            },
          }
        : {}),
    };
    this.warmup.start(warmupBaseConfig, (e) => this.forwardEvents(e), {
      allowWhenActiveEngines: options?.allowWhenActiveEngines ?? true,
      mcpServers: options?.mcpServers,
      reason: options?.reason,
    });
  }

  /**
   * Get or create an AcpEngine for a given project_id.
   * - Returns existing ready engine
   * - Dead engine → cleanup + rebuild
   * - Missing → create new engine with baseConfig + configOverride
   */
  async getOrCreateEngine(
    projectId: string,
    effectiveConfig: AgentConfig,
    memoryReadyPromise?: Promise<void> | null,
  ): Promise<AcpEngine> {
    firstTokenTrace.trace(
      "engine.get_or_create.start",
      { projectId, engine: effectiveConfig.engine },
      { hasMemoryReadyPromise: !!memoryReadyPromise },
    );
    const t0 = Date.now();
    let t1 = t0,
      t2 = t0,
      t3 = t0;
    const requestEngineType =
      effectiveConfig.engine || this.engineType || "claude-code";
    const isNuwaxRequest = requestEngineType === "nuwaxcode";

    // 不管当前请求引擎类型，尽量维持一个 nuwaxcode warmup 在池中。
    if (!this.warmup.getWarmupStatus().hasWarmup) {
      this.ensureNuwaxWarmup({
        reason: "get_or_create_guard",
        allowWhenActiveEngines: true,
      });
    }

    const existing = this.engines.get(projectId);
    if (existing) {
      if (existing.isReady) {
        perfEmitter.duration("engine.getOrCreate (reuse)", Date.now() - t0);
        firstTokenTrace.trace("engine.get_or_create.reuse", {
          projectId,
          engine: existing.engineName,
        });
        return existing;
      }
      // Dead engine — cleanup and rebuild
      log.info(
        `[UnifiedAgent] Engine for project ${projectId} is dead, rebuilding`,
      );
      existing.removeAllListeners();
      await existing.destroy().catch(() => {});
      this.engines.delete(projectId);
      this.engineConfigs.delete(projectId);
      this.engineRawMcpServers.delete(projectId);
    }

    // 仅 nuwaxcode 请求走 warmup 复用，claude-code 保持原路径
    if (isNuwaxRequest) {
      // Inject current sandbox mode so tryReuse() can reject if modes don't match.
      // The sandbox mode is baked into the process wrapper at spawn time and cannot
      // be changed via updateConfig(). Mismatched modes must cold-start.
      const currentSandboxMode = getSandboxPolicy().mode ?? "compat";
      const configWithSandbox = Object.assign({}, effectiveConfig, {
        __sandboxMode: currentSandboxMode,
      });
      const reused = await this.warmup.tryReuse(
        projectId,
        configWithSandbox,
        t0,
      );
      if (reused) {
        // 同步引擎内部 config 为 effectiveConfig，
        // 防止 chat() 中 shouldReinitForModelProvider 因 config 不一致而 kill + reinit
        reused.updateConfig(effectiveConfig);
        // warmup 被消费后立即补仓，保证后续新会话仍有预热可命中
        this.ensureNuwaxWarmup({
          mcpServers: effectiveConfig.mcpServers,
          seedConfig: {
            apiKey: effectiveConfig.apiKey,
            baseUrl: effectiveConfig.baseUrl,
            model: effectiveConfig.model,
            apiProtocol: effectiveConfig.apiProtocol,
            env: effectiveConfig.env,
          },
          reason: "reuse_refill",
          allowWhenActiveEngines: true,
        });
        perfEmitter.duration(
          "engine.getOrCreate (warmup reuse)",
          Date.now() - t0,
        );
        firstTokenTrace.trace("engine.get_or_create.warmup_reuse", {
          projectId,
          engine: reused.engineName,
        });
        return reused;
      }
    }

    if (!this.baseConfig) {
      throw new Error("UnifiedAgentService not initialized (no baseConfig)");
    }

    // Ensure memory is ready before starting session
    if (memoryReadyPromise) {
      await memoryReadyPromise;
    } else if (memoryService.isInitialized()) {
      await memoryService.ensureMemoryReadyForSession().catch(() => {});
    }
    t1 = Date.now();

    // Evict oldest idle engine if at capacity
    if (this.engines.size >= MAX_ENGINES) {
      await this.evictIdleEngine();
    }
    t2 = Date.now();
    perfEmitter.duration("engine.evictCheck", t2 - t1);

    const engineType =
      effectiveConfig.engine || this.engineType || "claude-code";
    const engine = new AcpEngine(engineType);
    this.forwardEvents(engine);

    log.info(
      `[UnifiedAgent] Creating engine for project: ${projectId}, engine: ${engineType}`,
    );
    const ok = await engine.init(effectiveConfig);
    t3 = Date.now();

    if (!ok) {
      engine.removeAllListeners();
      await engine.destroy().catch(() => {});
      throw new Error(`Failed to create engine for project ${projectId}`);
    }

    this.engines.set(projectId, engine);
    this.engineConfigs.set(projectId, effectiveConfig);
    if (isNuwaxRequest) {
      // 冷启动后也立即补仓，保证连续新 project 有机会持续命中 warmup
      this.ensureNuwaxWarmup({
        mcpServers: effectiveConfig.mcpServers,
        seedConfig: {
          apiKey: effectiveConfig.apiKey,
          baseUrl: effectiveConfig.baseUrl,
          model: effectiveConfig.model,
          apiProtocol: effectiveConfig.apiProtocol,
          env: effectiveConfig.env,
        },
        reason: "create_refill",
        allowWhenActiveEngines: true,
      });
    }
    perfEmitter.duration("engine.getOrCreate", t3 - t0, { project: projectId });
    firstTokenTrace.trace(
      "engine.get_or_create.created",
      { projectId, engine: engine.engineName },
      { latencyMs: t3 - t0 },
    );
    return engine;
  }

  /**
   * Evict the oldest idle engine to make room for a new one.
   * Idle = no active prompts. If all engines are busy, evict the oldest anyway.
   */
  private async evictIdleEngine(): Promise<void> {
    // Prefer evicting idle engines (no active prompts)
    for (const [pid, engine] of this.engines) {
      if (engine.getActivePromptCount() === 0) {
        log.info(
          `[UnifiedAgent] ♻️ Evicting idle engine for project: ${pid} (at capacity ${MAX_ENGINES})`,
        );
        engine.removeAllListeners();
        await engine.destroy().catch(() => {});
        this.engines.delete(pid);
        this.engineConfigs.delete(pid);
        this.engineRawMcpServers.delete(pid);
        // 引擎被驱逐后，重新预热 warmup
        this.warmup.respawn(this.baseConfig, (e) => this.forwardEvents(e));
        return;
      }
    }
    // All engines busy — evict the first (oldest inserted) one
    const [oldestPid, oldestEngine] = this.engines.entries().next().value!;
    log.warn(
      `[UnifiedAgent] ♻️ All engines busy, force-evicting oldest: ${oldestPid}`,
    );
    oldestEngine.removeAllListeners();
    await oldestEngine.destroy().catch(() => {});
    this.engines.delete(oldestPid);
    this.engineConfigs.delete(oldestPid);
    this.engineRawMcpServers.delete(oldestPid);
    // 引擎被驱逐后，重新预热 warmup
    this.warmup.respawn(this.baseConfig, (e) => this.forwardEvents(e));
  }

  /**
   * Ensure the correct engine is running for the given chat request.
   * Returns the AcpEngine to use for this request.
   */
  async ensureEngineForRequest(
    request: ComputerChatRequest,
  ): Promise<AcpEngine> {
    firstTokenTrace.trace("engine.ensure.start", {
      requestId: request.request_id,
      sessionId: request.session_id,
      projectId: request.project_id,
      engine: request.agent_config?.agent_server?.command
        ? (mapAgentCommand(request.agent_config.agent_server.command) ??
          undefined)
        : (this.engineType ?? undefined),
    });
    const t0 = Date.now();
    let t1 = t0,
      t2 = t0,
      t3 = t0,
      t4 = t0,
      t5 = t0;

    // 只要 session_id 相同就复用同一引擎；无 session_id 时用 project_id。
    // 查找时用 getEngineForProject(engineKey)，可命中「以 project_id 存储但已含该 session」的引擎（首次请求无 session_id，后续带 session_id）。
    const engineKey = request.session_id || request.project_id || "default";
    const registryKey = this.resolveEngineKey(engineKey) || engineKey; // 引擎在 Map 中实际使用的 key

    // 性能优化：先解析 context_servers（仅解析，不同步），用于后续的快速路径判断
    const requestMcpServersEarly: Record<string, McpServerEntry> = {};
    if (request.agent_config?.context_servers) {
      let mcpModule: {
        resolveUvCommand: (
          cmd: string,
          args: string[],
          dir?: string,
        ) => { command: string; args: string[] };
        extractRealMcpServers: (
          cmd: string,
          args: string[],
          env?: Record<string, string>,
          dir?: string,
        ) => Record<string, import("../packages/mcp").McpServerEntry> | null;
      } | null = null;
      try {
        mcpModule = await import("../packages/mcp");
      } catch {
        // mcp module not available, proceed without resolution
      }
      for (const [name, srv] of Object.entries(
        request.agent_config.context_servers,
      )) {
        if (srv.enabled === false || !srv.command) continue;
        const command = srv.command;
        const args = srv.args || [];
        if (mcpModule) {
          if (
            command === "mcp-proxy" ||
            path.basename(command) === "mcp-proxy"
          ) {
            const extracted = mcpModule.extractRealMcpServers(
              command,
              args,
              srv.env,
            );
            if (extracted) {
              for (const [innerName, innerSrv] of Object.entries(extracted)) {
                requestMcpServersEarly[innerName] = innerSrv;
              }
            }
          } else {
            const resolved = mcpModule.resolveUvCommand(command, args);
            requestMcpServersEarly[name] = {
              command: resolved.command,
              args: resolved.args,
              env: srv.env,
            };
          }
        } else {
          requestMcpServersEarly[name] = { command, args, env: srv.env };
        }
      }
      t1 = Date.now();
    } else {
      t1 = Date.now();
    }

    const agentServer = request.agent_config?.agent_server;
    const mp = request.model_provider;

    // 性能优化：快速路径检测
    const existingEngine = this.getEngineForProject(engineKey);
    const currentEngineType =
      this.engineConfigs.get(registryKey)?.engine || this.engineType;
    const storedRawMcp = this.engineRawMcpServers.get(registryKey);
    const requestMcpFiltered = filterBridgeEntries(requestMcpServersEarly);
    const mcpChanged = !rawMcpServersEqual(requestMcpFiltered, storedRawMcp);
    const requiredEngine = agentServer?.command
      ? mapAgentCommand(agentServer.command)
      : this.engineType;
    const requestMcpServersRuntime = requestMcpServersEarly;

    // 快速路径：已有就绪引擎 + 无配置变更
    if (
      existingEngine?.isReady &&
      !agentServer?.command &&
      !mp &&
      (Object.keys(requestMcpServersEarly).length === 0 || !mcpChanged)
    ) {
      perfEmitter.duration("engine.fastPath", Date.now() - t0, { engineKey });
      firstTokenTrace.trace(
        "engine.ensure.fast_path",
        {
          requestId: request.request_id,
          sessionId: request.session_id,
          projectId: request.project_id,
          engine: existingEngine.engineName,
        },
        { engineKey },
      );
      return existingEngine;
    }

    perfEmitter.point("engine.fullPath", { engineKey });

    // 性能优化：只有在 MCP 配置变更时才调用 syncMcpConfigToProxyAndReload
    // 并行执行 syncMcp 和 ensureMemoryReady
    const needCreateEngine = !existingEngine || !existingEngine.isReady;
    let memoryReadyPromise: Promise<void> | null = null;

    if (mcpChanged) {
      try {
        const { syncMcpConfigToProxyAndReload } =
          await import("../packages/mcp");
        const syncPromise = syncMcpConfigToProxyAndReload(
          requestMcpServersRuntime,
        );

        // 并行执行 memory ready
        if (needCreateEngine && memoryService.isInitialized()) {
          memoryReadyPromise = memoryService
            .ensureMemoryReadyForSession()
            .then(() => {})
            .catch(() => {});
        }

        await syncPromise;
        t2 = Date.now();
        perfEmitter.duration("engine.syncMcp", t2 - t1);
      } catch (e) {
        log.warn("[UnifiedAgent] syncMcp failed:", e);
      }
    } else if (needCreateEngine && memoryService.isInitialized()) {
      // MCP 未变更但需要创建引擎，仍并行启动 memory ready
      memoryReadyPromise = memoryService
        .ensureMemoryReadyForSession()
        .then(() => {})
        .catch(() => {});
    }
    t2 = t2 || t1;

    // Resolve env template variables
    const resolvedEnv = agentServer?.env
      ? resolveAgentEnv(agentServer.env, mp)
      : undefined;

    // Extract final model
    let model = mp?.model;
    if (!model && resolvedEnv) {
      model = resolvedEnv.OPENCODE_MODEL || resolvedEnv.ANTHROPIC_MODEL;
    }
    model = model || this.baseConfig?.model;

    // Check if existing engine needs to be replaced (config changed)
    if (existingEngine && existingEngine.isReady) {
      const hasConfigChange = this.detectConfigChange(registryKey, {
        requiredEngine,
        resolvedEnv,
        model,
        mp,
        requestMcpServersEarly,
      });

      if (!hasConfigChange) {
        firstTokenTrace.trace("engine.ensure.config_unchanged", {
          requestId: request.request_id,
          sessionId: request.session_id,
          projectId: request.project_id,
          engine: existingEngine.engineName,
        });
        return existingEngine;
      }

      // Config changed — check if we can safely replace
      if (existingEngine.getActivePromptCount() > 0) {
        log.warn(
          `[UnifiedAgent] ⚠️ Config changed for project ${registryKey} but has active prompts (${existingEngine.getActivePromptCount()}), using current engine`,
        );
        return existingEngine;
      }

      log.info(
        `[UnifiedAgent] 🔄 Config changed for project ${registryKey}, rebuilding engine`,
      );
      existingEngine.removeAllListeners();
      await existingEngine.destroy();
      this.engines.delete(registryKey);
      this.engineConfigs.delete(registryKey);
      this.engineRawMcpServers.delete(registryKey);
    }

    // Build effective config for this project
    const base = this.baseConfig || {
      engine: requiredEngine || "claude-code",
      workspaceDir: "",
    };

    if (!model) {
      log.warn(
        `[UnifiedAgent] ⚠️ Model not set! model_provider.model and agent_config env both have no model info`,
      );
    }

    const mergedEnv = { ...(base.env || {}), ...(resolvedEnv || {}) };

    // OPENCODE_LOG_DIR 容器路径本地化
    if (
      mergedEnv.OPENCODE_LOG_DIR &&
      !fs.existsSync(mergedEnv.OPENCODE_LOG_DIR)
    ) {
      const localLogDir = path.join(os.homedir(), APP_DATA_DIR_NAME, "logs");
      log.info(
        `[UnifiedAgent] 📂 OPENCODE_LOG_DIR localized: ${mergedEnv.OPENCODE_LOG_DIR} → ${localLogDir}`,
      );
      mergedEnv.OPENCODE_LOG_DIR = localLogDir;
    }

    // 动态 MCP server 已由 syncMcpConfigToProxyAndReload() 同步到 proxy，
    // 使用 getAgentMcpConfig() 获取最新的 proxy 配置
    // 使用 ACP 请求中的 MCP 配置（requestMcpServersEarly）
    let freshMcpServers: AgentConfig["mcpServers"] | undefined;
    if (Object.keys(requestMcpServersRuntime).length > 0) {
      // 处理 bridge 入口（mcp-proxy）：提取内部真实 MCP 服务器配置
      // 并转换为 bridge URL 格式（用于传递给 agent）
      const { extractRealMcpServers } = await import("../packages/mcp");
      const realMcpServers: Record<
        string,
        import("../packages/mcp").McpServerEntry
      > = {};
      for (const [name, entry] of Object.entries(requestMcpServersRuntime)) {
        if (!("command" in entry)) {
          // URL 类型（RemoteMcpServerEntry），直接保留
          realMcpServers[name] = entry;
          continue;
        }
        // command 类型：检查是否为 bridge 入口
        const isBridge =
          entry.command === "mcp-proxy" ||
          path.basename(entry.command) === "mcp-proxy";
        if (isBridge) {
          // Bridge 入口：提取内部真实 MCP 服务器配置
          const extracted = extractRealMcpServers(
            entry.command,
            entry.args || [],
            entry.env,
          );
          if (extracted) {
            // 将提取的服务器配置添加到 realMcpServers
            for (const [innerName, innerEntry] of Object.entries(extracted)) {
              realMcpServers[innerName] = innerEntry;
            }
          }
        } else {
          // 非 bridge 入口：直接保留
          realMcpServers[name] = entry;
        }
      }
      t3 = Date.now();
      perfEmitter.duration("engine.extractMcp", t3 - t2);

      if (Object.keys(realMcpServers).length > 0) {
        freshMcpServers = realMcpServers;
        // 暂存到 proxy manager 并启动 bridge
        const { mcpProxyManager } = await import("../packages/mcp");
        // 合并现有配置（保留默认服务如 chrome-devtools）
        mcpProxyManager.setConfig({
          ...mcpProxyManager.getConfig(),
          mcpServers: {
            ...(mcpProxyManager.getConfig().mcpServers || {}),
            ...realMcpServers,
          },
        });
        await mcpProxyManager.ensureBridgeStarted();
        t4 = Date.now();
        perfEmitter.duration("engine.ensureBridge(mcp)", t4 - t3);
        // 获取代理格式的配置（包含 bridge URL 和 allowTools）
        freshMcpServers =
          mcpProxyManager.getAgentMcpConfig(engineKey) || undefined;
      } else {
        t4 = t3;
      }
    } else {
      // 无动态 MCP 服务器时，仍需确保 bridge 启动（包含默认服务如 chrome-devtools）
      const { mcpProxyManager } = await import("../packages/mcp");
      t3 = Date.now();
      await mcpProxyManager.ensureBridgeStarted();
      t4 = Date.now();
      perfEmitter.duration("engine.ensureBridge(no-mcp)", t4 - t3);
      freshMcpServers =
        mcpProxyManager.getAgentMcpConfig(engineKey) || undefined;
    }
    t4 = t4 || t3;

    const effectiveConfig: AgentConfig = {
      ...base,
      engine: requiredEngine || base.engine,
      apiKey: mp?.api_key || base.apiKey,
      baseUrl: mp?.base_url || base.baseUrl,
      model,
      apiProtocol: mp?.api_protocol || base.apiProtocol,
      env: mergedEnv,
      mcpServers: freshMcpServers,
    };

    log.info(
      `[UnifiedAgent] 📌 Engine config for project ${engineKey}:\n` +
        `├─ engine: ${effectiveConfig.engine}\n` +
        `├─ config.model: ${effectiveConfig.model || "⚠️ not set"}\n` +
        `├─ env OPENCODE_MODEL: ${effectiveConfig.env?.OPENCODE_MODEL || "(not set)"}\n` +
        `├─ env ANTHROPIC_MODEL: ${effectiveConfig.env?.ANTHROPIC_MODEL || "(not set)"}\n` +
        `├─ baseUrl: ${effectiveConfig.baseUrl || "(not set)"}\n` +
        `├─ apiKeySet: ${!!effectiveConfig.apiKey}\n` +
        `└─ mcpServers: ${effectiveConfig.mcpServers ? Object.keys(effectiveConfig.mcpServers).join(", ") : "(none)"}`,
    );

    // 传递 memoryReadyPromise，避免 getOrCreateEngine 重复等待 memory
    const engine = await this.getOrCreateEngine(
      engineKey,
      effectiveConfig,
      memoryReadyPromise,
    );
    t5 = Date.now();
    perfEmitter.duration("engine.ensure", t5 - t0, { engineKey });
    firstTokenTrace.trace(
      "engine.ensure.done",
      {
        requestId: request.request_id,
        sessionId: request.session_id,
        projectId: request.project_id,
        engine: engine.engineName,
      },
      { latencyMs: t5 - t0, engineKey },
    );

    // 仅在引擎实际被创建/重建时到达此处（detectConfigChange 返回 false 时已 early-return）。
    // 将本次过滤好的原始 MCP servers 存入快照，key 用实际注册表 key 以便 detectConfigChange 能命中。
    const finalRegistryKey = this.resolveEngineKey(engineKey) || engineKey;
    this.engineRawMcpServers.set(
      finalRegistryKey,
      filterBridgeEntries(requestMcpServersEarly),
    );

    return engine;
  }

  /**
   * Detect if the effective config differs from the running engine's stored config.
   */
  private detectConfigChange(
    projectId: string,
    params: {
      requiredEngine: AgentEngineType | null;
      resolvedEnv?: Record<string, string>;
      model?: string;
      mp?: ModelProviderConfig;
      requestMcpServersEarly: Record<string, McpServerEntry>;
    },
  ): boolean {
    const { requiredEngine, resolvedEnv, model, mp, requestMcpServersEarly } =
      params;
    const currentConfig = this.engineConfigs.get(projectId) || this.baseConfig;

    const needsSwitch =
      !!requiredEngine && requiredEngine !== currentConfig?.engine;

    // 先对 resolvedEnv 进行本地化处理（与 ensureEngineForRequest 中的逻辑一致）
    // 避免因为路径本地化导致的误判
    let normalizedResolvedEnv = resolvedEnv;
    if (
      resolvedEnv?.OPENCODE_LOG_DIR &&
      !fs.existsSync(resolvedEnv.OPENCODE_LOG_DIR)
    ) {
      normalizedResolvedEnv = {
        ...resolvedEnv,
        OPENCODE_LOG_DIR: path.join(os.homedir(), APP_DATA_DIR_NAME, "logs"),
      };
    }

    const currentEnvStr = currentConfig?.env
      ? JSON.stringify(currentConfig.env, Object.keys(currentConfig.env).sort())
      : "";
    const newEnvStr = normalizedResolvedEnv
      ? JSON.stringify(
          normalizedResolvedEnv,
          Object.keys(normalizedResolvedEnv).sort(),
        )
      : "";
    const envChanged = !!normalizedResolvedEnv && newEnvStr !== currentEnvStr;

    const modelChanged = !!model && model !== (currentConfig?.model || "");
    const apiKeyChanged =
      !!mp?.api_key && mp.api_key !== (currentConfig?.apiKey || "");
    const baseUrlChanged =
      !!mp?.base_url && mp.base_url !== (currentConfig?.baseUrl || "");

    // MCP servers 变更检测 — 过滤掉 mcp-proxy bridge 入口，然后与上次请求的原始配置做同格式比较。
    // 修复：engineConfigs.mcpServers 存储的是 proxy 包装格式（command=mcp-proxy），
    //       而 requestMcpServersEarly 是原始格式（command=uvx/npx/...），两者直接对比永远不等。
    //       改为将上次请求的原始格式存入 engineRawMcpServers，本次与之比较，消除跨格式误判。
    const requestMcpServers = filterBridgeEntries(requestMcpServersEarly);
    const storedRawMcp = this.engineRawMcpServers.get(projectId);
    const mcpChanged = !rawMcpServersEqual(requestMcpServers, storedRawMcp);

    const result =
      needsSwitch ||
      envChanged ||
      modelChanged ||
      apiKeyChanged ||
      baseUrlChanged ||
      mcpChanged;

    // 调试日志：输出触发配置变更的具体原因
    if (result) {
      // 计算环境变量差异（敏感字段仅记录掩码，避免日志泄露 secret/token/apiKey）。
      const envDiffDetails: Record<string, unknown> = {};
      if (envChanged && resolvedEnv && currentConfig?.env) {
        const currentEnv = currentConfig.env as EnvRecord;
        const allKeys = new Set([
          ...Object.keys(currentEnv),
          ...Object.keys(resolvedEnv),
        ]);
        const isSensitiveEnvKey = (key: string) =>
          /(key|token|secret|password|authorization|credential)/i.test(key);
        const normalizeEnvValue = (key: string, value: string | undefined) => {
          if (isSensitiveEnvKey(key)) return "***";
          if (typeof value !== "string") return value;
          return value.length > 50 ? value.slice(0, 50) + "..." : value;
        };
        for (const key of allKeys) {
          const oldVal = currentEnv[key];
          const newVal = resolvedEnv[key];
          if (oldVal !== newVal) {
            envDiffDetails[key] = {
              old: normalizeEnvValue(key, oldVal),
              new: normalizeEnvValue(key, newVal),
            };
          }
        }
      } else if (envChanged && resolvedEnv && !currentConfig?.env) {
        envDiffDetails["reason"] =
          "currentConfig.env is empty but resolvedEnv has values";
        // 过滤敏感 key 名，避免泄露业务特征
        const isSensitiveEnvKey = (key: string) =>
          /(key|token|secret|password|authorization|credential)/i.test(key);
        envDiffDetails["resolvedEnvKeys"] = Object.keys(resolvedEnv).filter(
          (k) => !isSensitiveEnvKey(k),
        );
      }
      log.info(
        `[UnifiedAgent] 🔍 detectConfigChange(${projectId}): ${result ? "CHANGED" : "unchanged"}`,
        {
          needsSwitch,
          envChanged,
          modelChanged,
          apiKeyChanged,
          baseUrlChanged,
          mcpChanged,
          details: {
            currentModel: currentConfig?.model,
            newModel: model,
            currentApiKeyLen: currentConfig?.apiKey?.length,
            newApiKeyLen: mp?.api_key?.length,
            currentBaseUrl: currentConfig?.baseUrl,
            newBaseUrl: mp?.base_url,
            storedMcpKeys: storedRawMcp ? Object.keys(storedRawMcp) : "(none)",
            requestMcpKeys: Object.keys(requestMcpServers),
            currentEnvKeys: currentConfig?.env
              ? Object.keys(currentConfig.env)
              : "(none)",
            resolvedEnvKeys: resolvedEnv ? Object.keys(resolvedEnv) : "(none)",
            envDiff:
              Object.keys(envDiffDetails).length > 0
                ? envDiffDetails
                : "(no diff)",
          },
        },
      );
    }

    return result;
  }

  /**
   * Get the engine for a specific project.
   * Looks up by engine registry key first, then searches all engines
   * for a session whose projectId matches (handles the case where
   * the backend sends back a session_id as project_id).
   */
  getEngineForProject(projectId: string): AcpEngine | null {
    if (!projectId) return null;

    // 1. Direct lookup by engine registry key
    const engine = this.engines.get(projectId);
    if (engine && engine.isReady) return engine;

    // 2. Search all engines for a session matching this projectId
    //    (covers the case where projectId is actually a session_id or
    //     the original chat request.project_id differs from the engine key)
    for (const [, eng] of this.engines) {
      if (!eng.isReady) continue;
      const session = eng.findSessionByProjectId(projectId);
      if (session) return eng;
    }

    return null;
  }

  /**
   * Resolve a projectId (which may be a session_id) to the actual engine registry key.
   * Returns null if no matching engine is found.
   */
  private resolveEngineKey(projectId: string): string | null {
    if (!projectId) return null;

    // 1. Direct key match
    if (this.engines.has(projectId)) return projectId;

    // 2. Search by session projectId
    for (const [key, engine] of this.engines) {
      const session = engine.findSessionByProjectId(projectId);
      if (session) return key;
    }

    return null;
  }

  /**
   * Whether the service is configured (baseConfig set).
   * In lazy mode, engines are created on first chat — this returns true once init() is called.
   */
  get isReady(): boolean {
    return this.baseConfig !== null;
  }

  /**
   * Whether at least one engine process is actually running and ready.
   */
  get hasRunningEngines(): boolean {
    for (const [, engine] of this.engines) {
      if (engine.isReady) return true;
    }
    return false;
  }

  /**
   * Backward-compatible: return the first ready engine (for proxy methods and agentHandlers).
   */
  getAcpEngine(): AcpEngine | null {
    for (const [, engine] of this.engines) {
      if (engine.isReady) return engine;
    }
    return null;
  }

  // === Proxy methods (all delegated to first available AcpEngine for backward compat) ===

  async listSessions(): Promise<SdkSession[]> {
    const engine = this.getAcpEngine();
    if (!engine) return [];
    return engine.listSessions();
  }

  /**
   * List all sessions across all engines with detailed status info.
   * Used by the Sessions tab in the renderer.
   */
  listAllSessionsDetailed(): DetailedSession[] {
    const all: DetailedSession[] = [];
    for (const [projectId, engine] of this.engines) {
      // Only include sessions from engines that are known to be alive/ready.
      // This prevents stale sessions from a crashed/terminated ACP process from
      // polluting the "活跃会话" list.
      if (!engine.isReady) {
        log.debug("[UnifiedAgent] Skipping non-ready engine", {
          projectId,
          engineType: engine.engineName,
        });
        continue;
      }
      all.push(...engine.listSessionsDetailed());
    }
    return all;
  }

  /**
   * Stop a specific session by ID.
   * Aborts and deletes the session. Only destroys the engine if no sessions remain.
   */
  async stopSession(sessionId: string): Promise<boolean> {
    for (const [projectId, engine] of this.engines) {
      const session = engine.findSessionByProjectId(sessionId);
      if (session) {
        const pid = engine.getProcessPid();
        log.info(
          `[UnifiedAgent] Stopping session ${sessionId} (internal=${session.id}) in engine ${projectId}, pid=${pid}, sessionCount=${engine.sessionCount}`,
        );
        try {
          await engine.abortSession(session.id);
        } catch (e) {
          log.warn(`[UnifiedAgent] Abort session error:`, e);
        }
        try {
          await engine.deleteSession(session.id);
        } catch (e) {
          log.warn(`[UnifiedAgent] Delete session error:`, e);
        }

        log.info(
          `[UnifiedAgent] After delete: sessionCount=${engine.sessionCount}`,
        );

        // If no sessions remain in this engine, destroy it to clean up MCP child processes.
        // PersistentMcpBridge (browser MCP) is unaffected — it runs in the Electron main process.
        // Next session creation will auto-create a new engine via ensureEngineForRequest().
        if (engine.sessionCount === 0) {
          log.info(
            `[UnifiedAgent] No sessions left, destroying engine ${projectId} (pid=${pid})`,
          );
          engine.removeAllListeners();
          await engine.destroy();
          this.engines.delete(projectId);
          this.engineConfigs.delete(projectId);
          this.engineRawMcpServers.delete(projectId);
          log.info(
            `[UnifiedAgent] Engine ${projectId} destroyed, remaining engines: ${this.engines.size}`,
          );
          // 引擎销毁后，重新预热 warmup（如果当前没有其他引擎）
          this.warmup.respawn(this.baseConfig, (e) => this.forwardEvents(e));
        } else {
          log.info(
            `[UnifiedAgent] Engine ${projectId} still has ${engine.sessionCount} session(s), NOT destroying`,
          );
        }

        return true;
      }
    }
    log.warn(
      `[UnifiedAgent] Session not found for stop: ${sessionId}, engines=${this.engines.size}, all sessions: ${JSON.stringify(
        this.listAllSessionsDetailed().map((s) => ({
          id: s.id,
          projectId: s.projectId,
          title: s.title,
        })),
      )}`,
    );
    return false;
  }

  async createSession(opts?: {
    parentID?: string;
    title?: string;
  }): Promise<SdkSession> {
    const engine = this.getAcpEngine();
    if (!engine) throw new Error("No engine available");
    return engine.createSession(opts);
  }

  async getSession(id: string): Promise<SdkSession> {
    const engine = this.getAcpEngine();
    if (!engine) throw new Error("No engine available");
    return engine.getSession(id);
  }

  async deleteSession(id: string): Promise<boolean> {
    const engine = this.getAcpEngine();
    if (!engine) throw new Error("No engine available");
    return engine.deleteSession(id);
  }

  async abortSession(id: string): Promise<void> {
    const engine = this.getAcpEngine();
    if (!engine) return;
    await engine.abortSession(id);
  }

  async prompt(
    sessionId: string,
    parts: Array<TextPartInput | FilePartInput>,
    opts?: PromptOptions,
  ): Promise<MessageWithParts> {
    const engine = this.getAcpEngine();
    if (!engine) throw new Error("No engine available");
    return engine.prompt(sessionId, parts as any, opts);
  }

  async promptAsync(
    sessionId: string,
    parts: Array<TextPartInput | FilePartInput>,
    opts?: PromptOptions,
  ): Promise<void> {
    const engine = this.getAcpEngine();
    if (!engine) throw new Error("No engine available");

    // Track user message for memory extraction (non-blocking, errors ignored)
    try {
      this.handleMessageForMemory(sessionId, parts);
    } catch (error) {
      log.warn("[UnifiedAgent] Failed to track message for memory:", error);
    }

    return engine.promptAsync(sessionId, parts as any, opts);
  }

  respondPermission(
    permissionId: string,
    response: "once" | "always" | "reject",
  ): void {
    // Try all engines — permission could belong to any
    for (const [, engine] of this.engines) {
      engine.respondPermission(permissionId, response);
    }
  }

  // === ACP engine specific ===

  async claudePrompt(message: string): Promise<string> {
    const acpEngine = this.getAcpEngine();
    if (!acpEngine) throw new Error("ACP engine not active");
    return acpEngine.claudePrompt(message);
  }

  // === Memory Integration ===

  /**
   * Handle user message for memory extraction
   * Called from prompt/promptAsync methods
   */
  handleMessageForMemory(
    projectId: string,
    parts: Array<TextPartInput | FilePartInput>,
  ): void {
    if (!memoryService.isInitialized() || !this.baseConfig) return;

    // Extract text from parts
    const textParts = parts.filter((p) => p.type === "text") as TextPartInput[];
    if (textParts.length === 0) return;

    const content = textParts.map((p) => p.text).join("\n");

    // Build model config for memory extraction
    const modelConfig: ModelConfig = {
      provider: this.engineType === "claude-code" ? "anthropic" : "openai",
      model: this.baseConfig.model || "",
      apiKey: this.baseConfig.apiKey || "",
      baseUrl: this.baseConfig.baseUrl,
    };

    // Delegate to MemoryService handleMessage (writes transcript + triggers segment extraction)
    memoryService.handleMessage(
      projectId,
      { role: "user", content },
      modelConfig,
    );
  }

  // === Helpers ===

  private forwardEvents(engine: AcpEngine): void {
    const events = [
      "message.updated",
      "message.removed",
      "message.part.updated",
      "message.part.removed",
      "permission.updated",
      "permission.replied",
      "session.created",
      "session.updated",
      "session.deleted",
      "session.status",
      "session.idle",
      "session.error",
      "session.diff",
      "file.edited",
      "server.connected",
      "error",
      "ready",
      "destroyed",
      // rcoder-compat events
      "computer:progress",
      "computer:promptStart",
      "computer:promptEnd",
    ];

    for (const event of events) {
      engine.on(event, (...args: unknown[]) => {
        // Debug: log event forwarding
        if (
          event === "message.part.updated" ||
          event === "message.updated" ||
          event === "computer:progress"
        ) {
          log.debug(
            `[UnifiedAgent] 📤 Forwarding event: ${event}`,
            JSON.stringify(args).substring(0, 200),
          );
        }
        this.emit(event, ...args);
      });
    }

    // --- Memory: buffer assistant text chunks and flush on promptEnd ---

    // Clear buffer on promptStart to prevent stale data
    engine.on("computer:promptStart", (...args: unknown[]) => {
      try {
        const data = args[0] as { sessionId?: string } | undefined;
        const sessionId = data?.sessionId;
        if (sessionId) {
          this.assistantTextBuffers.delete(sessionId);
        }
      } catch {
        /* non-blocking */
      }
    });

    // Accumulate assistant text parts
    engine.on("message.part.updated", (...args: unknown[]) => {
      try {
        const data = args[0] as
          | { sessionId?: string; type?: string; text?: string }
          | undefined;
        if (!data || data.type !== "text" || !data.text) return;
        const sessionId = data.sessionId;
        if (!sessionId) return;
        const existing = this.assistantTextBuffers.get(sessionId) ?? "";
        this.assistantTextBuffers.set(sessionId, existing + data.text);
      } catch {
        /* non-blocking */
      }
    });

    // Flush buffered assistant text to memory on promptEnd
    engine.on("computer:promptEnd", (...args: unknown[]) => {
      try {
        const data = args[0] as
          | { sessionId?: string; openLongMemory?: boolean }
          | undefined;
        const sessionId = data?.sessionId;
        if (!sessionId) return;

        // 检查记忆开关，默认 false
        if (data?.openLongMemory !== true) return;

        const buffered = this.assistantTextBuffers.get(sessionId);
        this.assistantTextBuffers.delete(sessionId);

        // Use engine's current config (may be updated from HTTP request model_provider)
        const engineConfig = engine.currentConfig;
        if (
          !buffered ||
          !buffered.trim() ||
          !memoryService.isInitialized() ||
          !engineConfig
        )
          return;

        const modelConfig: ModelConfig = {
          provider: engine.engineName.includes("claude")
            ? "anthropic"
            : "openai",
          model: engineConfig.model || "",
          apiKey: engineConfig.apiKey || "",
          baseUrl: engineConfig.baseUrl,
          apiProtocol: engineConfig.apiProtocol,
        };

        memoryService.handleMessage(
          sessionId,
          { role: "assistant", content: buffered },
          modelConfig,
        );
      } catch (error) {
        log.warn(
          "[UnifiedAgent] Failed to flush assistant text to memory:",
          error,
        );
      }
    });

    // Trigger incremental memory extraction when session becomes idle (after each prompt)
    // Note: This calls onSessionEnd which internally checks getMaxCompletedMsgIndex()
    // to only process new messages that haven't been extracted yet.
    // This provides incremental extraction rather than re-processing all messages.
    engine.on("session.idle", (...args: unknown[]) => {
      try {
        const data = args[0] as
          | { sessionId?: string; openLongMemory?: boolean }
          | undefined;
        const sessionId = data?.sessionId;
        // Use engine's current config (may be updated from HTTP request model_provider)
        const engineConfig = engine.currentConfig;
        // Skip if no sessionId, memory not initialized, or no engine config
        if (!sessionId || !memoryService.isInitialized() || !engineConfig)
          return;
        // 检查记忆开关，默认 false
        if (data?.openLongMemory !== true) return;
        // Skip if no API key (required for LLM-based extraction)
        if (!engineConfig.apiKey) {
          log.debug(
            "[UnifiedAgent] Skipping incremental extraction: no API key configured",
          );
          return;
        }

        const modelConfig: ModelConfig = {
          provider: engine.engineName.includes("claude")
            ? "anthropic"
            : "openai",
          model: engineConfig.model || "",
          apiKey: engineConfig.apiKey,
          baseUrl: engineConfig.baseUrl,
          apiProtocol: engineConfig.apiProtocol,
        };

        // Trigger incremental extraction (async, non-blocking)
        // This will extract any new messages since the last extraction
        memoryService.onSessionEnd(sessionId, modelConfig).catch((err) => {
          log.warn("[UnifiedAgent] Incremental memory extraction failed:", err);
        });
      } catch (error) {
        log.warn(
          "[UnifiedAgent] Failed to trigger incremental extraction:",
          error,
        );
      }
    });
  }
}

// ==================== Singleton & Export ====================

export const agentService = new UnifiedAgentService();

export default agentService;
