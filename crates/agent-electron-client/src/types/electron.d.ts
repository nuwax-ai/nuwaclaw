// Type definitions for Electron API exposed via preload

export interface Session {
  id: string;
  created_at: number;
  updated_at: number;
  title: string;
  model: string;
  system_prompt: string | null;
}

export interface Message {
  id: string;
  session_id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  created_at: number;
}

export interface MCPAPI {
  install: (packageName: string, registry?: string) => Promise<{ success: boolean; error?: string }>;
  uninstall: (packageName: string) => Promise<{ success: boolean; error?: string }>;
  isInstalled: (packageName: string) => Promise<boolean>;
  start: (id: string, command: string, args: string[], env?: Record<string, string>) => Promise<{ success: boolean; error?: string }>;
  stop: (id: string) => Promise<{ success: boolean; error?: string }>;
  running: () => Promise<string[]>;
}

export interface LanproxyAPI {
  start: (config: { binPath: string; serverIp: string; serverPort: number; clientKey: string; localPort: number }) => Promise<{ success: boolean; error?: string }>;
  stop: () => Promise<{ success: boolean; error?: string }>;
  status: () => Promise<{ running: boolean; pid?: number }>;
}

export interface AgentRunnerAPI {
  start: (config: { binPath: string; backendPort: number; proxyPort: number; apiKey: string; apiBaseUrl: string; defaultModel: string }) => Promise<{ success: boolean; error?: string }>;
  stop: () => Promise<{ success: boolean; error?: string }>;
  status: () => Promise<{ running: boolean; pid?: number; backendUrl?: string; proxyUrl?: string }>;
}

export interface FileServerAPI {
  start: (port?: number) => Promise<{ success: boolean; error?: string }>;
  stop: () => Promise<{ success: boolean; error?: string }>;
  status: () => Promise<{ running: boolean; pid?: number }>;
}

export type DependencyStatus = 'checking' | 'installed' | 'missing' | 'outdated' | 'installing' | 'bundled' | 'error';

export interface LocalDependencyItem {
  name: string;
  displayName: string;
  type: 'system' | 'npm-local' | 'npm-global' | 'shell-installer';
  description: string;
  required: boolean;
  minVersion?: string;
  binName?: string;
  status: DependencyStatus;
  version?: string;
  latestVersion?: string;
  binPath?: string;
  errorMessage?: string;
  meetsRequirement?: boolean;
}

export interface DependenciesAPI {
  checkAll: () => Promise<{ success: boolean; results?: LocalDependencyItem[]; error?: string }>;
  checkNode: () => Promise<{ success: boolean; installed?: boolean; version?: string; meetsRequirement?: boolean; error?: string }>;
  checkUv: () => Promise<{ success: boolean; installed?: boolean; version?: string; meetsRequirement?: boolean; error?: string }>;
  detectPackage: (packageName: string, binName?: string) => Promise<{ success: boolean; installed?: boolean; version?: string; binPath?: string; error?: string }>;
  installPackage: (packageName: string, options?: { registry?: string; version?: string }) => Promise<{ success: boolean; version?: string; binPath?: string; error?: string }>;
  installMissing: () => Promise<{ success: boolean; results?: Array<{ name: string; success: boolean; error?: string }> }>;
  getAppDataDir: () => Promise<string>;
  getRequiredList: () => Promise<LocalDependencyItem[]>;
}

export type AgentEngine = 'claude-code' | 'nuwaxcode';

export interface EngineStartConfig {
  engine: AgentEngine;
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  workspaceDir?: string;
}

export interface EngineStatus {
  installed: boolean;
  version?: string;
  running: boolean;
  pid?: number;
  error?: string;
}

export interface EngineAPI {
  checkLocal: (engine: string) => Promise<boolean>;
  checkGlobal: (engine: string) => Promise<boolean>;
  getVersion: (engine: string) => Promise<string | null>;
  findBinary: (engine: string) => Promise<string | null>;
  install: (engine: string, options?: { registry?: string }) => Promise<{ success: boolean; error?: string }>;
  start: (config: EngineStartConfig) => Promise<{ success: boolean; error?: string; engineId?: string }>;
  stop: (engineId: string) => Promise<{ success: boolean; error?: string }>;
  status: (engineId?: string) => Promise<EngineStatus | Record<string, EngineStatus>>;
  send: (engineId: string, message: string) => Promise<{ success: boolean; error?: string }>;
  stopAll: () => Promise<{ success: boolean }>;
}

// SDK types (simplified for renderer use)
export type AgentEngineType = 'opencode' | 'nuwaxcode' | 'claude-code';

export interface AgentInitConfig {
  engine: AgentEngineType;
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  workspaceDir: string;
  hostname?: string;
  port?: number;
  timeout?: number;
  engineBinaryPath?: string;
}

export interface SdkSession {
  id: string;
  parentID?: string;
  title?: string;
  time?: { created: number; updated?: number };
  [key: string]: unknown;
}

