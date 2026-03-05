/**
 * Unified Agent Service
 *
 * Architecture:
 * - AcpEngine: ACP protocol (claude-code via claude-code-acp-ts, nuwaxcode via nuwaxcode acp)
 * - UnifiedAgentService: Event bus + engine proxy
 */

import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import log from 'electron-log';
import { memoryService } from '../memory';
import type { ModelConfig } from '../memory/types';

// Re-export engine classes
export { AcpEngine } from './acp/acpEngine';
export { mapAgentCommand, resolveAgentEnv } from './agentHelpers';

import { AcpEngine } from './acp/acpEngine';
import { mapAgentCommand, resolveAgentEnv } from './agentHelpers';
import dependencies from '../system/dependencies';

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
} from '@shared/types/computerTypes';
import type { ComputerChatRequest, ModelProviderConfig } from '@shared/types/computerTypes';
import { APP_DATA_DIR_NAME } from '../constants';

// ==================== Types ====================

export type AgentEngineType = 'nuwaxcode' | 'claude-code';

export interface AgentConfig {
  engine: AgentEngineType;
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  apiProtocol?: string;  // 'anthropic' or 'openai' - API protocol to use
  workspaceDir: string;
  hostname?: string;
  port?: number;
  timeout?: number;
  engineBinaryPath?: string;
  env?: Record<string, string>;
  mcpServers?: Record<string,
    | { command: string; args: string[]; env?: Record<string, string> }
    | { url: string; type?: 'http' | 'sse' }
  >;
  permissionMode?: 'default' | 'acceptEdits' | 'bypassPermissions';
  systemPrompt?: string;
}

export type AcpSessionStatus = 'idle' | 'pending' | 'active' | 'terminating';

// ==================== Message Types (replacing SDK types) ====================

export type MessageRole = 'user' | 'system' | 'assistant';

export type PartType = 'text' | 'reasoning' | 'file' | 'tool' | 'step_start' | 'step_finish' | 'snapshot' | 'patch';

export interface BasePart {
  type: PartType;
}

export interface TextPart extends BasePart {
  type: 'text';
  text: string;
}

export interface ReasoningPart extends BasePart {
  type: 'reasoning';
  thinking: string;
}

export interface FilePart extends BasePart {
  type: 'file';
  uri?: string;
  mimeType?: string;
}

export interface ToolPart extends BasePart {
  type: 'tool';
  toolCallId: string;
  name: string;
  kind?: string;
  status?: string;
  input?: string;
  output?: string;
  content?: string;
}

export interface StepStartPart extends BasePart {
  type: 'step_start';
  stepId: string;
  title?: string;
}

export interface StepFinishPart extends BasePart {
  type: 'step_finish';
  stepId: string;
  title?: string;
  result?: unknown;
}

export interface SnapshotPart extends BasePart {
  type: 'snapshot';
  snapshotId: string;
}

export interface PatchPart extends BasePart {
  type: 'patch';
  patchId: string;
  filePath?: string;
}

export type Part = TextPart | ReasoningPart | FilePart | ToolPart | StepStartPart | StepFinishPart | SnapshotPart | PatchPart;

export interface BaseMessage {
  role: MessageRole;
  content: Part[];
}

export interface UserMessage extends BaseMessage {
  role: 'user';
}

export interface AssistantMessage extends BaseMessage {
  role: 'assistant';
}

export type Message = UserMessage | AssistantMessage;

export interface TextPartInput {
  type: 'text';
  text: string;
}

export interface FilePartInput {
  type: 'file';
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
  private engineType: AgentEngineType | null = null;
  private baseConfig: AgentConfig | null = null;

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

    this.baseConfig = config;
    this.engineType = config.engine;

