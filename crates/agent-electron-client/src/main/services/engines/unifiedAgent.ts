/**
 * Unified Agent Service
 *
 * Architecture:
 * - AcpEngine: ACP protocol (claude-code via claude-code-acp-ts, nuwaxcode via nuwaxcode acp)
 * - UnifiedAgentService: Event bus + engine proxy
 */

import { EventEmitter } from "events";
import log from "electron-log";
import { memoryService } from "../memory";
import { buildModelConfig } from "./utils/buildModelConfig";
import { perfEmitter } from "./perf/perfEmitter";
import { firstTokenTrace } from "./perf/firstTokenTrace";

// Re-export engine classes
export { AcpEngine } from "./acp/acpEngine";
export { mapAgentCommand, resolveAgentEnv } from "./agentHelpers";

import { AcpEngine } from "./acp/acpEngine";
import { loadAcpSdk } from "./acp/acpClient";
import { mapAgentCommand } from "./agentHelpers";
import {
  parseContextServers,
  resolveRequestEngineParams,
  resolveMcpServersForEngine,
  buildEffectiveConfig,
} from "./requestConfigResolver";
import { detectEngineConfigChange } from "./configChangeDetector";
import { attachEngineEventForwarders } from "./engineEventForwarder";
import { EngineWarmup } from "./engineWarmup";
import { buildSandboxPolicyFingerprint } from "./sandboxPolicyFingerprint";
import dependencies from "../system/dependencies";
import { getSandboxPolicy } from "../sandbox/policy";
import { processRegistry } from "../system/processRegistry";
import { probeWorkspaceAccessWithPrompt } from "../system/workspaceAccessProbe";
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
import type { McpServerEntry } from "../packages/mcp";
import {
  filterBridgeEntries,
  rawMcpServersEqual,
} from "../packages/mcpHelpers";

interface McpServersConfig {
  mcpServers: Record<string, McpServerEntry>;
}
import { getCachedSandboxPolicy } from "../sandbox/policyCache";

// ==================== Types ====================
// 共享类型定义在 ./types（避免 acp/ ↔ unifiedAgent 循环 import），
// 此处 re-export 保持外部 import 路径不变。

import type {
  AgentConfig,
  AgentEngineType,
  SdkSession,
  TextPartInput,
  FilePartInput,
  PromptOptions,
  MessageWithParts,
} from "./types";
export type { AgentConfig, AgentEngineType };
export type {
  AcpSessionStatus,
  MessageRole,
  PartType,
  BasePart,
  TextPart,
  ReasoningPart,
  FilePart,
  ToolPart,
  StepStartPart,
  StepFinishPart,
  SnapshotPart,
  PatchPart,
  Part,
  BaseMessage,
  UserMessage,
  AssistantMessage,
  Message,
  TextPartInput,
  FilePartInput,
  FileDiff,
  MessageWithParts,
  PromptOptions,
  CommandOptions,
  SdkSession,
  SessionStatus,
  ToolInfo,
  ProviderInfo,
} from "./types";

