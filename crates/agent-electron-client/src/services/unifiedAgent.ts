/**
 * Unified Agent Service
 *
 * Architecture:
 * - AcpEngine: ACP protocol (claude-code via claude-code-acp-ts, nuwaxcode via nuwaxcode acp)
 * - OpencodeEngine: HTTP/SSE API via @nuwax-ai/sdk (opencode only)
 * - UnifiedAgentService: Event bus + engine proxy
 */

import { EventEmitter } from 'events';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import log from 'electron-log';
import type { ChildProcess } from 'child_process';
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
} from './acpClient';
import {
  createOpencode,
  createOpencodeClient,
  type OpencodeClient,
} from '@nuwax-ai/sdk';
import type {
  HttpResult,
  ComputerChatRequest,
  ComputerChatResponse,
  UnifiedSessionMessage,
  ModelProviderConfig,
} from '../types/computerTypes';
import type {
  UserMessage,
  AssistantMessage,
  TextPart,
  ReasoningPart,
  FilePart,
  ToolPart,
  StepStartPart,
  StepFinishPart,
  SnapshotPart,
  PatchPart,
  TextPartInput,
  FilePartInput,
  FileDiff,
} from '@nuwax-ai/sdk';

// ==================== Helpers ====================

/** Safe JSON.stringify that handles circular references */
function safeStringify(obj: unknown): string {
  try {
    return JSON.stringify(obj);
  } catch {
    return String(obj);
  }
}

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

export type Message = UserMessage | AssistantMessage;
export type Part = TextPart | ReasoningPart | FilePart | ToolPart | StepStartPart | StepFinishPart | SnapshotPart | PatchPart;

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

// ==================== OpencodeEngine ====================

export class OpencodeEngine extends EventEmitter {
  private client: OpencodeClient | null = null;
  private server: { url: string; close(): void } | null = null;
  private sseController: AbortController | null = null;
  private config: AgentConfig | null = null;
  private _ready = false;

  get isReady(): boolean {
    return this._ready && this.client !== null;
  }

  get serverUrl(): string | null {
    return this.server?.url ?? null;
  }

  // === Lifecycle ===

  async init(config: AgentConfig): Promise<boolean> {
    this.config = config;

    try {
      if (config.baseUrl) {
        log.info('[OpencodeEngine] Connecting to existing server:', config.baseUrl);
        this.client = createOpencodeClient({ baseUrl: config.baseUrl });
      } else {
        const port = config.port || 60096;
        const hostname = config.hostname || '127.0.0.1';
        log.info(`[OpencodeEngine] Starting server on ${hostname}:${port}...`);

        const opencodeConfig: Record<string, unknown> = {};
        if (config.model) {
          opencodeConfig.provider = { anthropic: { model: config.model } };
        }
        if (config.mcpServers) {
          opencodeConfig.mcp = { servers: config.mcpServers };
        }

        const result = await createOpencode({
          hostname,
          port,
          timeout: config.timeout || 15000,
          config: Object.keys(opencodeConfig).length > 0 ? opencodeConfig as any : undefined,
        });

        this.client = result.client;
        this.server = result.server;
      }

      this._ready = true;
      log.info('[OpencodeEngine] Initialized successfully');
      this.emit('ready');
      return true;
    } catch (error) {
      log.error('[OpencodeEngine] Init failed:', error);
      this.emit('error', error instanceof Error ? error : new Error(String(error)));
      return false;
    }
  }

  async destroy(): Promise<void> {
    this.stopEventStream();

    if (this.server) {
      try {
        this.server.close();
      } catch (e) {
        log.warn('[OpencodeEngine] Server close error:', e);
      }
      this.server = null;
    }

    this.client = null;
    this._ready = false;
    log.info('[OpencodeEngine] Destroyed');
    this.emit('destroyed');
  }

  // === SSE Event Stream ===

  startEventStream(): void {
    if (!this.client) {
      log.warn('[OpencodeEngine] Cannot start event stream: not initialized');
      return;
    }

    this.stopEventStream();
    this.sseController = new AbortController();
    const client = this.client;

    log.info('[OpencodeEngine] Starting SSE event stream...');

    client.event.subscribe({
      onSseEvent: (event: { data: unknown }) => {
        this.handleSseEvent(event.data);
      },
      onSseError: (error: unknown) => {
        log.error('[OpencodeEngine] SSE error:', error);
        this.emit('error', error instanceof Error ? error : new Error(String(error)));
      },
      sseMaxRetryAttempts: undefined,
      sseDefaultRetryDelay: 3000,
      sseMaxRetryDelay: 30000,
      signal: this.sseController.signal,
    } as any).catch((err: unknown) => {
      if (this.sseController?.signal.aborted) return;
      log.error('[OpencodeEngine] SSE subscribe error:', err);
    });
  }

  stopEventStream(): void {
    if (this.sseController) {
      this.sseController.abort();
      this.sseController = null;
      log.info('[OpencodeEngine] SSE event stream stopped');
    }
  }

  private static readonly SSE_EVENT_TYPES = [
    'message.updated', 'message.removed',
    'message.part.updated', 'message.part.removed',
    'permission.updated', 'permission.replied',
    'session.created', 'session.updated', 'session.deleted',
    'session.status', 'session.idle', 'session.error', 'session.diff',
    'file.edited', 'server.connected',
  ];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private handleSseEvent(data: any): void {
    if (!data || typeof data !== 'object') return;
    const type = data.type as string;
    if (!type) return;

    if (OpencodeEngine.SSE_EVENT_TYPES.includes(type)) {
      this.emit(type, data.properties);
    } else {
      log.debug('[OpencodeEngine] Unhandled SSE event:', type);
    }
  }

  // === Session Management ===

  async listSessions(): Promise<SdkSession[]> {
    const client = this.getClient();
    const result = await client.session.list();
    return (result as any)?.data ?? [];
  }

  async createSession(opts?: { parentID?: string; title?: string }): Promise<SdkSession> {
    const client = this.getClient();
    const result = await client.session.create({
      body: opts,
      query: this.dirQuery(),
    });
    return (result as any)?.data;
  }

