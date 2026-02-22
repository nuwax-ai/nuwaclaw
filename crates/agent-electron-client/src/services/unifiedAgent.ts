/**
 * Unified Agent Service - Full SDK integration with @nuwax-ai/sdk
 *
 * Architecture:
 * - OpencodeEngine: Full SDK API (sessions, SSE, tools, permissions, files)
 * - ClaudeCodeEngine: CLI wrapper (--print / JSON mode)
 * - UnifiedAgentService: Event bus + engine proxy
 */

import { EventEmitter } from 'events';
import { app } from 'electron';
import log from 'electron-log';
import { getAppEnv } from './dependencies';
import { loadClaudeSdk, getClaudeCodeCliPath, type PermissionResult } from './claudeAgentSdk';
import {
  createOpencode,
  createOpencodeClient,
  type OpencodeClient,
} from '@nuwax-ai/sdk';
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
  Permission,
} from '@nuwax-ai/sdk';

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
        this.client = await createOpencodeClient({ baseUrl: config.baseUrl });
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

// ==================== ClaudeCodeEngine ====================

interface ClaudeSession {
  id: string;
  title?: string;
  _sdkSessionId?: string;
  createdAt: number;
}

let _ccSessionCounter = 0;

export class ClaudeCodeEngine extends EventEmitter {
  private config: AgentConfig | null = null;
  private _ready = false;
  private sessions = new Map<string, ClaudeSession>();
  private pendingPermissions = new Map<string, { resolve: (r: PermissionResult) => void }>();
  private activeAbortController: AbortController | null = null;

  get isReady(): boolean {
    return this._ready;
  }

  // === Lifecycle ===

  async init(config: AgentConfig): Promise<boolean> {
    this.config = config;

    try {
      // Pre-load SDK to fail fast if missing
      await loadClaudeSdk();
      this._ready = true;
      log.info('[ClaudeCodeEngine] Initialized (SDK mode)');
      this.emit('ready');
      return true;
    } catch (error) {
      log.error('[ClaudeCodeEngine] Init failed — SDK not loadable:', error);
      this.emit('error', error instanceof Error ? error : new Error(String(error)));
      return false;
    }
  }

  async destroy(): Promise<void> {
    await this.abortSession();
    // Reject all pending permissions
    for (const [id, pending] of this.pendingPermissions) {
      pending.resolve({ behavior: 'deny' });
      this.pendingPermissions.delete(id);
    }
    this.sessions.clear();
    this.config = null;
    this._ready = false;
    log.info('[ClaudeCodeEngine] Destroyed');
    this.emit('destroyed');
  }

  // === Session Management ===