    // Initialize MemoryService with app data directory (~/.nuwaxbot/)
    // Memory files should be stored in app data dir, not workspace dir
    try {
      const appDataDir = dependencies.getAppDataDir();
      await memoryService.init(appDataDir, {
        enabled: true,
        extraction: {
          enabled: true,
          implicitEnabled: true,
          explicitEnabled: true,
          guardLevel: 'standard',
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
        provider: config.engine === 'claude-code' ? 'anthropic' : 'openai',
        model: config.model || '',
        apiKey: config.apiKey || '',
        baseUrl: config.baseUrl,
      };
      memoryService.setSchedulerModelConfig(modelConfig);

      log.info('[UnifiedAgent] MemoryService initialized with app data dir:', appDataDir);
    } catch (error) {
      log.error('[UnifiedAgent] MemoryService initialization failed:', error);
    }

    log.info('[UnifiedAgent] Service initialized (lazy mode, no process spawned)');
    this.emit('ready');
    return true;
  }

  /**
   * Destroy all engines and reset the service.
   */
  async destroy(): Promise<void> {
    // Trigger session-end memory extraction for each project
    if (memoryService.isInitialized() && this.baseConfig) {
      const modelConfig: ModelConfig = {
        provider: this.engineType === 'claude-code' ? 'anthropic' : 'openai',
        model: this.baseConfig.model || '',
        apiKey: this.baseConfig.apiKey || '',
        baseUrl: this.baseConfig.baseUrl,
      };

      for (const projectId of this.engines.keys()) {
        try {
          await memoryService.onSessionEnd(projectId, modelConfig);
          log.info(`[UnifiedAgent] Session-end memory extraction completed for: ${projectId}`);
        } catch (error) {
          log.error(`[UnifiedAgent] Session-end memory extraction failed for ${projectId}:`, error);
        }
      }
      await memoryService.destroy();
    }

    const destroyPromises: Promise<void>[] = [];
    for (const [projectId, engine] of this.engines) {
      log.info(`[UnifiedAgent] Destroying engine for project: ${projectId}`);
      engine.removeAllListeners();
      destroyPromises.push(engine.destroy());
    }
    await Promise.all(destroyPromises);
    this.engines.clear();
    this.engineConfigs.clear();
    this.assistantTextBuffers.clear();
    this.engineType = null;
    this.baseConfig = null;
    log.info('[UnifiedAgent] Service destroyed');
    this.emit('destroyed');
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
        log.info(`[UnifiedAgent] Engine stopped for project: ${registryKey} (query=${projectId}, baseConfig preserved)`);
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
      log.info('[UnifiedAgent] All engines stopped (baseConfig preserved)');
    }
  }

  getEngineType(): AgentEngineType | null {
    return this.engineType;
  }

  getAgentConfig(): AgentConfig | null {
    return this.baseConfig;
  }