  async getSession(id: string): Promise<SdkSession> {
    const client = this.getClient();
    const result = await client.session.get({
      path: { id },
      query: this.dirQuery(),
    });
    return (result as any)?.data;
  }

  async deleteSession(id: string): Promise<boolean> {
    const client = this.getClient();
    await client.session.delete({
      path: { id },
      query: this.dirQuery(),
    });
    return true;
  }

  async updateSession(id: string, title?: string): Promise<SdkSession> {
    const client = this.getClient();
    const result = await client.session.update({
      path: { id },
      body: { title },
      query: this.dirQuery(),
    });
    return (result as any)?.data;
  }

  async getSessionStatus(): Promise<SessionStatus> {
    const client = this.getClient();
    const result = await client.session.status({
      query: this.dirQuery(),
    });
    return (result as any)?.data ?? {};
  }

  async forkSession(id: string, messageID?: string): Promise<SdkSession> {
    const client = this.getClient();
    const result = await client.session.fork({
      path: { id },
      body: messageID ? { messageID } : undefined,
      query: this.dirQuery(),
    });
    return (result as any)?.data;
  }

  async abortSession(id: string): Promise<void> {
    const client = this.getClient();
    await client.session.abort({
      path: { id },
      query: this.dirQuery(),
    });
  }

  async getSessionChildren(id: string): Promise<SdkSession[]> {
    const client = this.getClient();
    const result = await client.session.children({
      path: { id },
      query: this.dirQuery(),
    });
    return (result as any)?.data ?? [];
  }

  // === Messages ===

  async getMessages(sessionId: string, limit?: number): Promise<MessageWithParts[]> {
    const client = this.getClient();
    const result = await client.session.messages({
      path: { id: sessionId },
      query: {
        ...this.dirQuery(),
        ...(limit ? { limit } : {}),
      },
    });
    return (result as any)?.data ?? [];
  }

  async getMessage(sessionId: string, messageId: string): Promise<MessageWithParts> {
    const client = this.getClient();
    const result = await client.session.message({
      path: { id: sessionId, messageID: messageId },
      query: this.dirQuery(),
    });
    return (result as any)?.data;
  }

  // === Prompt / Command / Shell ===

  async prompt(
    sessionId: string,
    parts: Array<TextPartInput | FilePartInput>,
    opts?: PromptOptions,
  ): Promise<MessageWithParts> {
    const client = this.getClient();
    const result = await client.session.prompt({
      path: { id: sessionId },
      body: {
        parts,
        model: opts?.model,
        agent: opts?.agent,
        noReply: opts?.noReply,
        system: opts?.system,
        tools: opts?.tools,
        messageID: opts?.messageID,
      },
      query: this.dirQuery(),
    });
    return (result as any)?.data;
  }

  async promptAsync(
    sessionId: string,
    parts: Array<TextPartInput | FilePartInput>,
    opts?: PromptOptions,
  ): Promise<void> {
    const client = this.getClient();
    await client.session.promptAsync({
      path: { id: sessionId },
      body: {
        parts,
        model: opts?.model,
        agent: opts?.agent,
        noReply: opts?.noReply,
        system: opts?.system,
        tools: opts?.tools,
        messageID: opts?.messageID,
      },
      query: this.dirQuery(),
    });
  }

  async command(
    sessionId: string,
    cmd: string,
    args: string = '',
    opts?: CommandOptions,
  ): Promise<MessageWithParts> {
    const client = this.getClient();
    const result = await client.session.command({
      path: { id: sessionId },
      body: {
        command: cmd,
        arguments: args,
        agent: opts?.agent,
        model: opts?.model,
        messageID: opts?.messageID,
      },
      query: this.dirQuery(),
    });
    return (result as any)?.data;
  }

  async shell(
    sessionId: string,
    cmd: string,
    agent: string = 'default',
    model?: { providerID: string; modelID: string },
  ): Promise<MessageWithParts> {
    const client = this.getClient();
    const result = await client.session.shell({
      path: { id: sessionId },
      body: { command: cmd, agent, model },
      query: this.dirQuery(),
    });
    return (result as any)?.data;
  }

  // === Permissions ===

  async respondPermission(
    sessionId: string,
    permissionId: string,
    response: 'once' | 'always' | 'reject',
  ): Promise<boolean> {
    const client = this.getClient();
    await client.postSessionIdPermissionsPermissionId({
      path: { id: sessionId, permissionID: permissionId },
      body: { response },
      query: this.dirQuery(),
    });
    return true;
  }

  // === Session Operations ===

  async revertSession(id: string, messageId: string, partId?: string): Promise<SdkSession> {
    const client = this.getClient();
    const result = await client.session.revert({
      path: { id },
      body: { messageID: messageId, partID: partId },
      query: this.dirQuery(),
    });
    return (result as any)?.data;
  }

  async unrevertSession(id: string): Promise<SdkSession> {
    const client = this.getClient();
    const result = await client.session.unrevert({
      path: { id },
      query: this.dirQuery(),
    });
    return (result as any)?.data;
  }

  async diffSession(id: string, messageId?: string): Promise<FileDiff[]> {
    const client = this.getClient();
    const result = await client.session.diff({
      path: { id },
      query: { ...this.dirQuery(), ...(messageId ? { messageID: messageId } : {}) },
    });
    return (result as any)?.data ?? [];
  }

  async shareSession(id: string): Promise<SdkSession> {
    const client = this.getClient();
    const result = await client.session.share({
      path: { id },
      query: this.dirQuery(),
    });
    return (result as any)?.data;
  }

  async unshareSession(id: string): Promise<SdkSession> {
    const client = this.getClient();
    const result = await client.session.unshare({
      path: { id },
      query: this.dirQuery(),
    });
    return (result as any)?.data;
  }

  // === Tools ===

