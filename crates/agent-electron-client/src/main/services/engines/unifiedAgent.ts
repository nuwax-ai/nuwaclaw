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

// Re-export engine classes
export { AcpEngine } from './acp/acpEngine';
export { mapAgentCommand, resolveAgentEnv } from './agentHelpers';

import { AcpEngine } from './acp/acpEngine';
import { mapAgentCommand, resolveAgentEnv } from './agentHelpers';

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
  workspaceDir: string;
  hostname?: string;
  port?: number;
  timeout?: number;
  engineBinaryPath?: string;
  env?: Record<string, string>;
  mcpServers?: Record<string, { command: string; args: string[]; env?: Record<string, string> }>;
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

export class UnifiedAgentService extends EventEmitter {
  private engine: AcpEngine | null = null;
  private engineType: AgentEngineType | null = null;
  private config: AgentConfig | null = null;

  async init(config: AgentConfig): Promise<boolean> {
    if (this.engine) {
      await this.destroy();
    }

    this.config = config;
    this.engineType = config.engine;

    const engine = new AcpEngine(config.engine);
    this.engine = engine;
    this.forwardEvents(engine);
    return engine.init(config);
  }

  async destroy(): Promise<void> {
    if (this.engine) {
      this.engine.removeAllListeners();
      await this.engine.destroy();
      this.engine = null;
    }
    this.engineType = null;
    this.config = null;
    log.info('[UnifiedAgent] Service destroyed');
    this.emit('destroyed');
  }

  getEngineType(): AgentEngineType | null {
    return this.engineType;
  }

  getAgentConfig(): AgentConfig | null {
    return this.config;
  }