  /**
   * Get or create an AcpEngine for a given project_id.
   * - Returns existing ready engine
   * - Dead engine → cleanup + rebuild
   * - Missing → create new engine with baseConfig + configOverride
   */
  async getOrCreateEngine(projectId: string, effectiveConfig: AgentConfig): Promise<AcpEngine> {
    const existing = this.engines.get(projectId);
    if (existing) {
      if (existing.isReady) {
        return existing;
      }
      // Dead engine — cleanup and rebuild
      log.info(`[UnifiedAgent] Engine for project ${projectId} is dead, rebuilding`);
      existing.removeAllListeners();
      await existing.destroy().catch(() => {});
      this.engines.delete(projectId);
      this.engineConfigs.delete(projectId);
    }

    if (!this.baseConfig) {
      throw new Error('UnifiedAgentService not initialized (no baseConfig)');
    }

    // Ensure memory is ready before starting session
    if (memoryService.isInitialized()) {
      try {
        await memoryService.ensureMemoryReadyForSession();
      } catch (error) {
        log.warn('[UnifiedAgent] Memory sync check failed:', error);
      }
    }

    // Evict oldest idle engine if at capacity
    if (this.engines.size >= MAX_ENGINES) {
      await this.evictIdleEngine();
    }

    const engineType = effectiveConfig.engine || this.engineType || 'claude-code';
    const engine = new AcpEngine(engineType);
    this.forwardEvents(engine);

    log.info(`[UnifiedAgent] Creating engine for project: ${projectId}, engine: ${engineType}`);
    const ok = await engine.init(effectiveConfig);
    if (!ok) {
      engine.removeAllListeners();
      throw new Error(`Failed to create engine for project ${projectId}`);
    }

    this.engines.set(projectId, engine);
    this.engineConfigs.set(projectId, effectiveConfig);
    log.info(`[UnifiedAgent] ✅ Engine ready for project: ${projectId} (total engines: ${this.engines.size})`);
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
        log.info(`[UnifiedAgent] ♻️ Evicting idle engine for project: ${pid} (at capacity ${MAX_ENGINES})`);
        engine.removeAllListeners();
        await engine.destroy().catch(() => {});
        this.engines.delete(pid);
        this.engineConfigs.delete(pid);
        return;
      }
    }
    // All engines busy — evict the first (oldest inserted) one
    const [oldestPid, oldestEngine] = this.engines.entries().next().value!;
    log.warn(`[UnifiedAgent] ♻️ All engines busy, force-evicting oldest: ${oldestPid}`);
    oldestEngine.removeAllListeners();
    await oldestEngine.destroy().catch(() => {});
    this.engines.delete(oldestPid);
    this.engineConfigs.delete(oldestPid);
  }

  /**
   * Ensure the correct engine is running for the given chat request.
   * Returns the AcpEngine to use for this request.
   */
  async ensureEngineForRequest(request: ComputerChatRequest): Promise<AcpEngine> {
    const projectId = request.project_id || 'default';

    // 按会话动态加载：本请求携带的 context_servers 同步到 MCP Proxy（从桥接项 --config 解析真实服务），一次会话就会更新 proxy 配置
    const requestMcpServersEarly: Record<string, import('../packages/mcp').McpServerEntry> = {};
    if (request.agent_config?.context_servers) {
      // Resolve uvx/uv commands to app-internal binaries for dynamic MCP servers
      // For bridge entries (mcp-proxy convert --config ...), extract inner real MCP servers
      let mcpModule: {
        resolveUvCommand: (cmd: string, args: string[], dir?: string) => { command: string; args: string[] };
        extractRealMcpServers: (cmd: string, args: string[], env?: Record<string, string>, dir?: string) => Record<string, import('../packages/mcp').McpServerEntry> | null;
      } | null = null;
      try {
        mcpModule = await import('../packages/mcp');
      } catch {
        // mcp module not available, proceed without resolution
      }
      for (const [name, srv] of Object.entries(request.agent_config.context_servers)) {
        if (srv.enabled === false || !srv.command) continue;
        const command = srv.command;
        const args = srv.args || [];
        if (mcpModule) {
          if (command === 'mcp-proxy' || path.basename(command) === 'mcp-proxy') {
            // Bridge entry: extract real MCP servers from --config JSON
            const extracted = mcpModule.extractRealMcpServers(command, args, srv.env);
            if (extracted) {
              // Merge extracted servers into requestMcpServersEarly
              for (const [innerName, innerSrv] of Object.entries(extracted)) {
                requestMcpServersEarly[innerName] = innerSrv;
              }
            }
          } else {
            // Direct entry: resolve top-level uvx/uv command
            const resolved = mcpModule.resolveUvCommand(command, args);
            requestMcpServersEarly[name] = { command: resolved.command, args: resolved.args, env: srv.env };
          }
        } else {
          requestMcpServersEarly[name] = { command, args, env: srv.env };
        }
      }
      if (Object.keys(requestMcpServersEarly).length > 0) {
        try {
          const { syncMcpConfigToProxyAndReload } = await import('../packages/mcp');
          await syncMcpConfigToProxyAndReload(requestMcpServersEarly);
        } catch (e) {
          log.warn('[UnifiedAgent] 动态同步 MCP 配置到 proxy 失败（不影响会话）:', e);
        }
      }
    }

    const agentServer = request.agent_config?.agent_server;
    const mp = request.model_provider;

    // Early return: engine already exists and no config-influencing fields in request
    const existingEngine = this.engines.get(projectId);
    if (existingEngine && existingEngine.isReady
      && !agentServer?.command && !mp && Object.keys(requestMcpServersEarly).length === 0) {
      return existingEngine;
    }

    // Determine the target engine type
    const requiredEngine = agentServer?.command
      ? mapAgentCommand(agentServer.command)
      : this.engineType;

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
      const hasConfigChange = this.detectConfigChange(projectId, {
        requiredEngine, resolvedEnv, model, mp, requestMcpServersEarly,
      });

      if (!hasConfigChange) {
        return existingEngine;
      }

      // Config changed — check if we can safely replace
      if (existingEngine.getActivePromptCount() > 0) {
        log.warn(`[UnifiedAgent] ⚠️ Config changed for project ${projectId} but has active prompts (${existingEngine.getActivePromptCount()}), using current engine`);
        return existingEngine;
      }

      log.info(`[UnifiedAgent] 🔄 Config changed for project ${projectId}, rebuilding engine`);
      existingEngine.removeAllListeners();
      await existingEngine.destroy();
      this.engines.delete(projectId);
      this.engineConfigs.delete(projectId);
    }

    // Build effective config for this project
    const base = this.baseConfig || { engine: requiredEngine || 'claude-code', workspaceDir: '' };

    if (!model) {
      log.warn(`[UnifiedAgent] ⚠️ 模型未设置！model_provider.model 和 agent_config env 均无模型信息`);
    }

    const mergedEnv = { ...(base.env || {}), ...(resolvedEnv || {}) };

    // OPENCODE_LOG_DIR 容器路径本地化
    if (mergedEnv.OPENCODE_LOG_DIR && !fs.existsSync(mergedEnv.OPENCODE_LOG_DIR)) {
      const localLogDir = path.join(os.homedir(), APP_DATA_DIR_NAME, 'logs');
      log.info(`[UnifiedAgent] 📂 OPENCODE_LOG_DIR 本地化: ${mergedEnv.OPENCODE_LOG_DIR} → ${localLogDir}`);
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
      const realMcpServers: Record<string, import("../packages/mcp").McpServerEntry> = {};
      for (const [name, entry] of Object.entries(requestMcpServersEarly)) {
        if (!("command" in entry)) {
          // URL 类型（RemoteMcpServerEntry），直接保留
          realMcpServers[name] = entry;
          continue;
        }
        // command 类型：检查是否为 bridge 入口
        const isBridge = entry.command === "mcp-proxy" || path.basename(entry.command) === "mcp-proxy";
        if (isBridge) {
          // Bridge 入口：提取内部真实 MCP 服务器配置
          const extracted = extractRealMcpServers(entry.command, entry.args || [], entry.env);
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
      if (Object.keys(realMcpServers).length > 0) {
        freshMcpServers = realMcpServers;
        // 暂存到 proxy manager 并启动 bridge
        const { mcpProxyManager } = await import("../packages/mcp");
        // 合并现有配置（保留默认服务如 chrome-devtools）
        mcpProxyManager.setConfig({ ...mcpProxyManager.getConfig(), mcpServers: { ...(mcpProxyManager.getConfig().mcpServers || {}), ...realMcpServers } });
        await mcpProxyManager.ensureBridgeStarted();
        // 获取代理格式的配置（包含 bridge URL 和 allowTools）
        freshMcpServers = mcpProxyManager.getAgentMcpConfig() || undefined;
      }
    } else {
      // 无动态 MCP 服务器时，仍需确保 bridge 启动（包含默认服务如 chrome-devtools）
      const { mcpProxyManager } = await import("../packages/mcp");
      await mcpProxyManager.ensureBridgeStarted();
      freshMcpServers = mcpProxyManager.getAgentMcpConfig() || undefined;
    }

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
      `[UnifiedAgent] 📌 Engine config for project ${projectId}:\n` +
      `├─ engine: ${effectiveConfig.engine}\n` +
      `├─ config.model: ${effectiveConfig.model || '⚠️ 未设置'}\n` +
      `├─ env OPENCODE_MODEL: ${effectiveConfig.env?.OPENCODE_MODEL || '(未设置)'}\n` +
      `├─ env ANTHROPIC_MODEL: ${effectiveConfig.env?.ANTHROPIC_MODEL || '(未设置)'}\n` +
      `├─ baseUrl: ${effectiveConfig.baseUrl || '(未设置)'}\n` +
      `├─ apiKeySet: ${!!effectiveConfig.apiKey}\n` +
      `└─ mcpServers: ${effectiveConfig.mcpServers ? Object.keys(effectiveConfig.mcpServers).join(', ') : '(none)'}`,
    );

    return this.getOrCreateEngine(projectId, effectiveConfig);
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
      requestMcpServersEarly: Record<string, import('../packages/mcp').McpServerEntry>;
    },
  ): boolean {
    const { requiredEngine, resolvedEnv, model, mp, requestMcpServersEarly } = params;
    const currentConfig = this.engineConfigs.get(projectId) || this.baseConfig;

    const needsSwitch = !!requiredEngine && requiredEngine !== currentConfig?.engine;

    const currentEnvStr = currentConfig?.env ? JSON.stringify(currentConfig.env, Object.keys(currentConfig.env).sort()) : '';
    const newEnvStr = resolvedEnv ? JSON.stringify(resolvedEnv, Object.keys(resolvedEnv).sort()) : '';
    const envChanged = !!resolvedEnv && newEnvStr !== currentEnvStr;

    const modelChanged = !!model && model !== (currentConfig?.model || '');
    const apiKeyChanged = !!mp?.api_key && mp.api_key !== (currentConfig?.apiKey || '');
    const baseUrlChanged = !!mp?.base_url && mp.base_url !== (currentConfig?.baseUrl || '');

    // MCP servers 变更检测 — filter out bridge entries
    const currentMcpStr = currentConfig?.mcpServers
      ? JSON.stringify(currentConfig.mcpServers, Object.keys(currentConfig.mcpServers).sort())
      : '';
    const requestMcpServers: typeof requestMcpServersEarly = {};
    for (const [name, entry] of Object.entries(requestMcpServersEarly)) {
      if ('command' in entry && (entry.command === 'mcp-proxy' || path.basename(entry.command) === 'mcp-proxy')) continue;
      requestMcpServers[name] = entry;
    }
    const newMcpStr = Object.keys(requestMcpServers).length > 0
      ? JSON.stringify(requestMcpServers, Object.keys(requestMcpServers).sort())
      : '';
    const mcpChanged = !!newMcpStr && newMcpStr !== currentMcpStr;

    return needsSwitch || envChanged || modelChanged || apiKeyChanged || baseUrlChanged || mcpChanged;
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

  async createSession(opts?: { parentID?: string; title?: string }): Promise<SdkSession> {
    const engine = this.getAcpEngine();
    if (!engine) throw new Error('No engine available');
    return engine.createSession(opts);
  }

  async getSession(id: string): Promise<SdkSession> {
    const engine = this.getAcpEngine();
    if (!engine) throw new Error('No engine available');
    return engine.getSession(id);
  }

  async deleteSession(id: string): Promise<boolean> {
    const engine = this.getAcpEngine();
    if (!engine) throw new Error('No engine available');
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
    if (!engine) throw new Error('No engine available');
    return engine.prompt(sessionId, parts as any, opts);
  }

  async promptAsync(
    sessionId: string,
    parts: Array<TextPartInput | FilePartInput>,
    opts?: PromptOptions,
  ): Promise<void> {
    const engine = this.getAcpEngine();
    if (!engine) throw new Error('No engine available');

    // Track user message for memory extraction (non-blocking, errors ignored)
    try {
      this.handleMessageForMemory(sessionId, parts);
    } catch (error) {
      log.warn('[UnifiedAgent] Failed to track message for memory:', error);
    }

    return engine.promptAsync(sessionId, parts as any, opts);
  }

  respondPermission(permissionId: string, response: 'once' | 'always' | 'reject'): void {
    // Try all engines — permission could belong to any
    for (const [, engine] of this.engines) {
      engine.respondPermission(permissionId, response);
    }
  }

  // === ACP engine specific ===

  async claudePrompt(message: string): Promise<string> {
    const acpEngine = this.getAcpEngine();
    if (!acpEngine) throw new Error('ACP engine not active');
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
    const textParts = parts.filter(p => p.type === 'text') as TextPartInput[];
    if (textParts.length === 0) return;

    const content = textParts.map(p => p.text).join('\n');

    // Build model config for memory extraction
    const modelConfig: ModelConfig = {
      provider: this.engineType === 'claude-code' ? 'anthropic' : 'openai',
      model: this.baseConfig.model || '',
      apiKey: this.baseConfig.apiKey || '',
      baseUrl: this.baseConfig.baseUrl,
    };

    // Delegate to MemoryService handleMessage (writes transcript + triggers segment extraction)
    memoryService.handleMessage(
      projectId,
      { role: 'user', content },
      modelConfig
    );
  }

  // === Helpers ===

  private forwardEvents(engine: AcpEngine): void {
    const events = [
      'message.updated', 'message.removed',
      'message.part.updated', 'message.part.removed',
      'permission.updated', 'permission.replied',
      'session.created', 'session.updated', 'session.deleted',
      'session.status', 'session.idle', 'session.error', 'session.diff',
      'file.edited', 'server.connected',
      'error', 'ready', 'destroyed',
      // rcoder-compat events
      'computer:progress', 'computer:promptStart', 'computer:promptEnd',
    ];

    for (const event of events) {
      engine.on(event, (...args: unknown[]) => {
        // Debug: log event forwarding
        if (event === 'message.part.updated' || event === 'message.updated' || event === 'computer:progress') {
          log.debug(`[UnifiedAgent] 📤 Forwarding event: ${event}`, JSON.stringify(args).substring(0, 200));
        }
        this.emit(event, ...args);
      });
    }

    // --- Memory: buffer assistant text chunks and flush on promptEnd ---

    // Clear buffer on promptStart to prevent stale data
    engine.on('computer:promptStart', (...args: unknown[]) => {
      try {
        const data = args[0] as { sessionId?: string } | undefined;
        const sessionId = data?.sessionId;
        if (sessionId) {
          this.assistantTextBuffers.delete(sessionId);
        }
      } catch { /* non-blocking */ }
    });

    // Accumulate assistant text parts
    engine.on('message.part.updated', (...args: unknown[]) => {
      try {
        const data = args[0] as { sessionId?: string; type?: string; text?: string } | undefined;
        if (!data || data.type !== 'text' || !data.text) return;
        const sessionId = data.sessionId;
        if (!sessionId) return;
        const existing = this.assistantTextBuffers.get(sessionId) ?? '';
        this.assistantTextBuffers.set(sessionId, existing + data.text);
      } catch { /* non-blocking */ }
    });

    // Flush buffered assistant text to memory on promptEnd
    engine.on('computer:promptEnd', (...args: unknown[]) => {
      try {
        const data = args[0] as { sessionId?: string; openLongMemory?: boolean } | undefined;
        const sessionId = data?.sessionId;
        if (!sessionId) return;

        // 检查记忆开关，默认 false
        if (data?.openLongMemory !== true) return;

        const buffered = this.assistantTextBuffers.get(sessionId);
        this.assistantTextBuffers.delete(sessionId);

        // Use engine's current config (may be updated from HTTP request model_provider)
        const engineConfig = engine.currentConfig;
        if (!buffered || !buffered.trim() || !memoryService.isInitialized() || !engineConfig) return;

        const modelConfig: ModelConfig = {
          provider: engine.engineName.includes('claude') ? 'anthropic' : 'openai',
          model: engineConfig.model || '',
          apiKey: engineConfig.apiKey || '',
          baseUrl: engineConfig.baseUrl,
          apiProtocol: engineConfig.apiProtocol,
        };

        memoryService.handleMessage(
          sessionId,
          { role: 'assistant', content: buffered },
          modelConfig
        );
      } catch (error) {
        log.warn('[UnifiedAgent] Failed to flush assistant text to memory:', error);
      }
    });

    // Trigger incremental memory extraction when session becomes idle (after each prompt)
    // Note: This calls onSessionEnd which internally checks getMaxCompletedMsgIndex()
    // to only process new messages that haven't been extracted yet.
    // This provides incremental extraction rather than re-processing all messages.
    engine.on('session.idle', (...args: unknown[]) => {
      try {
        const data = args[0] as { sessionId?: string; openLongMemory?: boolean } | undefined;
        const sessionId = data?.sessionId;
        // Use engine's current config (may be updated from HTTP request model_provider)
        const engineConfig = engine.currentConfig;
        // Skip if no sessionId, memory not initialized, or no engine config
        if (!sessionId || !memoryService.isInitialized() || !engineConfig) return;
        // 检查记忆开关，默认 false
        if (data?.openLongMemory !== true) return;
        // Skip if no API key (required for LLM-based extraction)
        if (!engineConfig.apiKey) {
          log.debug('[UnifiedAgent] Skipping incremental extraction: no API key configured');
          return;
        }

        const modelConfig: ModelConfig = {
          provider: engine.engineName.includes('claude') ? 'anthropic' : 'openai',
          model: engineConfig.model || '',
          apiKey: engineConfig.apiKey,
          baseUrl: engineConfig.baseUrl,
          apiProtocol: engineConfig.apiProtocol,
        };

        // Trigger incremental extraction (async, non-blocking)
        // This will extract any new messages since the last extraction
        memoryService.onSessionEnd(sessionId, modelConfig).catch(err => {
          log.warn('[UnifiedAgent] Incremental memory extraction failed:', err);
        });
      } catch (error) {
        log.warn('[UnifiedAgent] Failed to trigger incremental extraction:', error);
      }
    });
  }
}

// ==================== Singleton & Export ====================

export const agentService = new UnifiedAgentService();

export default agentService;