  async listTools(provider?: string, model?: string): Promise<ToolInfo[]> {
    const client = this.getClient();
    if (provider && model) {
      const result = await client.tool.list({
        query: { provider, model },
      });
      return (result as any)?.data ?? [];
    }
    const result = await client.tool.ids({});
    const ids: string[] = (result as any)?.data ?? [];
    return ids.map((name) => ({ name }));
  }

  async getToolIds(): Promise<string[]> {
    const client = this.getClient();
    const result = await client.tool.ids({});
    return (result as any)?.data ?? [];
  }

  // === File Operations ===

  async findText(pattern: string): Promise<unknown[]> {
    const client = this.getClient();
    const result = await client.find.text({
      query: { pattern, ...this.dirQuery() },
    });
    return (result as any)?.data ?? [];
  }

  async findFiles(query: string, dirs?: boolean): Promise<string[]> {
    const client = this.getClient();
    const result = await client.find.files({
      query: {
        query,
        ...(dirs !== undefined ? { dirs: dirs ? 'true' as const : 'false' as const } : {}),
        ...this.dirQuery(),
      },
    });
    return (result as any)?.data ?? [];
  }

  async listFiles(dirPath: string): Promise<unknown[]> {
    const client = this.getClient();
    const result = await client.file.list({
      query: { path: dirPath, ...this.dirQuery() },
    });
    return (result as any)?.data ?? [];
  }

  async readFile(filePath: string): Promise<unknown> {
    const client = this.getClient();
    const result = await client.file.read({
      query: { path: filePath, ...this.dirQuery() },
    });
    return (result as any)?.data;
  }

  // === Provider & Config ===

  async listProviders(): Promise<ProviderInfo[]> {
    const client = this.getClient();
    const result = await client.provider.list();
    return (result as any)?.data ?? [];
  }

  async getConfig(): Promise<unknown> {
    const client = this.getClient();
    const result = await client.config.get();
    return (result as any)?.data;
  }

  async getConfigProviders(): Promise<unknown> {
    const client = this.getClient();
    const result = await client.config.providers();
    return (result as any)?.data;
  }

  // === MCP ===

  async mcpStatus(): Promise<unknown> {
    const client = this.getClient();
    const result = await client.mcp.status();
    return (result as any)?.data;
  }

  async mcpConnect(name: string): Promise<void> {
    const client = this.getClient();
    await client.mcp.connect({ path: { name } });
  }

  async mcpDisconnect(name: string): Promise<void> {
    const client = this.getClient();
    await client.mcp.disconnect({ path: { name } });
  }

  // === Agents ===

  async listAgents(): Promise<unknown[]> {
    const client = this.getClient();
    const result = await client.app.agents();
    return (result as any)?.data ?? [];
  }

  // === Commands ===

  async listCommands(): Promise<unknown[]> {
    const client = this.getClient();
    const result = await client.command.list();
    return (result as any)?.data ?? [];
  }

  // === Internal ===

  private getClient(): OpencodeClient {
    if (!this.client) {
      throw new Error('OpencodeEngine not initialized. Call init() first.');
    }
    return this.client;
  }

  private dirQuery(): { directory: string } | undefined {
    return this.config?.workspaceDir ? { directory: this.config.workspaceDir } : undefined;
  }
}

// ==================== rcoder-compatible types ====================

export type AcpSessionStatus = 'idle' | 'pending' | 'active' | 'terminating';

// Computer API types — re-export from shared types
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

// ==================== AcpEngine ====================

interface AcpSession {
  id: string;
  title?: string;
  acpSessionId?: string;
  createdAt: number;
  status: AcpSessionStatus;
  projectId?: string;
  lastActivity?: number;
}

let _acpSessionCounter = 0;

/**
 * ACP-based engine for claude-code and nuwaxcode.
 *
 * Both engines communicate via the Agent Client Protocol (NDJSON over stdin/stdout).
 * The only difference is the binary spawned:
 * - claude-code → claude-code-acp-ts
 * - nuwaxcode   → nuwaxcode acp
 */
export class AcpEngine extends EventEmitter {
  private config: AgentConfig | null = null;
  private _ready = false;
  private acpConnection: AcpClientSideConnection | null = null;
  private acpProcess: ChildProcess | null = null;
  private isolatedHome: string | null = null;
  private sessions = new Map<string, AcpSession>();
  private pendingPermissions = new Map<string, {
    resolve: (r: AcpPermissionResponse) => void;
    options: AcpPermissionOption[];
  }>();
  private activePromptSessions = new Set<string>();
  private activePromptRejects = new Map<string, (reason: Error) => void>();
  private logTag: string;

  constructor(private readonly engineName: 'claude-code' | 'nuwaxcode' = 'claude-code') {
    super();
    this.logTag = `[AcpEngine:${engineName}]`;
  }

  get isReady(): boolean {
    return this._ready && this.acpConnection !== null;
  }

  getActivePromptCount(): number {
    return this.activePromptSessions.size;
  }

  // === Lifecycle ===

