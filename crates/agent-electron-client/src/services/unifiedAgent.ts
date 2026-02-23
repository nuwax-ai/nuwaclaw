/**
 * Unified Agent Service
 *
 * Architecture:
 * - AcpEngine: ACP protocol (claude-code via claude-code-acp-ts, nuwaxcode via nuwaxcode acp)
 * - OpencodeEngine: HTTP/SSE API via @nuwax-ai/sdk (opencode only)
 * - UnifiedAgentService: Event bus + engine proxy
 */

import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import log from 'electron-log';
import type {
  TextPartInput,
  FilePartInput,
  FileDiff,
} from '@nuwax-ai/sdk';

// Re-export engine classes (extracted modules)
export { OpencodeEngine } from './opcodeEngine';
export { AcpEngine } from './acpEngine';
export { mapAgentCommand, resolveAgentEnv } from './agentHelpers';

// Re-export from engines for downstream compatibility
import { OpencodeEngine } from './opcodeEngine';
import { AcpEngine } from './acpEngine';
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
} from '../types/computerTypes';
import type { ComputerChatRequest, ModelProviderConfig } from '../types/computerTypes';

// ==================== Types ====================

export type AgentEngineType = 'opencode' | 'nuwaxcode' | 'claude-code';

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

// Re-export SDK types used by downstream
export type { UserMessage, AssistantMessage, TextPart, ReasoningPart, FilePart, ToolPart, StepStartPart, StepFinishPart, SnapshotPart, PatchPart, TextPartInput, FilePartInput, FileDiff } from '@nuwax-ai/sdk';
export type Message = import('@nuwax-ai/sdk').UserMessage | import('@nuwax-ai/sdk').AssistantMessage;
export type Part = import('@nuwax-ai/sdk').TextPart | import('@nuwax-ai/sdk').ReasoningPart | import('@nuwax-ai/sdk').FilePart | import('@nuwax-ai/sdk').ToolPart | import('@nuwax-ai/sdk').StepStartPart | import('@nuwax-ai/sdk').StepFinishPart | import('@nuwax-ai/sdk').SnapshotPart | import('@nuwax-ai/sdk').PatchPart;

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
  private engine: OpencodeEngine | AcpEngine | null = null;
  private engineType: AgentEngineType | null = null;
  private config: AgentConfig | null = null;

  async init(config: AgentConfig): Promise<boolean> {
    if (this.engine) {
      await this.destroy();
    }

    this.config = config;
    this.engineType = config.engine;

    if (config.engine === 'claude-code' || config.engine === 'nuwaxcode') {
      const engine = new AcpEngine(config.engine);
      this.engine = engine;
      this.forwardEvents(engine);
      return engine.init(config);
    }

    // opencode uses OpencodeEngine (HTTP/SSE)
    const engine = new OpencodeEngine();
    this.engine = engine;
    this.forwardEvents(engine);
    const ok = await engine.init(config);

    if (ok) {
      engine.startEventStream();
    }

    return ok;
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
    const currentMcpStr = this.config?.mcpServers
      ? JSON.stringify(this.config.mcpServers, Object.keys(this.config.mcpServers).sort())
      : '';
    const requestMcpServers: NonNullable<AgentConfig['mcpServers']> = {};
    if (request.agent_config?.context_servers) {
      for (const [name, srv] of Object.entries(request.agent_config.context_servers)) {
        if (srv.enabled === false || !srv.command) continue;
        requestMcpServers[name] = { command: srv.command, args: srv.args || [], env: srv.env };
      }
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
      const localLogDir = path.join(os.homedir(), '.nuwax-agent', 'logs');
      log.info(`[UnifiedAgent] 📂 OPENCODE_LOG_DIR 本地化: ${mergedEnv.OPENCODE_LOG_DIR} → ${localLogDir}`);
      mergedEnv.OPENCODE_LOG_DIR = localLogDir;
    }

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
  }

  get isReady(): boolean {
    return this.engine?.isReady ?? false;
  }

  getOpencodeEngine(): OpencodeEngine | null {
    return this.engine instanceof OpencodeEngine ? this.engine : null;
  }

  getAcpEngine(): AcpEngine | null {
    return this.engine instanceof AcpEngine ? this.engine : null;
  }

  // === Proxy methods ===

  async listSessions(): Promise<SdkSession[]> {
    if (this.engine instanceof AcpEngine) return this.engine.listSessions();
    return this.oc().listSessions();
  }

  async createSession(opts?: { parentID?: string; title?: string }): Promise<SdkSession> {
    if (this.engine instanceof AcpEngine) return this.engine.createSession(opts);
    return this.oc().createSession(opts);
  }

  async getSession(id: string): Promise<SdkSession> {
    if (this.engine instanceof AcpEngine) return this.engine.getSession(id);
    return this.oc().getSession(id);
  }

  async deleteSession(id: string): Promise<boolean> {
    if (this.engine instanceof AcpEngine) return this.engine.deleteSession(id);
    return this.oc().deleteSession(id);
  }

  async updateSession(id: string, title?: string): Promise<SdkSession> {
    return this.oc().updateSession(id, title);
  }

  async getSessionStatus(): Promise<SessionStatus> {
    return this.oc().getSessionStatus();
  }

  async forkSession(id: string, messageID?: string): Promise<SdkSession> {
    return this.oc().forkSession(id, messageID);
  }

  async abortSession(id: string): Promise<void> {
    if (this.engine instanceof AcpEngine) {
      return this.engine.abortSession(id);
    }
    return this.oc().abortSession(id);
  }

  async getMessages(sessionId: string, limit?: number): Promise<MessageWithParts[]> {
    return this.oc().getMessages(sessionId, limit);
  }

  async getMessage(sessionId: string, messageId: string): Promise<MessageWithParts> {
    return this.oc().getMessage(sessionId, messageId);
  }

  async prompt(
    sessionId: string,
    parts: Array<TextPartInput | FilePartInput>,
    opts?: PromptOptions,
  ): Promise<MessageWithParts> {
    if (this.engine instanceof AcpEngine) {
      return this.engine.prompt(sessionId, parts as any, opts);
    }
    return this.oc().prompt(sessionId, parts, opts);
  }

  async promptAsync(
    sessionId: string,
    parts: Array<TextPartInput | FilePartInput>,
    opts?: PromptOptions,
  ): Promise<void> {
    if (this.engine instanceof AcpEngine) {
      return this.engine.promptAsync(sessionId, parts as any, opts);
    }
    return this.oc().promptAsync(sessionId, parts, opts);
  }

  async command(sessionId: string, cmd: string, args?: string, opts?: CommandOptions): Promise<MessageWithParts> {
    return this.oc().command(sessionId, cmd, args, opts);
  }

  async shell(sessionId: string, cmd: string, agent?: string, model?: { providerID: string; modelID: string }): Promise<MessageWithParts> {
    return this.oc().shell(sessionId, cmd, agent, model);
  }

  async respondPermission(sessionId: string, permissionId: string, response: 'once' | 'always' | 'reject'): Promise<boolean> {
    if (this.engine instanceof AcpEngine) {
      this.engine.respondPermission(permissionId, response);
      return true;
    }
    return this.oc().respondPermission(sessionId, permissionId, response);
  }

  async revertSession(id: string, messageId: string, partId?: string): Promise<SdkSession> {
    return this.oc().revertSession(id, messageId, partId);
  }

  async unrevertSession(id: string): Promise<SdkSession> {
    return this.oc().unrevertSession(id);
  }

  async diffSession(id: string, messageId?: string): Promise<FileDiff[]> {
    return this.oc().diffSession(id, messageId);
  }

  async shareSession(id: string): Promise<SdkSession> {
    return this.oc().shareSession(id);
  }

  async unshareSession(id: string): Promise<SdkSession> {
    return this.oc().unshareSession(id);
  }

  async getSessionChildren(id: string): Promise<SdkSession[]> {
    return this.oc().getSessionChildren(id);
  }

  async listTools(provider?: string, model?: string): Promise<ToolInfo[]> {
    return this.oc().listTools(provider, model);
  }

  async getToolIds(): Promise<string[]> {
    return this.oc().getToolIds();
  }

  async findText(pattern: string): Promise<unknown[]> {
    return this.oc().findText(pattern);
  }

  async findFiles(query: string, dirs?: boolean): Promise<string[]> {
    return this.oc().findFiles(query, dirs);
  }

  async listFiles(dirPath: string): Promise<unknown[]> {
    return this.oc().listFiles(dirPath);
  }

  async readFile(filePath: string): Promise<unknown> {
    return this.oc().readFile(filePath);
  }

  async listProviders(): Promise<ProviderInfo[]> {
    return this.oc().listProviders();
  }

  async getConfig(): Promise<unknown> {
    return this.oc().getConfig();
  }

  async mcpStatus(): Promise<unknown> {
    return this.oc().mcpStatus();
  }

  async mcpConnect(name: string): Promise<void> {
    return this.oc().mcpConnect(name);
  }

  async mcpDisconnect(name: string): Promise<void> {
    return this.oc().mcpDisconnect(name);
  }

  async getConfigProviders(): Promise<unknown> {
    return this.oc().getConfigProviders();
  }

  async listAgents(): Promise<unknown[]> {
    return this.oc().listAgents();
  }

  async listCommands(): Promise<unknown[]> {
    return this.oc().listCommands();
  }

  // === ACP engine specific ===

  async claudePrompt(message: string): Promise<string> {
    const acpEngine = this.getAcpEngine();
    if (!acpEngine) throw new Error('ACP engine not active');
    return acpEngine.claudePrompt(message);
  }

  // === Helpers ===

  private oc(): OpencodeEngine {
    if (!(this.engine instanceof OpencodeEngine)) {
      throw new Error(`Operation requires opencode engine, current: ${this.engineType}`);
    }
    return this.engine;
  }

  private forwardEvents(engine: OpencodeEngine | AcpEngine): void {
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