  /**
   * Ensure the correct engine is running for the given chat request.
   */
  async ensureEngineForRequest(request: ComputerChatRequest): Promise<void> {
    // 按会话动态加载：本请求携带的 context_servers 同步到 MCP Proxy（从桥接项 --config 解析真实服务），一次会话就会更新 proxy 配置
    const requestMcpServersEarly: NonNullable<AgentConfig['mcpServers']> = {};
    if (request.agent_config?.context_servers) {
      // Resolve uvx/uv commands to app-internal binaries for dynamic MCP servers
      // For bridge entries (mcp-proxy convert --config ...), also resolve inner uvx commands
      let mcpModule: { resolveUvCommand: (cmd: string, args: string[], dir?: string) => { command: string; args: string[] }; resolveBridgeEntry: (cmd: string, args: string[], dir?: string) => { command: string; args: string[] } } | null = null;
      try {
        mcpModule = await import('../packages/mcp');
      } catch {
        // mcp module not available, proceed without resolution
      }
      for (const [name, srv] of Object.entries(request.agent_config.context_servers)) {
        if (srv.enabled === false || !srv.command) continue;
        let command = srv.command;
        let args = srv.args || [];
        if (mcpModule) {
          if (command === 'mcp-proxy' || path.basename(command) === 'mcp-proxy') {
            // Bridge entry: resolve inner uvx/uv commands inside --config JSON
            const resolved = mcpModule.resolveBridgeEntry(command, args);
            command = resolved.command;
            args = resolved.args;
          } else {
            // Direct entry: resolve top-level uvx/uv command
            const resolved = mcpModule.resolveUvCommand(command, args);
            command = resolved.command;
            args = resolved.args;
          }
        }
        requestMcpServersEarly[name] = { command, args, env: srv.env };
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

    if (!agentServer?.command && !mp) return;

    // 1. 确定目标引擎
    const requiredEngine = agentServer?.command
      ? mapAgentCommand(agentServer.command)
      : this.engineType;
    if (!requiredEngine) {
      log.warn(`[UnifiedAgent] 未知的 agent command: ${agentServer?.command}，跳过引擎切换`);
      return;
    }

    // 2. 解析 agent_server.env 模板变量
    const resolvedEnv = agentServer?.env
      ? resolveAgentEnv(agentServer.env, mp)
      : undefined;

    // 3. 提取最终模型
    let model = mp?.model;
    if (!model && resolvedEnv) {
      model = resolvedEnv.OPENCODE_MODEL || resolvedEnv.ANTHROPIC_MODEL;
    }
    model = model || this.config?.model;

    // 4. 判断是否需要 reinit
    const needsSwitch = requiredEngine !== this.engineType;

    const currentEnvStr = this.config?.env ? JSON.stringify(this.config.env, Object.keys(this.config.env).sort()) : '';
    const newEnvStr = resolvedEnv ? JSON.stringify(resolvedEnv, Object.keys(resolvedEnv).sort()) : '';
    const envChanged = !!resolvedEnv && newEnvStr !== currentEnvStr;

    const modelChanged = !!model && model !== (this.config?.model || '');
    const apiKeyChanged = !!mp?.api_key && mp.api_key !== (this.config?.apiKey || '');
    const baseUrlChanged = !!mp?.base_url && mp.base_url !== (this.config?.baseUrl || '');

    // MCP servers 变更检测
    // 过滤旧桥接项 (command==='mcp-proxy')，避免每次请求都因桥接项触发不必要的 reinit
    const currentMcpStr = this.config?.mcpServers
      ? JSON.stringify(this.config.mcpServers, Object.keys(this.config.mcpServers).sort())
      : '';
    const requestMcpServers: typeof requestMcpServersEarly = {};
    for (const [name, entry] of Object.entries(requestMcpServersEarly)) {
      if (entry.command === 'mcp-proxy' || path.basename(entry.command) === 'mcp-proxy') continue;
      requestMcpServers[name] = entry;
    }
    const newMcpStr = Object.keys(requestMcpServers).length > 0
      ? JSON.stringify(requestMcpServers, Object.keys(requestMcpServers).sort())
      : '';
    const mcpChanged = !!newMcpStr && newMcpStr !== currentMcpStr;

    if (!needsSwitch && !envChanged && !modelChanged && !apiKeyChanged && !baseUrlChanged && !mcpChanged) return;

    // Safety: don't switch if there are active prompts
    const acpEngine = this.getAcpEngine();
    if (acpEngine && acpEngine.getActivePromptCount() > 0) {
      log.warn(`[UnifiedAgent] ⚠️ 需要切换引擎但有活跃 prompt (${acpEngine.getActivePromptCount()} 个)，跳过切换，使用当前引擎`);
      return;
    }

    log.info(
      `[UnifiedAgent] 🔄 引擎切换:\n` +
      `├─ 当前引擎: ${this.engineType}\n` +
      `├─ 目标引擎: ${requiredEngine}\n` +
      `├─ 引擎变更: ${needsSwitch}\n` +
      `├─ 环境变更: ${envChanged}\n` +
      `├─ 模型变更: ${modelChanged} (${this.config?.model || '(无)'} → ${model || '(无)'})\n` +
      `├─ apiKey变更: ${apiKeyChanged}\n` +
      `├─ baseUrl变更: ${baseUrlChanged}\n` +
      `├─ MCP变更: ${mcpChanged}\n` +
      `└─ env keys: ${resolvedEnv ? Object.keys(resolvedEnv).join(', ') : '(none)'}`,
    );

    const baseConfig = this.config || { engine: requiredEngine, workspaceDir: '' };

    if (!model) {
      log.warn(`[UnifiedAgent] ⚠️ 模型未设置！model_provider.model 和 agent_config env 均无模型信息`);
    }

    const mergedEnv = { ...(baseConfig.env || {}), ...(resolvedEnv || {}) };

    // OPENCODE_LOG_DIR 容器路径本地化
    if (mergedEnv.OPENCODE_LOG_DIR && !fs.existsSync(mergedEnv.OPENCODE_LOG_DIR)) {
      const localLogDir = path.join(os.homedir(), APP_DATA_DIR_NAME, 'logs');
      log.info(`[UnifiedAgent] 📂 OPENCODE_LOG_DIR 本地化: ${mergedEnv.OPENCODE_LOG_DIR} → ${localLogDir}`);
      mergedEnv.OPENCODE_LOG_DIR = localLogDir;
    }

    // requestMcpServers 已在变更检测阶段过滤了旧桥接项 (command==='mcp-proxy')
    const mergedMcpServers = {
      ...(baseConfig.mcpServers || {}),
      ...requestMcpServers,
    };

    const newConfig: AgentConfig = {
      ...baseConfig,
      engine: requiredEngine,
      apiKey: mp?.api_key || baseConfig.apiKey,
      baseUrl: mp?.base_url || baseConfig.baseUrl,
      model,
      env: mergedEnv,
      mcpServers: Object.keys(mergedMcpServers).length > 0 ? mergedMcpServers : undefined,
    };

    log.info(
      `[UnifiedAgent] 📌 最终模型配置:\n` +
      `├─ engine: ${newConfig.engine}\n` +
      `├─ config.model: ${newConfig.model || '⚠️ 未设置'}\n` +
      `├─ env OPENCODE_MODEL: ${newConfig.env?.OPENCODE_MODEL || '(未设置)'}\n` +
      `├─ env ANTHROPIC_MODEL: ${newConfig.env?.ANTHROPIC_MODEL || '(未设置)'}\n` +
      `├─ baseUrl: ${newConfig.baseUrl || '(未设置)'}\n` +
      `├─ env OPENAI_BASE_URL: ${newConfig.env?.OPENAI_BASE_URL || '(未设置)'}\n` +
      `├─ apiKeySet: ${!!newConfig.apiKey}\n` +
      `├─ env OPENAI_API_KEY set: ${!!newConfig.env?.OPENAI_API_KEY}\n` +
      `└─ mcpServers: ${newConfig.mcpServers ? Object.keys(newConfig.mcpServers).join(', ') : '(none)'}`,
    );

    const ok = await this.init(newConfig);
    if (!ok) {
      throw new Error(`Failed to switch engine to ${requiredEngine}`);
    }
    log.info(`[UnifiedAgent] ✅ 引擎已切换到 ${requiredEngine}`);
    // 与 Tauri 一致：ACP context_servers 不写入本地 proxy，仅用于引擎 createSession 的 mcpServers
  }

  get isReady(): boolean {
    return this.engine?.isReady ?? false;
  }

  getAcpEngine(): AcpEngine | null {
    return this.engine instanceof AcpEngine ? this.engine : null;
  }

  // === Proxy methods (all delegated to AcpEngine) ===

  async listSessions(): Promise<SdkSession[]> {
    return this.engine!.listSessions();
  }

  async createSession(opts?: { parentID?: string; title?: string }): Promise<SdkSession> {
    return this.engine!.createSession(opts);
  }

  async getSession(id: string): Promise<SdkSession> {
    return this.engine!.getSession(id);
  }

  async deleteSession(id: string): Promise<boolean> {
    return this.engine!.deleteSession(id);
  }

  async abortSession(id: string): Promise<void> {
    await this.engine!.abortSession(id);
  }

  async prompt(
    sessionId: string,
    parts: Array<TextPartInput | FilePartInput>,
    opts?: PromptOptions,
  ): Promise<MessageWithParts> {
    return this.engine!.prompt(sessionId, parts as any, opts);
  }

  async promptAsync(
    sessionId: string,
    parts: Array<TextPartInput | FilePartInput>,
    opts?: PromptOptions,
  ): Promise<void> {
    return this.engine!.promptAsync(sessionId, parts as any, opts);
  }

  respondPermission(permissionId: string, response: 'once' | 'always' | 'reject'): void {
    // ACP engine's respondPermission is void, returns nothing
    this.engine!.respondPermission(permissionId, response);
  }

  // === ACP engine specific ===

  async claudePrompt(message: string): Promise<string> {
    const acpEngine = this.getAcpEngine();
    if (!acpEngine) throw new Error('ACP engine not active');
    return acpEngine.claudePrompt(message);
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
        this.emit(event, ...args);
      });
    }
  }
}

// ==================== Singleton & Export ====================

export const agentService = new UnifiedAgentService();

export default agentService;