  async init(config: AgentConfig): Promise<boolean> {
    this.config = config;
    const envModel = config.env?.OPENCODE_MODEL || config.env?.ANTHROPIC_MODEL;
    log.info(
      `${this.logTag} 🚀 初始化配置:\n` +
      `├─ engine: ${this.engineName}\n` +
      `├─ config.model: ${config.model || '⚠️ 未设置'}\n` +
      `├─ env model: ${envModel || '(未设置)'}\n` +
      `├─ baseUrl: ${config.baseUrl || '(default)'}\n` +
      `├─ apiKeySet: ${!!config.apiKey}\n` +
      `├─ workspaceDir: ${config.workspaceDir}\n` +
      `├─ env keys: ${config.env ? Object.keys(config.env).join(', ') : '(none)'}\n` +
      `└─ mcpServers: ${config.mcpServers ? Object.keys(config.mcpServers).join(', ') : '(none)'}`,
    );
    try {
      // Build ACP client handler (callbacks from agent → client)
      const clientHandler = this.buildClientHandler();

      // Resolve binary path and args for the engine type
      const { binPath, binArgs } = resolveAcpBinary(this.engineName);

      // For nuwaxcode: inject config via OPENCODE_CONFIG_CONTENT env var
      // nuwaxcode doesn't process mcpServers from ACP newSession (unlike claude-code),
      // so we pass MCP config at spawn time via its highest-priority config override.
      // Also set all permissions to "allow" to avoid unnecessary ACP permission round-trips;
      // claude-code handles permissions via ACP requestPermission callback instead.
      const spawnEnv = { ...(config.env || {}) };
      if (this.engineName === 'nuwaxcode') {
        const configObj: Record<string, unknown> = {};

        // 1. MCP servers injection
        if (config.mcpServers && Object.keys(config.mcpServers).length > 0) {
          const mcpConfig: Record<string, unknown> = {};
          for (const [name, srv] of Object.entries(config.mcpServers)) {
            mcpConfig[name] = {
              type: 'local',
              command: [srv.command, ...(srv.args || [])],
              environment: srv.env || {},
              enabled: true,
            };
          }
          configObj.mcp = mcpConfig;
        }

        // 2. Permission bypass — avoid nuwaxcode sending ACP permission requests
        configObj.permission = {
          edit: 'allow',
          bash: 'allow',
          webfetch: 'allow',
          doom_loop: 'allow',
          external_directory: 'allow',
        };

        const configContent = JSON.stringify(configObj);
        spawnEnv.OPENCODE_CONFIG_CONTENT = configContent;
        log.info(
          `${this.logTag} 🔌 nuwaxcode config 注入 (OPENCODE_CONFIG_CONTENT):\n` +
          `├─ mcp servers: ${configObj.mcp ? Object.keys(configObj.mcp as Record<string, unknown>).join(', ') : '(none)'}\n` +
          `├─ permission: all allow\n` +
          `└─ content: ${configContent}`,
        );
      }

      // Spawn ACP binary and create ClientSideConnection
      const { connection, process: proc, isolatedHome } = await createAcpConnection(
        {
          binPath,
          binArgs,
          workspaceDir: config.workspaceDir,
          apiKey: config.apiKey,
          baseUrl: config.baseUrl,
          model: config.model,
          env: spawnEnv,
        },
        clientHandler,
      );

      this.acpConnection = connection;
      this.acpProcess = proc;
      this.isolatedHome = isolatedHome;

      // Handle process exit
      proc.on('exit', (code, signal) => {
        log.info(`${this.logTag} ACP process exited`, { code, signal });
        if (this._ready) {
          this._ready = false;
          this.acpConnection = null;
          this.acpProcess = null;

          // Reject all active prompts so they don't hang
          for (const [, reject] of this.activePromptRejects) {
            reject(new Error(`ACP process exited unexpectedly (code=${code})`));
          }
          this.activePromptRejects.clear();

          this.emit('error', new Error(`ACP process exited unexpectedly (code=${code})`));
        }
      });

      // Initialize ACP protocol handshake
      // Note: Do NOT declare fs capabilities (readTextFile/writeTextFile).
      // Aligned with rcoder: let the agent handle file operations directly
      // via its own built-in tools, avoiding client-side fs callback issues.
      const acp = await loadAcpSdk();
      const initResult = await connection.initialize({
        protocolVersion: acp.PROTOCOL_VERSION,
        clientCapabilities: {},
      });

      log.info(`${this.logTag} ACP initialized`, {
        protocolVersion: initResult.protocolVersion,
      });

      this._ready = true;
      this.emit('ready');
      return true;
    } catch (error) {
      log.error(`${this.logTag} Init failed:`, error);
      this.emit('error', error instanceof Error ? error : new Error(String(error)));
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
      pending.resolve({ outcome: { outcome: 'cancelled' } });
      this.pendingPermissions.delete(id);
    }

    // Reject all active prompts
    for (const [sessionId, reject] of this.activePromptRejects) {
      reject(new Error('AcpEngine destroyed'));
      this.activePromptRejects.delete(sessionId);
    }

    // Kill ACP process
    if (this.acpProcess) {
      try {
        this.acpProcess.kill();
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
    this.emit('destroyed');
  }

  // === Session Management ===

  async createSession(opts?: {
    title?: string;
    cwd?: string;
    mcpServers?: Record<string, { command: string; args?: string[]; env?: Record<string, string> }>;
  }): Promise<SdkSession> {
    if (!this.acpConnection || !this.config) {
      throw new Error('AcpEngine not initialized');
    }

    const localId = `acp-${++_acpSessionCounter}-${Date.now()}`;

    // Build mcpServers array for ACP (McpServerStdio format)
    // ACP schema requires env as Array<{name, value}>, not Record<string, string>
    const mcpServers: AcpMcpServer[] = [];

    const toAcpMcpServer = (
      name: string,
      srv: { command: string; args?: string[]; env?: Record<string, string> },
    ): AcpMcpServer => {
      const envVars: AcpEnvVariable[] = [];
      if (srv.env) {
        for (const [k, v] of Object.entries(srv.env)) {
          envVars.push({ name: k, value: v });
        }
      }
      return { name, command: srv.command, args: srv.args || [], env: envVars };
    };

    // 1. Global MCP servers from config
    if (this.config.mcpServers) {
      for (const [name, srv] of Object.entries(this.config.mcpServers)) {
        mcpServers.push(toAcpMcpServer(name, srv));
      }
    }

    // 2. Per-request MCP servers (from agent_config.context_servers)
    if (opts?.mcpServers) {
      for (const [name, srv] of Object.entries(opts.mcpServers)) {
        // Skip if already added from global config
        if (mcpServers.some((m) => m.name === name)) continue;
        mcpServers.push(toAcpMcpServer(name, srv));
      }
    }

    // Create ACP session
    // Note: systemPrompt/permissionMode/model are NOT part of ACP NewSessionRequest schema;
    // they are passed via env vars (ANTHROPIC_MODEL) or process-level config.
    // cwd: use per-project directory if provided, otherwise fall back to global workspaceDir
    const sessionCwd = opts?.cwd || this.config.workspaceDir;
    const newSessionParams = {
      cwd: sessionCwd,
      mcpServers,
    };
    log.info(`${this.logTag} newSession params:`, JSON.stringify(newSessionParams, null, 2));
    const acpResult = await this.acpConnection.newSession(newSessionParams);

    const session: AcpSession = {
      id: localId,
      title: opts?.title,
      acpSessionId: acpResult.sessionId,
      createdAt: Date.now(),
      status: 'idle',
      lastActivity: Date.now(),
    };
    this.sessions.set(localId, session);

    log.info(`${this.logTag} Session created`, {
      localId,
      acpSessionId: acpResult.sessionId,
    });

    return {
      id: localId,
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

  async getSession(id: string): Promise<SdkSession> {
    const s = this.sessions.get(id);
    if (!s) throw new Error(`Session not found: ${id}`);
    return { id: s.id, title: s.title, time: { created: s.createdAt } };
  }

  async deleteSession(id: string): Promise<boolean> {
    return this.sessions.delete(id);
  }

  async abortSession(id?: string): Promise<void> {
    if (!this.acpConnection) return;

    const ABORT_TIMEOUT = 30_000;

    const cancelWithTimeout = async (acpSessionId: string): Promise<void> => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          this.acpConnection!.cancel({ sessionId: acpSessionId }),
          new Promise<void>((_, reject) => {
            timer = setTimeout(() => reject(new Error('Abort timeout')), ABORT_TIMEOUT);
          }),
        ]);
      } finally {
        if (timer !== undefined) clearTimeout(timer);
      }
    };

    if (id) {
      const session = this.sessions.get(id);
      if (session?.acpSessionId) {
        session.status = 'terminating';
        try {
          await cancelWithTimeout(session.acpSessionId);
        } catch (e) {
          log.warn(`${this.logTag} Cancel error/timeout:`, e);
        }
        this.activePromptSessions.delete(id);
        session.status = 'idle';
        session.lastActivity = Date.now();
      }
    } else {
      // Cancel all active sessions
      for (const [sessionId, session] of this.sessions) {
        if (session.acpSessionId && this.activePromptSessions.has(sessionId)) {
          session.status = 'terminating';
          try {
            await cancelWithTimeout(session.acpSessionId);
          } catch (e) {
            log.warn(`${this.logTag} Cancel error/timeout:`, e);
          }
          session.status = 'idle';
          session.lastActivity = Date.now();
        }
      }
      this.activePromptSessions.clear();
    }
  }