// 请求 → 引擎配置解析逻辑在 ./requestConfigResolver，此处 re-export 保持导出面不变
export { resolveRequiredAgentEngine } from "./requestConfigResolver";

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
    {
      getSandboxPolicyFingerprint: () => this.getSandboxPolicyFingerprint(),
    },
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
      const modelConfig = buildModelConfig(
        config.engine || "claude-code",
        config,
      );
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
    // macOS TCC 探测 + 授权弹窗统一由首次创建引擎的 getOrCreateEngine 负责，
    // 不在启动期重复探测(避免 init 与 gate 双开子进程；详见 workspaceAccessProbe)。
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
      const modelConfig = buildModelConfig(
        this.engineType || "claude-code",
        this.baseConfig,
      );

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

  private getSandboxPolicyFingerprint(): string | null {
    try {
      return buildSandboxPolicyFingerprint(getCachedSandboxPolicy());
    } catch (error) {
      log.debug(
        "[UnifiedAgent] failed to build sandbox policy fingerprint for warmup",
        error,
      );
      return null;
    }
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
    const startWarmup = () => {
      this.warmup.start(warmupBaseConfig, (e) => this.forwardEvents(e), {
        allowWhenActiveEngines: options?.allowWhenActiveEngines ?? true,
        mcpServers: options?.mcpServers,
        reason: options?.reason,
      });
    };
    // 冷启动补仓延后到下一 macrotask，避免与刚完成的 init/chat 抢同一事件循环
    if (options?.reason === "create_refill") {
      setTimeout(startWarmup, 0);
    } else {
      startWarmup();
    }
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

    // macOS TCC 兜底：确认引擎子进程能访问工作区 cwd。
    // 若被拦(工作区落在 ~/Downloads 等保护目录且未授权)，nuwaxcode/claude-code 启动即崩
    // (nuwaxcode: "An unknown error occurred"; claude-code: "uv_cwd EPERM")。
    // 这里提前探测并弹窗引导授权，替代不可读的 "Failed to create engine"。
    if (effectiveConfig.workspaceDir) {
      // macOS TCC: 探测工作区 cwd 是否可被子进程访问。被拦时异步弹窗(不阻塞请求)，
      // 并抛清晰错误替代不可读的 "Failed to create engine"。
      const access = await probeWorkspaceAccessWithPrompt(
        effectiveConfig.workspaceDir,
      );
      if (!access.ok) {
        throw new Error(
          access.reason === "missing_dir"
            ? `Workspace directory does not exist: ${effectiveConfig.workspaceDir}`
            : `Workspace directory not accessible by engine (macOS TCC): ${effectiveConfig.workspaceDir}. ` +
                `Grant Full Disk Access in System Settings → Privacy & Security, then restart the app.`,
        );
      }
    }

    const engineType =
      effectiveConfig.engine || this.engineType || "claude-code";
    const engine = new AcpEngine(engineType);
    this.forwardEvents(engine);

    log.info(
      `[UnifiedAgent] Creating engine for project: ${projectId}, engine: ${engineType}`,
    );
    const initResult = await engine.init(effectiveConfig);
    t3 = Date.now();

    if (!initResult.ok) {
      engine.removeAllListeners();
      await engine.destroy().catch(() => {});
      throw new Error(
        `Failed to create engine for project ${projectId}: ${initResult.error || "unknown reason"}`,
      );
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
   * 从数据库加载本地 MCP 配置
   * 返回用户在设置界面配置的 MCP 服务器（不包括 ACP 下发的动态 MCP）
   */
  private async loadLocalMcpConfig(): Promise<Record<string, McpServerEntry>> {
    try {
      const { getDb } = await import("../../db");
      const { applyGuiMcpLocalConfigPolicy } =
        await import("../packages/guiMcpLocalConfig");
      const db = getDb();
      const saved = db
        ?.prepare("SELECT value FROM settings WHERE key = ?")
        .get("mcp_local_config") as { value: string } | undefined;

      if (saved) {
        const config = JSON.parse(saved.value) as McpServersConfig;
        return applyGuiMcpLocalConfigPolicy({
          mcpServers: config.mcpServers || {},
        }).mcpServers;
      }
    } catch (e) {
      log.warn("[UnifiedAgent] Failed to load local MCP config:", e);
    }
    return {};
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
      t5 = t0;

    // 只要 session_id 相同就复用同一引擎；无 session_id 时用 project_id。
    // 查找时用 getEngineForProject(engineKey)，可命中「以 project_id 存储但已含该 session」的引擎（首次请求无 session_id，后续带 session_id）。
    const engineKey = request.session_id || request.project_id || "default";
    const registryKey = this.resolveEngineKey(engineKey) || engineKey; // 引擎在 Map 中实际使用的 key

    // 性能优化：先解析 context_servers（仅解析，不同步），用于后续的快速路径判断
    // 解析逻辑见 requestConfigResolver.ts
    const requestMcpServersEarly = await parseContextServers(
      request.agent_config?.context_servers,
    );
    t1 = Date.now();

    // Dev mode: force engine type for testing, bypasses agent_server.command
    if (
      process.env.NUWACLAW_FORCE_ENGINE &&
      process.env.NODE_ENV === "development"
    ) {
      if (!request.agent_config) {
        request.agent_config = {
          agent_server: { command: process.env.NUWACLAW_FORCE_ENGINE },
        };
      } else if (!request.agent_config.agent_server) {
        request.agent_config.agent_server = {
          command: process.env.NUWACLAW_FORCE_ENGINE,
        };
      } else {
        request.agent_config.agent_server.command =
          process.env.NUWACLAW_FORCE_ENGINE;
      }
      log.info(
        `[UnifiedAgent] Dev mode: forcing engine to "${process.env.NUWACLAW_FORCE_ENGINE}"`,
      );
    }

    const agentServer = request.agent_config?.agent_server;
    const mp = request.model_provider;
    const { requiredEngine, resolvedEnv, requestedModel } =
      resolveRequestEngineParams({
        request,
        fallbackEngine: this.engineType,
        baseModel: this.baseConfig?.model,
      });

    // 性能优化：快速路径检测
    const existingEngine = this.getEngineForProject(engineKey);
    const currentEngineType =
      this.engineConfigs.get(registryKey)?.engine || this.engineType;
    const storedRawMcp = this.engineRawMcpServers.get(registryKey);
    const requestMcpFiltered = filterBridgeEntries(requestMcpServersEarly);
    const mcpChanged = !rawMcpServersEqual(requestMcpFiltered, storedRawMcp);
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

    // 加载本地 MCP 配置并合并到请求配置中
    // 优先级：ACP context_servers > 本地配置
    const localMcpConfig = await this.loadLocalMcpConfig();
    const mergedMcpServers: Record<string, McpServerEntry> = {
      ...localMcpConfig, // 本地配置作为基础
      ...requestMcpServersRuntime, // ACP 配置覆盖本地配置
    };

    // 过滤掉 enabled === false 的服务器
    const enabledMcpServers: Record<string, McpServerEntry> = {};
    for (const [name, entry] of Object.entries(mergedMcpServers)) {
      // 检查 enabled 字段，默认为 true
      // 使用 'in' 操作符进行类型安全检查
      const isEnabled = !("enabled" in entry) || entry.enabled !== false;
      if (isEnabled) {
        enabledMcpServers[name] = entry;
      }
    }

    if (mcpChanged) {
      try {
        const { syncMcpConfigToProxyAndReload } =
          await import("../packages/mcp");
        const syncPromise = syncMcpConfigToProxyAndReload(
          enabledMcpServers, // 使用合并后的配置
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

    // Extract final model
    let model = requestedModel;

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

    // 动态 MCP server 已由 syncMcpConfigToProxyAndReload() 同步到 proxy，
    // bridge 提取与 agent 视角配置见 requestConfigResolver.ts
    const freshMcpServers = await resolveMcpServersForEngine({
      requestMcpServersRuntime,
      engineKey,
      perfStartMs: t2,
    });

    // Determine custom agent command (when agent_server.command is not a known engine)
    const agentCommand = request.agent_config?.agent_server?.command;
    const agentArgs = request.agent_config?.agent_server?.args;
    const customEngineCommand =
      agentCommand && !mapAgentCommand(agentCommand) ? agentCommand : undefined;
    const customEngineArgs =
      customEngineCommand && agentArgs?.length ? agentArgs : undefined;

    const effectiveConfig = buildEffectiveConfig({
      base,
      requiredEngine,
      mp,
      model,
      resolvedEnv,
      freshMcpServers,
      request,
      engineKey,
      customEngineCommand,
      customEngineArgs,
    });

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
    // 比较逻辑见 configChangeDetector.ts；此处仅提供存量快照
    return detectEngineConfigChange(
      {
        projectId,
        currentConfig: this.engineConfigs.get(projectId) || this.baseConfig,
        storedRawMcp: this.engineRawMcpServers.get(projectId),
      },
      params,
    );
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
   * 返回最近活跃 session 所属引擎的 workspaceDir。
   * 供 ttyd 等服务在启动时将 cwd 设置为最近的项目工作目录。
   * 若无 ready 引擎或无 session，返回 null。
   */
  getRecentWorkspaceDir(): string | null {
    let bestKey: string | null = null;
    let bestActivity = 0;
    for (const [key, engine] of this.engines) {
      if (!engine.isReady) continue;
      for (const s of engine.listSessionsDetailed()) {
        const activity = s.lastActivity ?? s.createdAt;
        if (activity > bestActivity) {
          bestActivity = activity;
          bestKey = key;
        }
      }
    }
    if (!bestKey) return null;
    return this.engineConfigs.get(bestKey)?.workspaceDir ?? null;
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
    const modelConfig = buildModelConfig(
      this.engineType || "claude-code",
      this.baseConfig!,
    );

    // Delegate to MemoryService handleMessage (writes transcript + triggers segment extraction)
    memoryService.handleMessage(
      projectId,
      { role: "user", content },
      modelConfig,
    );
  }

  // === Helpers ===

  private forwardEvents(engine: AcpEngine): void {
    // 事件白名单转发 + assistant 文本记忆缓冲见 engineEventForwarder.ts
    attachEngineEventForwarders(engine, {
      emit: (event, ...args) => this.emit(event, ...args),
      assistantTextBuffers: this.assistantTextBuffers,
    });
  }
}

// ==================== Singleton & Export ====================

export const agentService = new UnifiedAgentService();

export default agentService;
