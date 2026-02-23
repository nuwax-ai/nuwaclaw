/**
 * OpencodeEngine — HTTP/SSE client for opencode engine via @nuwax-ai/sdk
 */

import { EventEmitter } from 'events';
import log from 'electron-log';
import {
  createOpencode,
  createOpencodeClient,
  type OpencodeClient,
} from '@nuwax-ai/sdk';
import type {
  TextPartInput,
  FilePartInput,
  FileDiff,
} from '@nuwax-ai/sdk';
import type {
  AgentConfig,
  SdkSession,
  SessionStatus,
  MessageWithParts,
  PromptOptions,
  CommandOptions,
  ToolInfo,
  ProviderInfo,
} from './unifiedAgent';

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