  // === Prompt (Core) ===

  async prompt(
    sessionId: string,
    parts: Array<{ type: string; text?: string; [key: string]: unknown }>,
    _opts?: PromptOptions,
  ): Promise<MessageWithParts> {
    if (!this.acpConnection || !this.config) {
      throw new Error('AcpEngine not initialized');
    }

    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session not found: ${sessionId}`);
    if (!session.acpSessionId) throw new Error(`Session has no ACP session: ${sessionId}`);

    // Build prompt content
    const promptContent: Array<{ type: string; text?: string; uri?: string; mimeType?: string }> = [];
    for (const part of parts) {
      if (part.type === 'text' && part.text) {
        promptContent.push({ type: 'text', text: part.text });
      }
    }

    if (promptContent.length === 0) throw new Error('Empty prompt');

    this.activePromptSessions.add(sessionId);
    session.status = 'active';
    session.lastActivity = Date.now();

    // Emit rcoder-compatible prompt start event
    this.emit('computer:promptStart', {
      sessionId,
      acpSessionId: session.acpSessionId,
      requestId: _opts?.messageID,
    });

    let resultText = '';
    try {
      log.info(`${this.logTag} Starting prompt`, {
        sessionId,
        acpSessionId: session.acpSessionId,
      });

      // ACP prompt() blocks until completion; events come via sessionUpdate callback
      const result = await new Promise<{ stopReason: string }>((resolve, reject) => {
        // Register reject handler so process exit can abort the prompt
        this.activePromptRejects.set(sessionId, reject);

        this.acpConnection!.prompt({
          sessionId: session.acpSessionId!,
          prompt: promptContent,
        }).then(resolve, reject);
      });

      log.info(`${this.logTag} Prompt completed`, {
        sessionId,
        stopReason: result.stopReason,
      });

      // Emit rcoder-compatible prompt end event
      this.emit('computer:promptEnd', {
        sessionId,
        acpSessionId: session.acpSessionId,
        reason: result.stopReason,
        description: `Prompt completed: ${result.stopReason}`,
      });

      // Emit session idle
      this.emit('session.idle', { sessionId });
    } catch (error) {
      log.error(`${this.logTag} Prompt failed:`, error);

      // Emit rcoder-compatible prompt end event (error)
      const errMsg = error instanceof Error
        ? error.message
        : (typeof error === 'object' && error !== null ? safeStringify(error) : String(error));
      this.emit('computer:promptEnd', {
        sessionId,
        acpSessionId: session.acpSessionId,
        reason: 'error',
        description: errMsg,
      });

      this.emit('session.error', {
        sessionId,
        error: errMsg,
      });
    } finally {
      this.activePromptSessions.delete(sessionId);
      this.activePromptRejects.delete(sessionId);
      session.status = 'idle';
      session.lastActivity = Date.now();
    }

    return {
      info: { role: 'assistant', content: [{ type: 'text', text: resultText }] } as unknown as AssistantMessage,
      parts: [{ type: 'text', text: resultText } as unknown as TextPart],
    };
  }

  async promptAsync(
    sessionId: string,
    parts: Array<{ type: string; text?: string; [key: string]: unknown }>,
    opts?: PromptOptions,
  ): Promise<void> {
    // Fire and forget — errors emitted as events
    this.prompt(sessionId, parts, opts).catch((error) => {
      log.error(`${this.logTag} promptAsync error:`, error);
    });
  }

  // === Permission Response ===

  respondPermission(permissionId: string, response: 'once' | 'always' | 'reject'): void {
    const pending = this.pendingPermissions.get(permissionId);
    if (!pending) {
      log.warn(`${this.logTag} No pending permission for:`, permissionId);
      return;
    }

    if (response === 'reject') {
      pending.resolve({ outcome: { outcome: 'cancelled' } });
    } else {
      // Map response to ACP PermissionOptionKind
      const targetKind = response === 'always' ? 'allow_always' : 'allow_once';
      const optionId = pending.options.find((o) => o.kind === targetKind)?.optionId
        ?? pending.options[0]?.optionId;
      if (!optionId) {
        log.warn(`${this.logTag} No valid option for permission response, cancelling`);
        pending.resolve({ outcome: { outcome: 'cancelled' } });
      } else {
        pending.resolve({
          outcome: { outcome: 'selected', optionId },
        });
      }
    }
  }

  // === Legacy compat ===

  async claudePrompt(message: string): Promise<string> {
    const session = await this.createSession({ title: 'temp' });
    try {
      const result = await this.prompt(session.id, [{ type: 'text', text: message }]);
      const text = result.parts
        .filter((p) => (p as any).type === 'text')
        .map((p) => (p as any).text || '')
        .join('');
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
      if (session.projectId === projectId) {
        return session;
      }
    }
    return null;
  }

  /**
   * Check if model_provider from chat request requires re-initializing the ACP connection.
   * Aligned with rcoder: each chat request can carry its own ModelProviderConfig.
   * rcoder spawns a new process per request; Electron reuses one process,
   * so we reinit when api_key, base_url, or model actually changed.
   */
  private shouldReinitForModelProvider(mp: ModelProviderConfig): boolean {
    if (!this.config) return false;

    const apiKey = mp.api_key || '';
    const baseUrl = mp.base_url || '';
    const model = mp.model || '';

    // Skip reinit if all fields are empty (no meaningful config)
    if (!apiKey && !baseUrl && !model) return false;

    // Compare with current config — reinit only if something actually changed
    // 模型比较：config.model 已包含从 env 提取的模型（由 ensureEngineForRequest 设置）
    const currentKey = this.config.apiKey || '';
    const currentUrl = this.config.baseUrl || '';
    const currentModel = this.config.model || '';

    return (!!apiKey && apiKey !== currentKey) ||
           (!!baseUrl && baseUrl !== currentUrl) ||
           (!!model && model !== currentModel);
  }

  async chat(request: ComputerChatRequest): Promise<HttpResult<ComputerChatResponse>> {
    if (!this.acpConnection || !this.config) {
      return { code: '5000', message: 'Agent not initialized', data: null, tid: null, success: false };
    }

    try {
      // 打印请求信息和当前引擎的模型配置
      const envModel = this.config.env?.OPENCODE_MODEL || this.config.env?.ANTHROPIC_MODEL;
      log.info(
        `${this.logTag} 📨 chat() 收到请求:\n` +
        `├─ user_id: ${request.user_id}\n` +
        `├─ project_id: ${request.project_id}\n` +
        `├─ session_id: ${request.session_id}\n` +
        `├─ request_id: ${request.request_id}\n` +
        `├─ agent_config: ${safeStringify(request.agent_config)}\n` +
        `├─ model_provider: ${request.model_provider ? `provider=${request.model_provider.provider}, model=${request.model_provider.model}, base_url_set=${!!request.model_provider.base_url}, api_key_len=${request.model_provider.api_key?.length || 0}` : '(无)'}\n` +
        `├─ 📌 config.model: ${this.config.model || '⚠️ 未设置'}\n` +
        `├─ 📌 env model: ${envModel || '(未设置)'}\n` +
        `├─ baseUrl_set: ${!!this.config.baseUrl}\n` +
        `├─ apiKeySet: ${!!this.config.apiKey}\n` +
        `├─ env keys: ${this.config.env ? Object.keys(this.config.env).join(', ') : '(none)'}\n` +
        `└─ prompt (${request.prompt.length}字符)`,
      );

      // model_provider 处理（兜底路径）
      // 正常流程由 computerServer → ensureEngineForRequest 统一处理引擎/模型/apiKey/baseUrl 变更。
      // 此处是兜底：应对直接调用 chat()（如 IPC agent:prompt）而未经 computerServer 的场景。
      if (request.model_provider && this.shouldReinitForModelProvider(request.model_provider)) {
        if (this.activePromptSessions.size > 0) {
          log.warn(`${this.logTag} ⚠️ model_provider 变更但有 ${this.activePromptSessions.size} 个活跃 prompt，跳过 reinit，使用当前配置`);
        } else {
          log.info(`${this.logTag} 🔄 model_provider 变更，重新初始化 ACP 连接...`);
          const newConfig: AgentConfig = {
            ...this.config,
            apiKey: request.model_provider.api_key || this.config.apiKey,
            baseUrl: request.model_provider.base_url || this.config.baseUrl,
            model: request.model_provider.model || this.config.model,
          };
          await this.destroy();
          const ok = await this.init(newConfig);
          if (!ok) {
            return { code: '5000', message: 'Failed to reinit with new model_provider', data: null, tid: null, success: false };
          }
        }
      }

      // 1. Find existing session by session_id or project_id, or create new
      let session: AcpSession | undefined;

      if (request.session_id) {
        session = this.sessions.get(request.session_id);
      }
      if (!session && request.project_id) {
        session = this.findSessionByProjectId(request.project_id) ?? undefined;
      }

      if (!session) {
        // Build per-project workspace directory (aligned with rcoder):
        //   {workspaceDir}/computer-project-workspace/{user_id}/{project_id}/
        // Directory is pre-created by fileServer.createWorkspace() before chat is called.
        const projectId = request.project_id || `proj-${Date.now()}`;
        const projectDir = path.join(
          this.config.workspaceDir,
          'computer-project-workspace',
          request.user_id,
          projectId,
        );
        log.info(`${this.logTag} 📁 项目工作目录: ${projectDir}`);

        // Extract MCP servers from agent_config.context_servers (aligned with rcoder)
        let requestMcpServers: Record<string, { command: string; args?: string[]; env?: Record<string, string> }> | undefined;
        if (request.agent_config?.context_servers) {
          requestMcpServers = {};
          for (const [name, srv] of Object.entries(request.agent_config.context_servers)) {
            if (srv.enabled === false || !srv.command) continue;
            requestMcpServers[name] = {
              command: srv.command,
              args: srv.args,
              env: srv.env,
            };
          }
          log.info(`${this.logTag} 🔌 请求级 MCP 服务器: ${Object.keys(requestMcpServers).join(', ') || '无'}`);
        }

        // mcpServers: passed via ACP newSession for claude-code;
        // for nuwaxcode, MCP is pre-injected via OPENCODE_CONFIG_CONTENT in init()
        const newSession = await this.createSession({
          title: projectId,
          cwd: projectDir,
          mcpServers: requestMcpServers,
        });
        session = this.sessions.get(newSession.id)!;
        session.projectId = request.project_id;
      }

      // 2. Async prompt (results via computer:progress events)
      this.promptAsync(session.id, [{ type: 'text', text: request.prompt }]);

      // 3. Return HttpResult<ChatResponse>
      const chatResponse: ComputerChatResponse = {
        project_id: request.project_id || session.id,
        session_id: session.id,
        error: null,
        request_id: request.request_id,
      };

      log.info(`${this.logTag} ✅ chat() 响应: session_id=${session.id}`);

      return {
        code: '0000',
        message: '成功',
        data: chatResponse,
        tid: null,
        success: true,
      };
    } catch (error) {
      const errorMsg = error instanceof Error
        ? error.message
        : (typeof error === 'object' && error !== null ? safeStringify(error) : String(error));
      log.error(`${this.logTag} ❌ chat() 失败: ${errorMsg}`);
      return {
        code: '5000',
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
      // ACP agent sends session update notifications
      sessionUpdate: async (params: {
        sessionId: string;
        update: AcpSessionUpdate;
      }): Promise<void> => {
        this.handleAcpSessionUpdate(params.sessionId, params.update);
      },

      // ACP agent requests permission
      requestPermission: async (params: AcpPermissionRequest): Promise<AcpPermissionResponse> => {
        return this.handlePermissionRequest(params);
      },
    };
  }

  // === Internal: ACP → SSE Event Mapping ===

  /**
   * Map ACP sessionUpdate to OpencodeEngine-compatible SSE events.
   * This ensures the renderer receives the same event format regardless of engine.
   */
  private handleAcpSessionUpdate(acpSessionId: string, update: AcpSessionUpdate): void {
    // Find local session ID from ACP session ID
    const sessionId = this.findLocalSessionId(acpSessionId);
    if (!sessionId) {
      log.warn(`${this.logTag} Unknown ACP session:`, acpSessionId);
      return;
    }

    // Update lastActivity
    const session = this.findSessionByAcpId(acpSessionId);
    if (session) session.lastActivity = Date.now();

    // Emit rcoder-compatible computer:progress event for all updates
    // 字段名使用 camelCase 对齐 rcoder #[serde(rename_all = "camelCase")]
    this.emit('computer:progress', {
      sessionId: sessionId,
      messageType: 'agentSessionUpdate',
      subType: update.sessionUpdate,
      data: update,
      timestamp: new Date().toISOString(),
    } satisfies UnifiedSessionMessage);

    switch (update.sessionUpdate) {
      case 'agent_message_chunk': {
        // Text streaming → message.part.updated
        const u = update as AcpAgentMessageChunk;
        this.emit('message.part.updated', {
          sessionId,
          type: 'text',
          text: u.content?.text || '',
        });
        break;
      }

      case 'agent_thought_chunk': {
        // Reasoning/thinking → message.part.updated
        const u = update as AcpAgentThoughtChunk;
        this.emit('message.part.updated', {
          sessionId,
          type: 'reasoning',
          thinking: u.content?.text || '',
        });
        break;
      }

      case 'tool_call': {
        // Tool invocation → message.part.updated
        const u = update as AcpToolCall;
        this.emit('message.part.updated', {
          sessionId,
          type: 'tool',
          toolCallId: u.toolCallId,
          name: u.title,
          kind: u.kind,
          status: u.status,
          input: u.rawInput,
          content: u.content,
        });
        break;
      }

      case 'tool_call_update': {
        // Tool status update → message.part.updated
        const u = update as AcpToolCallUpdate;
        this.emit('message.part.updated', {
          sessionId,
          type: 'tool',
          toolCallId: u.toolCallId,
          status: u.status,
          output: u.rawOutput,
          content: u.content,
        });
        break;
      }

      case 'session_info_update': {
        // Session title/info → session.updated
        const u = update as AcpSessionInfoUpdate;
        const session = this.findSessionByAcpId(acpSessionId);
        if (session && u.title) {
          session.title = u.title;
        }
        this.emit('session.updated', {
          sessionId,
          title: u.title,
        });
        break;
      }

      case 'usage_update': {
        // Usage stats — log only
        log.debug(`${this.logTag} Usage update:`, update);
        break;
      }

      default: {
        log.debug(`${this.logTag} Unhandled ACP update:`, update.sessionUpdate);
      }
    }
  }

  // === Internal: Permission Handling ===

  private async handlePermissionRequest(params: AcpPermissionRequest): Promise<AcpPermissionResponse> {
    const acpSessionId = params.sessionId;
    const sessionId = this.findLocalSessionId(acpSessionId);
    if (!sessionId) {
      return { outcome: { outcome: 'cancelled' } };
    }

    // Auto-allow all permissions (aligned with rcoder handle_permission_request):
    // Priority: allow_always > allow_once > first non-reject option
    const selected =
      params.options.find((o) => o.kind === 'allow_always') ||
      params.options.find((o) => o.kind === 'allow_once') ||
      params.options[0];

    if (selected) {
      log.info(`${this.logTag} 🔓 权限自动放行: tool=${params.toolCall.title}, kind=${selected.kind}, optionId=${selected.optionId}`);
      return {
        outcome: { outcome: 'selected', optionId: selected.optionId },
      };
    }

    // No options available — cancel
    log.warn(`${this.logTag} ⚠️ 权限请求无可选项,取消: tool=${params.toolCall.title}`);
    return { outcome: { outcome: 'cancelled' } };
  }

  // === Internal: Session Lookup Helpers ===

  private findLocalSessionId(acpSessionId: string): string | null {
    for (const [localId, session] of this.sessions) {
      if (session.acpSessionId === acpSessionId) {
        return localId;
      }
    }
    return null;
  }

  private findSessionByAcpId(acpSessionId: string): AcpSession | null {
    for (const [, session] of this.sessions) {
      if (session.acpSessionId === acpSessionId) {
        return session;
      }
    }
    return null;
  }
}

// ==================== Agent Config Helpers ====================

/** Map agent_config.agent_server.command to engine type */
function mapAgentCommand(command: string): AgentEngineType | null {
  if (command === 'nuwaxcode') return 'nuwaxcode';
  if (command === 'claude-code' || command === 'claude-code-acp-ts') return 'claude-code';
  return null;
}

/**
 * Resolve template placeholders in agent_server.env using model_provider.
 * rcoder does this internally in handle_chat_core; Electron needs to do it here.
 *
 * Templates: {MODEL_PROVIDER_BASE_URL}, {MODEL_PROVIDER_API_KEY}, {MODEL_PROVIDER_MODEL}
 */
function resolveAgentEnv(
  env: Record<string, string>,
  modelProvider?: ModelProviderConfig,
): Record<string, string> {
  const resolved: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    let v = value;
    if (modelProvider) {
      v = v.replace(/\{MODEL_PROVIDER_BASE_URL\}/g, modelProvider.base_url || '');
      v = v.replace(/\{MODEL_PROVIDER_API_KEY\}/g, modelProvider.api_key || '');
      v = v.replace(/\{MODEL_PROVIDER_MODEL\}/g, modelProvider.model || '');
    }
    // Skip entries with unresolved placeholders (missing model_provider fields)
    if (/\{MODEL_PROVIDER_\w+\}/.test(v)) {
      log.warn(`[resolveAgentEnv] ⚠️ 跳过未解析的模板变量: ${key}=${v}`);
      continue;
    }
    resolved[key] = v;
  }
  return resolved;
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
   *
   * Handles:
   * 1. Engine switching (claude-code ↔ nuwaxcode) based on agent_config.agent_server.command
   * 2. Template variable resolution ({MODEL_PROVIDER_*}) in agent_server.env
   * 3. Env update when model_provider changes
   *
   * Aligned with rcoder: rcoder spawns a new process per request with resolved config;
   * Electron reuses one process, so we reinit when engine/env actually changed.
   */
  async ensureEngineForRequest(request: ComputerChatRequest): Promise<void> {
    const agentServer = request.agent_config?.agent_server;
    const mp = request.model_provider;

    // 无 agent_config 且无 model_provider → 不需要任何切换
    if (!agentServer?.command && !mp) return;

    // 1. 确定目标引擎
    const requiredEngine = agentServer?.command
      ? mapAgentCommand(agentServer.command)
      : this.engineType; // 无 agent_config 时保持当前引擎
    if (!requiredEngine) {
      log.warn(`[UnifiedAgent] 未知的 agent command: ${agentServer?.command}，跳过引擎切换`);
      return;
    }

    // 2. 解析 agent_server.env 模板变量
    const resolvedEnv = agentServer?.env
      ? resolveAgentEnv(agentServer.env, mp)
      : undefined;

    // 3. 提取最终模型（模型优先级：model_provider.model > env 模型变量 > 已有 config.model）
    let model = mp?.model;
    if (!model && resolvedEnv) {
      model = resolvedEnv.OPENCODE_MODEL || resolvedEnv.ANTHROPIC_MODEL;
    }
    model = model || this.config?.model;

    // 4. 判断是否需要 reinit
    const needsSwitch = requiredEngine !== this.engineType;

    // 比较 env：JSON.stringify 第二个参数为 replacer 数组，按排序后的 key 列表序列化，确保 key 顺序无关
    const currentEnvStr = this.config?.env ? JSON.stringify(this.config.env, Object.keys(this.config.env).sort()) : '';
    const newEnvStr = resolvedEnv ? JSON.stringify(resolvedEnv, Object.keys(resolvedEnv).sort()) : '';
    const envChanged = !!resolvedEnv && newEnvStr !== currentEnvStr;

    // model_provider 的 apiKey/baseUrl/model 是否与当前 config 不同
    const modelChanged = !!model && model !== (this.config?.model || '');
    const apiKeyChanged = !!mp?.api_key && mp.api_key !== (this.config?.apiKey || '');
    const baseUrlChanged = !!mp?.base_url && mp.base_url !== (this.config?.baseUrl || '');

    // MCP servers 变更检测（nuwaxcode 需要重启进程才能加载新 MCP 配置）
    const currentMcpStr = this.config?.mcpServers
      ? JSON.stringify(this.config.mcpServers, Object.keys(this.config.mcpServers).sort())
      : '';
    // 提取请求级 MCP 服务器 (agent_config.context_servers)
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

    // OPENCODE_LOG_DIR 容器路径本地化：/app/container-logs → ~/.nuwax-agent/logs/
    if (mergedEnv.OPENCODE_LOG_DIR && !fs.existsSync(mergedEnv.OPENCODE_LOG_DIR)) {
      const localLogDir = path.join(os.homedir(), '.nuwax-agent', 'logs');
      log.info(`[UnifiedAgent] 📂 OPENCODE_LOG_DIR 本地化: ${mergedEnv.OPENCODE_LOG_DIR} → ${localLogDir}`);
      mergedEnv.OPENCODE_LOG_DIR = localLogDir;
    }

    // 合并全局 + 请求级 MCP（请求级优先，requestMcpServers 已在变更检测时提取）
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

    // 打印最终构建的模型配置
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
