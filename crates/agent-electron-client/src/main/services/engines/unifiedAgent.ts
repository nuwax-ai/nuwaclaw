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

// Re-export engine classes
export { AcpEngine } from "./acp/acpEngine";
export { mapAgentCommand, resolveAgentEnv } from "./agentHelpers";

import { AcpEngine } from "./acp/acpEngine";
import { loadAcpSdk } from "./acp/acpClient";
import { mapAgentCommand, resolveAgentEnv } from "./agentHelpers";
import dependencies from "../system/dependencies";
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

// ==================== Types ====================

export type AgentEngineType = "nuwaxcode" | "claude-code";

export interface AgentConfig {
  engine: AgentEngineType;
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  apiProtocol?: string; // 'anthropic' or 'openai' - API protocol to use
  workspaceDir: string;
  hostname?: string;
  port?: number;
  timeout?: number;
  engineBinaryPath?: string;
  env?: Record<string, string>;
  mcpServers?: Record<
    string,
    | { command: string; args: string[]; env?: Record<string, string> }
    | { url: string; type?: "http" | "sse" }
  >;
  permissionMode?: "default" | "acceptEdits" | "bypassPermissions";
  systemPrompt?: string;
  /** Process purpose for registry tracking (set internally by warm pool) */
  purpose?: "engine" | "warm-pool";
}

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

  /** Buffer assistant text chunks per session for memory tracking */
  private assistantTextBuffers = new Map<string, string>();

  /**
   * 预热引擎池：按引擎类型各保留 1 个已初始化的 AcpEngine，请求到来时按 requestedEngine 复用，省掉冷启动（~4s）。
   * init 时同时预热 claude-code 与 nuwaxcode，避免「init 用 claude-code、请求用 nuwaxcode」导致永远无法复用。
   */
  private warmEnginePool = new Map<AgentEngineType, AcpEngine>();
  /** 当前正在执行的预热任务，按引擎类型去重，避免同一类型重复启动 */
  private warmEngineTasks = new Map<AgentEngineType, Promise<void>>();
  /** In-flight warming engines (not yet in warmEnginePool), tracked for process registry */
  private warmingEngines = new Set<AcpEngine>();

  /**
   * Initialize the service with a base config.
   * Does NOT spawn a process — processes are created lazily per project_id
   * on the first chat request via getOrCreateEngine().
   */
  async init(config: AgentConfig): Promise<boolean> {
    if (this.engines.size > 0) {
      await this.destroy();
    }

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
    // 后台同时预热两种引擎，避免 init 为 claude-code 而请求为 nuwaxcode 时永远无法复用
    this.startWarmingEngine("claude-code");
    this.startWarmingEngine("nuwaxcode");
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
    // 先等待所有预热任务结束（任务可能正在向 warmEnginePool 推送新引擎）
    const warmTasks = [...this.warmEngineTasks.values()];
    this.warmEngineTasks.clear();
    if (warmTasks.length > 0) {
      await Promise.all(warmTasks.map((p) => p.catch(() => {})));
    }
    // 再销毁预热池中所有引擎（含任务刚放入的）
    for (const engine of this.warmEnginePool.values()) {
      engine.removeAllListeners();
      destroyPromises.push(engine.destroy().catch(() => {}));
    }
    this.warmEnginePool.clear();
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
    for (const engine of this.warmEnginePool.values()) {
      const pid = engine.getProcessPid();
      if (pid) pids.add(pid);
    }
    for (const engine of this.warmingEngines) {
      const pid = engine.getProcessPid();
      if (pid) pids.add(pid);
    }
    return pids;
  }

  /**
   * 后台预热指定类型的 AcpEngine，放入 warmEnginePool。
   * 不阻塞调用方；复用后由 getOrCreateEngine 再次调用 startWarmingEngine(同一类型) 以补充池子。
   * @param engineType 要预热的引擎类型；init 时会对 claude-code 与 nuwaxcode 各调一次。
   */
  private startWarmingEngine(engineType: AgentEngineType): void {
    if (
      this.warmEnginePool.has(engineType) ||
      this.warmEngineTasks.has(engineType) ||
      !this.baseConfig
    ) {
      return;
    }
    const config: AgentConfig = {
      ...this.baseConfig,
      engine: engineType,
      purpose: "warm-pool",
    };
    const task = (async () => {
      const engine = new AcpEngine(engineType);
      this.warmingEngines.add(engine);
      try {
        log.info("[UnifiedAgent] 🔥 后台预热 Engine:", engineType);
        const ok = await engine.init(config);
        if (ok) {
          this.warmEnginePool.set(engineType, engine);
          log.info("[UnifiedAgent] ✅ 预热 Engine 就绪，等待复用:", engineType);
        } else {
          engine.removeAllListeners();
          await engine.destroy().catch(() => {});
        }
      } catch (err) {
        log.warn("[UnifiedAgent] 预热 Engine 失败:", engineType, err);
      } finally {
        this.warmingEngines.delete(engine);
        this.warmEngineTasks.delete(engineType);
      }
    })();
    this.warmEngineTasks.set(engineType, task);
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
  ): Promise<AcpEngine> {
    const t0 = Date.now();
    let t1 = t0,
      t2 = t0,
      t3 = t0;

    const existing = this.engines.get(projectId);
    if (existing) {
      if (existing.isReady) {
        log.debug(
          `⏱️ [getOrCreateEngine][PERF] 复用已有引擎，耗时: ${Date.now() - t0}ms`,
        );
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

    if (!this.baseConfig) {
      throw new Error("UnifiedAgentService not initialized (no baseConfig)");
    }

    // 检查预热池：按请求的引擎类型取用，且必须 apiKey/baseUrl 一致才复用。
    // 否则复用的进程仍是 init 时的认证，claude-code-acp-ts 会返回 "Authentication required"、内容为空。
    const requestedEngine =
      effectiveConfig.engine || this.engineType || "claude-code";
    const warm = this.warmEnginePool.get(requestedEngine);
    if (warm) {
      const wc = warm.currentConfig;
      const authOk =
        wc &&
        (wc.apiKey ?? "") === (effectiveConfig.apiKey ?? "") &&
        (wc.baseUrl ?? "") === (effectiveConfig.baseUrl ?? "");
      if (authOk) {
        this.warmEnginePool.delete(requestedEngine);
        this.forwardEvents(warm);
        warm.updateConfig(effectiveConfig); // 使 model/mcpServers 等与本请求一致
        this.engines.set(projectId, warm);
        this.engineConfigs.set(projectId, effectiveConfig);
        log.info(
          `[UnifiedAgent] 🚀 复用预热引擎 for project: ${projectId}, engine: ${requestedEngine}, 耗时: ${Date.now() - t0}ms`,
        );
        this.startWarmingEngine(requestedEngine);
        return warm;
      }
      // 认证信息不一致，不能复用（否则 claude-code 会报 Authentication required、内容为空）
      warm.removeAllListeners();
      await warm.destroy().catch(() => {});
      this.warmEnginePool.delete(requestedEngine);
    }
    const poolKeys = [...this.warmEnginePool.keys()].join(",") || "(空)";
    log.info(
      `[UnifiedAgent] 池中无对应预热引擎，走冷启动 requestedEngine=${requestedEngine} poolKeys=${poolKeys}`,
    );

    // Ensure memory is ready before starting session
    if (memoryService.isInitialized()) {
      try {
        await memoryService.ensureMemoryReadyForSession();
        t1 = Date.now();
        log.debug(
          `⏱️ [getOrCreateEngine][PERF] ensureMemoryReady 耗时: ${t1 - t0}ms`,
        );
      } catch (error) {
        log.warn("[UnifiedAgent] Memory sync check failed:", error);
      }
    }
    t1 = t1 || t0;

    // Evict oldest idle engine if at capacity
    if (this.engines.size >= MAX_ENGINES) {
      await this.evictIdleEngine();
    }
    t2 = Date.now();
    log.debug(
      `⏱️ [getOrCreateEngine][PERF] evictIdleEngine 检查耗时: ${t2 - t1}ms`,
    );

    const engineType =
      effectiveConfig.engine || this.engineType || "claude-code";
    const engine = new AcpEngine(engineType);
    this.forwardEvents(engine);

    log.info(
      `[UnifiedAgent] Creating engine for project: ${projectId}, engine: ${engineType}`,
    );
    const ok = await engine.init(effectiveConfig);
    t3 = Date.now();
    log.debug(`⏱️ [getOrCreateEngine][PERF] engine.init 耗时: ${t3 - t2}ms`);

    if (!ok) {
      engine.removeAllListeners();
      await engine.destroy().catch(() => {});
      throw new Error(`Failed to create engine for project ${projectId}`);
    }

    this.engines.set(projectId, engine);
    this.engineConfigs.set(projectId, effectiveConfig);
    log.info(
      `[UnifiedAgent] ✅ Engine ready for project: ${projectId} (total engines: ${this.engines.size})`,
    );
    log.debug(
      `⏱️ [getOrCreateEngine][PERF] 总耗时: ${t3 - t0}ms (memory=${t1 - t0}ms, evict=${t2 - t1}ms, init=${t3 - t2}ms)`,
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
  }

  /**
   * Ensure the correct engine is running for the given chat request.
   * Returns the AcpEngine to use for this request.
   */
  async ensureEngineForRequest(
    request: ComputerChatRequest,
  ): Promise<AcpEngine> {
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

    // 按会话动态加载：本请求携带的 context_servers 同步到 MCP Proxy（从桥接项 --config 解析真实服务），一次会话就会更新 proxy 配置
    const requestMcpServersEarly: Record<string, McpServerEntry> = {};
    if (request.agent_config?.context_servers) {
      // Resolve uvx/uv commands to app-internal binaries for dynamic MCP servers
      // For bridge entries (mcp-proxy convert --config ...), extract inner real MCP servers
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
            // Bridge entry: extract real MCP servers from --config JSON
            const extracted = mcpModule.extractRealMcpServers(
              command,
              args,
              srv.env,
            );
            if (extracted) {
              // Merge extracted servers into requestMcpServersEarly
              for (const [innerName, innerSrv] of Object.entries(extracted)) {
                requestMcpServersEarly[innerName] = innerSrv;
              }
            }
          } else {
            // Direct entry: resolve top-level uvx/uv command
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
      log.debug(
        `⏱️ [ensureEngine][PERF] 解析 context_servers 耗时: ${t1 - t0}ms`,
      );

      // 始终同步 MCP 配置，即使 requestMcpServersEarly 为空（表示用户删除了所有动态 MCP）。
      // syncMcpConfigToProxyAndReload 内部保证 chrome-devtools 等默认服务始终存在，
      // 动态 MCP server 根据传入配置动态启停：空列表 → bridge 重置为仅 chrome-devtools。
      try {
        const { syncMcpConfigToProxyAndReload } =
          await import("../packages/mcp");
        await syncMcpConfigToProxyAndReload(requestMcpServersEarly);
        t2 = Date.now();
        log.debug(
          `⏱️ [ensureEngine][PERF] syncMcpConfigToProxyAndReload 耗时: ${t2 - t1}ms`,
        );
      } catch (e) {
        log.warn(
          "[UnifiedAgent] 动态同步 MCP 配置到 proxy 失败（不影响会话）:",
          e,
        );
      }
    } else {
      t1 = Date.now();
      log.debug(`⏱️ [ensureEngine][PERF] 无 context_servers，跳过解析`);
    }
    t2 = t2 || t1;

    const agentServer = request.agent_config?.agent_server;
    const mp = request.model_provider;

    // Early return: 已有引擎且无影响配置的字段时直接复用（按 session_id 或 project_id 查找，可命中「key=project_id 但含该 session」的引擎）
    const existingEngine = this.getEngineForProject(engineKey);
    if (
      existingEngine &&
      existingEngine.isReady &&
      !agentServer?.command &&
      !mp &&
      Object.keys(requestMcpServersEarly).length === 0
    ) {
      return existingEngine;
    }

    // Determine the target engine type
    const requiredEngine = agentServer?.command
      ? mapAgentCommand(agentServer.command)
      : this.engineType;

    // 同一 project/session：已找到引擎且未切换引擎类型时直接复用，不做 MCP/env/model 等细粒度检测，避免 detectConfigChange 误判导致每次请求都重建
    const currentEngineType =
      this.engineConfigs.get(registryKey)?.engine || this.engineType;
    if (
      existingEngine &&
      existingEngine.isReady &&
      (!requiredEngine || requiredEngine === currentEngineType)
    ) {
      return existingEngine;
    }

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
        `[UnifiedAgent] ⚠️ 模型未设置！model_provider.model 和 agent_config env 均无模型信息`,
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
        `[UnifiedAgent] 📂 OPENCODE_LOG_DIR 本地化: ${mergedEnv.OPENCODE_LOG_DIR} → ${localLogDir}`,
      );
      mergedEnv.OPENCODE_LOG_DIR = localLogDir;
    }

    // 动态 MCP server 已由 syncMcpConfigToProxyAndReload() 同步到 proxy，
    // 使用 getAgentMcpConfig() 获取最新的 proxy 配置
    // 使用 ACP 请求中的 MCP 配置（requestMcpServersEarly）
    let freshMcpServers: AgentConfig["mcpServers"] | undefined;
    if (Object.keys(requestMcpServersEarly).length > 0) {
      // 处理 bridge 入口（mcp-proxy）：提取内部真实 MCP 服务器配置
      // 并转换为 bridge URL 格式（用于传递给 agent）
      const { extractRealMcpServers } = await import("../packages/mcp");
      const realMcpServers: Record<
        string,
        import("../packages/mcp").McpServerEntry
      > = {};
      for (const [name, entry] of Object.entries(requestMcpServersEarly)) {
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
      log.debug(
        `⏱️ [ensureEngine][PERF] 提取 real MCP servers 耗时: ${t3 - t2}ms`,
      );

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
        log.debug(
          `⏱️ [ensureEngine][PERF] ensureBridgeStarted(有MCP) 耗时: ${t4 - t3}ms`,
        );
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
      log.debug(
        `⏱️ [ensureEngine][PERF] ensureBridgeStarted(无MCP) 耗时: ${t4 - t3}ms`,
      );
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
        `├─ config.model: ${effectiveConfig.model || "⚠️ 未设置"}\n` +
        `├─ env OPENCODE_MODEL: ${effectiveConfig.env?.OPENCODE_MODEL || "(未设置)"}\n` +
        `├─ env ANTHROPIC_MODEL: ${effectiveConfig.env?.ANTHROPIC_MODEL || "(未设置)"}\n` +
        `├─ baseUrl: ${effectiveConfig.baseUrl || "(未设置)"}\n` +
        `├─ apiKeySet: ${!!effectiveConfig.apiKey}\n` +
        `└─ mcpServers: ${effectiveConfig.mcpServers ? Object.keys(effectiveConfig.mcpServers).join(", ") : "(none)"}`,
    );

    const engine = await this.getOrCreateEngine(engineKey, effectiveConfig);
    t5 = Date.now();
    log.debug(`⏱️ [ensureEngine][PERF] getOrCreateEngine 耗时: ${t5 - t4}ms`);
    log.debug(
      `⏱️ [ensureEngine][PERF] 总耗时: ${t5 - t0}ms (parseCtxServers=${t1 - t0}ms, syncMcp=${(t2 || t1) - t1}ms, extractReal=${t3 - (t2 || t1)}ms, ensureBridge=${t4 - t3}ms, getOrCreate=${t5 - t4}ms)`,
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

    const currentEnvStr = currentConfig?.env
      ? JSON.stringify(currentConfig.env, Object.keys(currentConfig.env).sort())
      : "";
    const newEnvStr = resolvedEnv
      ? JSON.stringify(resolvedEnv, Object.keys(resolvedEnv).sort())
      : "";
    const envChanged = !!resolvedEnv && newEnvStr !== currentEnvStr;

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

    return (
      needsSwitch ||
      envChanged ||
      modelChanged ||
      apiKeyChanged ||
      baseUrlChanged ||
      mcpChanged
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