  async createSession(opts?: { title?: string }): Promise<SdkSession> {
    const id = `cc-${++_ccSessionCounter}-${Date.now()}`;
    const session: ClaudeSession = {
      id,
      title: opts?.title,
      createdAt: Date.now(),
    };
    this.sessions.set(id, session);
    log.info('[ClaudeCodeEngine] Session created:', id);
    return {
      id,
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

  async abortSession(_id?: string): Promise<void> {
    if (this.activeAbortController) {
      this.activeAbortController.abort();
      this.activeAbortController = null;
    }
  }

  // === Prompt (Core) ===

  async prompt(
    sessionId: string,
    parts: Array<{ type: string; text?: string; [key: string]: unknown }>,
    _opts?: PromptOptions,
  ): Promise<MessageWithParts> {
    if (!this.config) throw new Error('ClaudeCodeEngine not initialized');

    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session not found: ${sessionId}`);

    // Build prompt text from parts
    const promptText = parts
      .filter((p) => p.type === 'text' && p.text)
      .map((p) => p.text)
      .join('\n');

    if (!promptText) throw new Error('Empty prompt');

    const cfg = this.config;

    // Build env
    const env: Record<string, string> = {
      ...process.env as Record<string, string>,
      ...getAppEnv(),
    };
    if (cfg.apiKey) env.ANTHROPIC_API_KEY = cfg.apiKey;
    if (cfg.baseUrl) env.ANTHROPIC_BASE_URL = cfg.baseUrl;
    if (cfg.model) env.ANTHROPIC_MODEL = cfg.model;
    if (cfg.env) Object.assign(env, cfg.env);

    // When packaged, process.execPath is the Electron binary.
    // child_process.fork() in the SDK would launch another Electron app instance
    // without this flag.
    if (app.isPackaged) {
      env.ELECTRON_RUN_AS_NODE = '1';
    }

    // Build query options
    const abortController = new AbortController();
    this.activeAbortController = abortController;

    const options: Record<string, unknown> = {
      cwd: cfg.workspaceDir || process.cwd(),
      env,
      pathToClaudeCodeExecutable: getClaudeCodeCliPath(),
      abortController,
      includePartialMessages: true,
      permissionMode: cfg.permissionMode || 'default',
      stderr: (msg: string) => {
        log.warn('[ClaudeCodeEngine] stderr:', msg);
      },
    };

    // Model
    if (cfg.model) {
      options.model = cfg.model;
    }

    // System prompt
    if (cfg.systemPrompt) {
      options.systemPrompt = cfg.systemPrompt;
    }

    // Resume session
    if (session._sdkSessionId) {
      options.resume = session._sdkSessionId;
    }

    // MCP servers — add type:'stdio' for compatibility
    if (cfg.mcpServers) {
      const servers: Record<string, unknown> = {};
      for (const [name, srv] of Object.entries(cfg.mcpServers)) {
        servers[name] = { type: 'stdio', ...srv };
      }
      options.mcpServers = servers;
    }

    // Permission bridge
    options.canUseTool = async (
      toolName: string,
      toolInput: unknown,
      { signal }: { signal: AbortSignal },
    ): Promise<PermissionResult> => {
      if (abortController.signal.aborted || signal.aborted) {
        return { behavior: 'deny' };
      }

      const permissionId = `perm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      // Emit permission request to UI
      this.emit('permission.updated', {
        id: permissionId,
        type: 'tool',
        sessionId,
        title: `Tool: ${toolName}`,
        details: { toolName, toolInput },
        status: 'pending',
      });

      // Wait for response (with timeout)
      return new Promise<PermissionResult>((resolve) => {
        const timeout = setTimeout(() => {
          this.pendingPermissions.delete(permissionId);
          resolve({ behavior: 'deny' });
        }, 60_000);

        this.pendingPermissions.set(permissionId, {
          resolve: (result) => {
            clearTimeout(timeout);
            this.pendingPermissions.delete(permissionId);
            resolve(result);
          },
        });

        // Auto-deny if aborted
        const onAbort = () => {
          clearTimeout(timeout);
          this.pendingPermissions.delete(permissionId);
          resolve({ behavior: 'deny' });
        };
        signal.addEventListener('abort', onAbort, { once: true });
        abortController.signal.addEventListener('abort', onAbort, { once: true });
      });
    };

    // Execute query
    let resultText = '';
    try {
      const sdk = await loadClaudeSdk();
      log.info('[ClaudeCodeEngine] Starting query', {
        sessionId,
        hasResume: !!session._sdkSessionId,
        cwd: options.cwd,
      });

      const result = await sdk.query({ prompt: promptText, options });

      for await (const event of result) {
        if (abortController.signal.aborted) break;
        this.handleSdkEvent(sessionId, session, event);

        // Capture result text from 'result' events
        if (typeof event === 'object' && event !== null) {
          const payload = event as Record<string, unknown>;
          if (payload.type === 'result' && typeof payload.result === 'string') {
            resultText = payload.result;
          }
        }
      }
    } catch (error) {
      if (abortController.signal.aborted) {
        log.info('[ClaudeCodeEngine] Query aborted');
      } else {
        log.error('[ClaudeCodeEngine] Query failed:', error);
        this.emit('session.error', {
          sessionId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    } finally {
      if (this.activeAbortController === abortController) {
        this.activeAbortController = null;
      }
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
    // Fire and forget — errors are emitted as events
    this.prompt(sessionId, parts, opts).catch((error) => {
      log.error('[ClaudeCodeEngine] promptAsync error:', error);
    });
  }

  // === Permission Response ===

  respondPermission(permissionId: string, response: 'once' | 'always' | 'reject'): void {
    const pending = this.pendingPermissions.get(permissionId);
    if (!pending) {
      log.warn('[ClaudeCodeEngine] No pending permission for:', permissionId);
      return;
    }
    const behavior = response === 'reject' ? 'deny' : 'allow';
    pending.resolve({ behavior });
  }

  // === Legacy compat ===

  /** Backward-compatible simple prompt (auto-creates a temp session) */
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

  // === Internal: SDK Event Handling ===

  private handleSdkEvent(sessionId: string, session: ClaudeSession, event: unknown): void {
    if (typeof event === 'string') {
      this.emit('message.updated', {
        sessionId,
        type: 'assistant',
        content: event,
      });
      return;
    }

    if (!event || typeof event !== 'object') return;

    const payload = event as Record<string, unknown>;
    const eventType = String(payload.type ?? '');

    switch (eventType) {
      case 'system': {
        const subtype = String(payload.subtype ?? '');
        if (subtype === 'init' && typeof payload.session_id === 'string') {
          session._sdkSessionId = payload.session_id;
          this.emit('session.created', { sessionId, sdkSessionId: payload.session_id });
        }
        break;
      }

      case 'stream_event': {
        // Partial streaming content
        this.emit('message.part.updated', {
          sessionId,
          ...payload,
        });
        break;
      }

      case 'assistant': {
        // Full assistant message
        this.emit('message.updated', {
          sessionId,
          ...payload,
        });
        break;
      }

      case 'result': {
        const subtype = String(payload.subtype ?? 'success');
        if (subtype === 'success') {
          this.emit('session.idle', { sessionId });
        } else {
          const errors = Array.isArray(payload.errors)
            ? payload.errors.filter((e) => typeof e === 'string').join('\n')
            : String(payload.error || 'Unknown error');
          this.emit('session.error', { sessionId, error: errors });
        }
        break;
      }

      case 'user': {
        // User message (tool results) — forward
        this.emit('message.updated', {
          sessionId,
          ...payload,
        });
        break;
      }

      default:
        log.debug('[ClaudeCodeEngine] Unhandled event type:', eventType);
    }
  }
}

// ==================== UnifiedAgentService ====================

export class UnifiedAgentService extends EventEmitter {
  private engine: OpencodeEngine | ClaudeCodeEngine | null = null;
  private engineType: AgentEngineType | null = null;
  private config: AgentConfig | null = null;

  async init(config: AgentConfig): Promise<boolean> {
    if (this.engine) {
      await this.destroy();
    }

    this.config = config;
    this.engineType = config.engine;

    if (config.engine === 'claude-code') {
      const engine = new ClaudeCodeEngine();
      this.engine = engine;
      this.forwardEvents(engine);
      return engine.init(config);
    }

    // opencode and nuwaxcode both use OpencodeEngine
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

  get isReady(): boolean {
    return this.engine?.isReady ?? false;
  }

  getOpencodeEngine(): OpencodeEngine | null {
    return this.engine instanceof OpencodeEngine ? this.engine : null;
  }

  getClaudeCodeEngine(): ClaudeCodeEngine | null {
    return this.engine instanceof ClaudeCodeEngine ? this.engine : null;
  }

  // === Proxy methods ===

  async listSessions(): Promise<SdkSession[]> {
    if (this.engine instanceof ClaudeCodeEngine) return this.engine.listSessions();
    return this.oc().listSessions();
  }

  async createSession(opts?: { parentID?: string; title?: string }): Promise<SdkSession> {
    if (this.engine instanceof ClaudeCodeEngine) return this.engine.createSession(opts);
    return this.oc().createSession(opts);
  }

  async getSession(id: string): Promise<SdkSession> {
    if (this.engine instanceof ClaudeCodeEngine) return this.engine.getSession(id);
    return this.oc().getSession(id);
  }

  async deleteSession(id: string): Promise<boolean> {
    if (this.engine instanceof ClaudeCodeEngine) return this.engine.deleteSession(id);
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
    if (this.engine instanceof ClaudeCodeEngine) {
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
    if (this.engine instanceof ClaudeCodeEngine) {
      return this.engine.prompt(sessionId, parts as any, opts);
    }
    return this.oc().prompt(sessionId, parts, opts);
  }

  async promptAsync(
    sessionId: string,
    parts: Array<TextPartInput | FilePartInput>,
    opts?: PromptOptions,
  ): Promise<void> {
    if (this.engine instanceof ClaudeCodeEngine) {
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
    if (this.engine instanceof ClaudeCodeEngine) {
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

  // === Claude Code specific ===

  async claudePrompt(message: string): Promise<string> {
    const claude = this.getClaudeCodeEngine();
    if (!claude) throw new Error('claude-code engine not active');
    return claude.claudePrompt(message);
  }

  // === Helpers ===

  private oc(): OpencodeEngine {
    if (!(this.engine instanceof OpencodeEngine)) {
      throw new Error(`Operation requires opencode/nuwaxcode engine, current: ${this.engineType}`);
    }
    return this.engine;
  }

  private forwardEvents(engine: OpencodeEngine | ClaudeCodeEngine): void {
    const events = [
      'message.updated', 'message.removed',
      'message.part.updated', 'message.part.removed',
      'permission.updated', 'permission.replied',
      'session.created', 'session.updated', 'session.deleted',
      'session.status', 'session.idle', 'session.error', 'session.diff',
      'file.edited', 'server.connected',
      'error', 'ready', 'destroyed',
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

// ==================== Unified SSE Formatter ====================

/**
 * Unified SSE event format for all engines
 */
export interface UnifiedSseEvent {
  type: 'message' | 'permission' | 'session' | 'error' | 'done';
  sessionId?: string;
  messageId?: string;
  content?: string;
  subtype?: string;
  data?: unknown;
  timestamp: number;
}

/**
 * SSE Event Types
 */
export const SSE_EVENT_TYPES = {
  MESSAGE: 'message',
  PERMISSION: 'permission',
  SESSION: 'session',
  ERROR: 'error',
  DONE: 'done',
} as const;

/**
 * Format SDK event to unified SSE format
 */
export function formatSdkToUnifiedSse(
  type: string,
  data: Record<string, unknown>,
  sessionId?: string
): UnifiedSseEvent {
  const event: UnifiedSseEvent = {
    type: getUnifiedEventType(type),
    sessionId,
    timestamp: Date.now(),
  };

  switch (event.type) {
    case 'message':
      event.content = String(data.content || data.text || '');
      event.messageId = String(data.messageId || data.id || '');
      break;
    case 'permission':
      event.data = {
        permissionId: data.permissionId,
        description: data.description,
        tools: data.tools,
      };
      break;
    case 'session':
      event.subtype = String(data.status || data.subtype || '');
      break;
    case 'error':
      event.data = { error: String(data.error || data.message || 'Unknown error') };
      break;
  }

  return event;
}

/**
 * Map SDK event type to unified type
 */
function getUnifiedEventType(type: string): UnifiedSseEvent['type'] {
  if (type.startsWith('message')) return 'message';
  if (type.startsWith('permission')) return 'permission';
  if (type.startsWith('session')) return 'session';
  if (type === 'error' || type.includes('error')) return 'error';
  if (type === 'done' || type === '[DONE]') return 'done';
  return 'message';
}

/**
 * Convert unified event to SSE format string
 */
export function toSseString(event: UnifiedSseEvent): string {
  const lines: string[] = [];
  
  if (event.type) lines.push(`event: ${event.type}`);
  if (event.sessionId) lines.push(`sessionId: ${event.sessionId}`);
  if (event.messageId) lines.push(`messageId: ${event.messageId}`);
  if (event.content) lines.push(`data: ${JSON.stringify({ content: event.content })}`);
  else if (event.data) lines.push(`data: ${JSON.stringify(event.data)}`);
  
  lines.push('');
  return lines.join('\n');
}