export interface MessageWithParts {
  info: unknown;
  parts: unknown[];
}

export interface AgentEventPayload {
  type: string;
  data: unknown;
}

type ApiResult<T = unknown> = Promise<{ success: boolean; data?: T; error?: string }>;

export interface AgentAPI {
  // Legacy (process-level)
  start: (config: { type: 'nuwaxcode' | 'claude-code'; binPath: string; env: Record<string, string>; apiKey?: string; apiBaseUrl?: string; model?: string }) => Promise<{ success: boolean; error?: string }>;
  stop: () => Promise<{ success: boolean; error?: string }>;
  status: () => Promise<{ running: boolean; pid?: number }>;
  send: (message: string) => Promise<{ success: boolean; response?: string; error?: string }>;

  // Unified Agent SDK
  init: (config: AgentInitConfig) => ApiResult;
  destroy: () => ApiResult;
  getEngineType: () => Promise<AgentEngineType | null>;
  isReady: () => Promise<boolean>;

  // Session management (SDK)
  listSessions: () => ApiResult<SdkSession[]>;
  createSession: (opts?: { parentID?: string; title?: string }) => ApiResult<SdkSession>;
  getSession: (id: string) => ApiResult<SdkSession>;
  deleteSession: (id: string) => ApiResult;
  updateSession: (id: string, title?: string) => ApiResult<SdkSession>;
  getSessionStatus: () => ApiResult<Record<string, unknown>>;
  forkSession: (id: string, messageId?: string) => ApiResult<SdkSession>;

  // Messages
  getMessages: (sessionId: string, limit?: number) => ApiResult<MessageWithParts[]>;
  getMessage: (sessionId: string, messageId: string) => ApiResult<MessageWithParts>;

  // Prompt / Command / Shell
  prompt: (sessionId: string, parts: unknown[], opts?: unknown) => ApiResult<MessageWithParts>;
  promptAsync: (sessionId: string, parts: unknown[], opts?: unknown) => ApiResult;
  command: (sessionId: string, cmd: string, args?: string, opts?: unknown) => ApiResult<MessageWithParts>;
  shell: (sessionId: string, cmd: string, agent?: string, model?: unknown) => ApiResult<MessageWithParts>;

  // Abort
  abort: (sessionId: string) => ApiResult;

  // Permission
  respondPermission: (sessionId: string, permissionId: string, response: 'once' | 'always' | 'reject') => ApiResult;

  // Session operations
  getSessionDiff: (sessionId: string, messageId?: string) => ApiResult<unknown[]>;
  revert: (sessionId: string, messageId: string, partId?: string) => ApiResult<SdkSession>;
  unrevert: (sessionId: string) => ApiResult<SdkSession>;
  shareSession: (sessionId: string) => ApiResult<SdkSession>;

  // Tools & Providers
  listTools: (provider?: string, model?: string) => ApiResult<unknown[]>;
  listProviders: () => ApiResult<unknown[]>;

  // Config
  getConfig: () => ApiResult<unknown>;

  // File operations
  findText: (pattern: string) => ApiResult<unknown[]>;
  findFiles: (query: string, dirs?: boolean) => ApiResult<string[]>;
  listFiles: (dirPath: string) => ApiResult<unknown[]>;
  readFile: (filePath: string) => ApiResult<unknown>;

  // MCP via SDK
  mcpStatus: () => ApiResult<unknown>;

  // Agents & Commands
  listAgents: () => ApiResult<unknown[]>;
  listCommands: () => ApiResult<unknown[]>;

  // Claude Code specific
  claudePrompt: (message: string) => ApiResult<string>;

  // SSE Event listening
  onEvent: (callback: (event: unknown, data: AgentEventPayload) => void) => void;
  offEvent: (callback: (event: unknown, data: AgentEventPayload) => void) => void;
}

export interface ElectronAPI {
  session: {
    list: () => Promise<Session[]>;
    create: (session: { id: string; title: string; model: string; system_prompt?: string }) => Promise<Session>;
    delete: (sessionId: string) => Promise<boolean>;
  };
  message: {
    list: (sessionId: string) => Promise<Message[]>;
    add: (message: { id: string; session_id: string; role: string; content: string }) => Promise<Message>;
  };
  settings: {
    get: (key: string) => Promise<unknown>;
    set: (key: string, value: unknown) => Promise<boolean>;
  };
  window: {
    minimize: () => Promise<void>;
    maximize: () => Promise<void>;
    close: () => Promise<void>;
  };
  mcp: MCPAPI;
  lanproxy: LanproxyAPI;
  agentRunner: AgentRunnerAPI;
  fileServer: FileServerAPI;
  dependencies: DependenciesAPI;
  engine: EngineAPI;
  agent: AgentAPI;
  on: (channel: string, callback: (...args: unknown[]) => void) => void;
  off: (channel: string, callback: (...args: unknown[]) => void) => void;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}
