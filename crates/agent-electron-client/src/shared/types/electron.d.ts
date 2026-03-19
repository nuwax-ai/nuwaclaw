// Type definitions for Electron API exposed via preload

export type McpServerEntry =
  | { command: string; args: string[]; env?: Record<string, string> }
  | {
      url: string;
      transport?: "streamable-http" | "sse";
      headers?: Record<string, string>;
      authToken?: string;
    };

export interface McpServersConfig {
  mcpServers: Record<string, McpServerEntry>;
  allowTools?: string[];
  denyTools?: string[];
}

export interface McpProxyStatus {
  running: boolean;
  serverCount?: number;
  serverNames?: string[];
  error?: string;
}

export interface MCPAPI {
  start: () => Promise<{ success: boolean; error?: string }>;
  stop: () => Promise<{ success: boolean; error?: string }>;
  restart: () => Promise<{ success: boolean; error?: string }>;
  status: () => Promise<McpProxyStatus>;
  getConfig: () => Promise<McpServersConfig>;
  setConfig: (
    config: McpServersConfig,
  ) => Promise<{ success: boolean; error?: string }>;
  /** @deprecated no-op, port is no longer used */
  getPort: () => Promise<number>;
  /** @deprecated no-op, port is no longer used */
  setPort: (port: number) => Promise<{ success: boolean; error?: string }>;
}

export interface LanproxyAPI {
  start: (config: {
    serverIp: string;
    serverPort: number;
    clientKey: string;
    ssl?: boolean;
  }) => Promise<{ success: boolean; error?: string }>;
  stop: () => Promise<{ success: boolean; error?: string }>;
  status: () => Promise<{ running: boolean; pid?: number; error?: string }>;
  /** 当前平台是否有 lanproxy 二进制（用于设置页提示「当前平台暂不支持」） */
  isAvailable: () => Promise<{ available: boolean }>;
}

export interface AgentRunnerAPI {
  start: (config: {
    binPath: string;
    backendPort: number;
    proxyPort: number;
    apiKey: string;
    apiBaseUrl: string;
    defaultModel: string;
  }) => Promise<{ success: boolean; error?: string }>;
  stop: () => Promise<{ success: boolean; error?: string }>;
  status: () => Promise<{
    running: boolean;
    pid?: number;
    backendUrl?: string;
    proxyUrl?: string;
  }>;
}

export interface FileServerAPI {
  start: (port?: number) => Promise<{ success: boolean; error?: string }>;
  stop: () => Promise<{ success: boolean; error?: string }>;
  status: () => Promise<{ running: boolean; pid?: number; error?: string }>;
}

export interface ComputerServerAPI {
  start: (port?: number) => Promise<{ success: boolean; error?: string }>;
  stop: () => Promise<{ success: boolean; error?: string }>;
  status: () => Promise<{ running: boolean; port?: number; error?: string }>;
}

export type DependencyStatus =
  | "checking"
  | "installed"
  | "missing"
  | "outdated"
  | "installing"
  | "bundled"
  | "error";

export interface LocalDependencyItem {
  name: string;
  displayName: string;
  type: "system" | "bundled" | "npm-local" | "npm-global" | "shell-installer";
  description: string;
  required: boolean;
  minVersion?: string;
  /** 初始化/安装时使用的固定版本；存在时安装或升级到该版本 */
  installVersion?: string;
  binName?: string;
  status: DependencyStatus;
  version?: string;
  latestVersion?: string;
  binPath?: string;
  errorMessage?: string;
  meetsRequirement?: boolean;
}

export interface DependenciesAPI {
  checkAll: (options?: { checkLatest?: boolean }) => Promise<{
    success: boolean;
    results?: LocalDependencyItem[];
    error?: string;
    syncInProgress?: boolean;
  }>;
  checkNode: () => Promise<{
    success: boolean;
    installed?: boolean;
    version?: string;
    meetsRequirement?: boolean;
    bundled?: boolean;
    binPath?: string;
    error?: string;
  }>;
  checkUv: () => Promise<{
    success: boolean;
    installed?: boolean;
    version?: string;
    meetsRequirement?: boolean;
    bundled?: boolean;
    error?: string;
  }>;
  /** 应用包内集成的 nuwax-mcp-stdio-proxy，与 Node/uv 一起在系统环境中展示 */
  checkMcpProxyBundled: () => Promise<{
    success: boolean;
    available?: boolean;
    version?: string;
    error?: string;
  }>;
  detectPackage: (
    packageName: string,
    binName?: string,
  ) => Promise<{
    success: boolean;
    installed?: boolean;
    version?: string;
    binPath?: string;
    error?: string;
  }>;
  installPackage: (
    packageName: string,
    options?: { registry?: string; version?: string },
  ) => Promise<{
    success: boolean;
    version?: string;
    binPath?: string;
    error?: string;
  }>;
  installMissing: () => Promise<{
    success: boolean;
    results?: Array<{ name: string; success: boolean; error?: string }>;
  }>;
  getAppDataDir: () => Promise<string>;
  getRequiredList: () => Promise<LocalDependencyItem[]>;
}

export type AgentEngine = "claude-code" | "nuwaxcode";

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
  install: (
    engine: string,
    options?: { registry?: string },
  ) => Promise<{ success: boolean; error?: string }>;
  start: (
    config: EngineStartConfig,
  ) => Promise<{ success: boolean; error?: string; engineId?: string }>;
  stop: (engineId: string) => Promise<{ success: boolean; error?: string }>;
  status: (
    engineId?: string,
  ) => Promise<EngineStatus | Record<string, EngineStatus>>;
  send: (
    engineId: string,
    message: string,
  ) => Promise<{ success: boolean; error?: string }>;
  stopAll: () => Promise<{ success: boolean }>;
}

// SDK types (simplified for renderer use)
export type AgentEngineType = "nuwaxcode" | "claude-code";

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
  env?: Record<string, string>;
  mcpServers?: Record<
    string,
    { command: string; args: string[]; env?: Record<string, string> }
  >;
  permissionMode?: "default" | "acceptEdits" | "bypassPermissions";
  systemPrompt?: string;
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

type ApiResult<T = unknown> = Promise<{
  success: boolean;
  data?: T;
  error?: string;
}>;

export interface AgentAPI {
  // Unified Agent SDK
  init: (config: AgentInitConfig) => ApiResult;
  destroy: () => ApiResult;
  getEngineType: () => Promise<AgentEngineType | null>;
  isReady: () => Promise<boolean>;
  serviceStatus: () => Promise<{
    running: boolean;
    engineType?: AgentEngineType | null;
  }>;

  // Session management (SDK)
  listSessions: () => ApiResult<SdkSession[]>;
  createSession: (opts?: {
    parentID?: string;
    title?: string;
  }) => ApiResult<SdkSession>;
  getSession: (id: string) => ApiResult<SdkSession>;
  deleteSession: (id: string) => ApiResult;
  updateSession: (id: string, title?: string) => ApiResult<SdkSession>;
  getSessionStatus: () => ApiResult<Record<string, unknown>>;
  forkSession: (id: string, messageId?: string) => ApiResult<SdkSession>;

  // Messages
  getMessages: (
    sessionId: string,
    limit?: number,
  ) => ApiResult<MessageWithParts[]>;
  getMessage: (
    sessionId: string,
    messageId: string,
  ) => ApiResult<MessageWithParts>;

  // Prompt / Command / Shell
  prompt: (
    sessionId: string,
    parts: unknown[],
    opts?: unknown,
  ) => ApiResult<MessageWithParts>;
  promptAsync: (
    sessionId: string,
    parts: unknown[],
    opts?: unknown,
  ) => ApiResult;
  command: (
    sessionId: string,
    cmd: string,
    args?: string,
    opts?: unknown,
  ) => ApiResult<MessageWithParts>;
  shell: (
    sessionId: string,
    cmd: string,
    agent?: string,
    model?: unknown,
  ) => ApiResult<MessageWithParts>;

  // Abort
  abort: (sessionId: string) => ApiResult;

  // Permission
  respondPermission: (
    sessionId: string,
    permissionId: string,
    response: "once" | "always" | "reject",
  ) => ApiResult;

  // Session operations
  getSessionDiff: (
    sessionId: string,
    messageId?: string,
  ) => ApiResult<unknown[]>;
  revert: (
    sessionId: string,
    messageId: string,
    partId?: string,
  ) => ApiResult<SdkSession>;
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

  // Sessions tab (detailed view)
  listSessionsDetailed: () => ApiResult<import("./sessions").DetailedSession[]>;
  stopSession: (sessionId: string) => ApiResult;

  // SSE Event listening
  onEvent: (
    callback: (event: unknown, data: AgentEventPayload) => void,
  ) => void;
  offEvent: (
    callback: (event: unknown, data: AgentEventPayload) => void,
  ) => void;
}

export interface AutolaunchAPI {
  get: () => Promise<boolean>;
  set: (enabled: boolean) => Promise<{ success: boolean; error?: string }>;
}

export interface LogEntry {
  timestamp: string;
  level: "info" | "warn" | "error" | "debug";
  message: string;
}

export interface LogAPI {
  getDir: () => Promise<string>;
  openDir: () => Promise<{ success: boolean; error?: string }>;
  list: (count?: number, offset?: number) => Promise<LogEntry[]>;
  write: (
    level: "info" | "warn" | "error",
    message: string,
    ...args: unknown[]
  ) => Promise<void>;
}

import type { UpdateInfo, UpdateState } from "./updateTypes";

export interface AppAPI {
  checkUpdate: () => Promise<UpdateInfo>;
  getVersion: () => Promise<string>;
  downloadUpdate: () => Promise<{ success: boolean; error?: string }>;
  installUpdate: () => Promise<{ success: boolean; error?: string }>;
  getUpdateState: () => Promise<UpdateState>;
  openReleasesPage: () => Promise<{ success: boolean }>;
  getDeviceId: () => Promise<string>;
}

export type PermissionStatus = "granted" | "denied" | "unknown";

export interface PermissionItem {
  key: string;
  name: string;
  description: string;
  status: PermissionStatus;
}

export interface PermissionsAPI {
  check: () => Promise<PermissionItem[]>;
  openSettings: (
    permissionKey: string,
  ) => Promise<{ success: boolean; error?: string }>;
}

export interface ShellAPI {
  openExternal: (url: string) => Promise<{ success: boolean; error?: string }>;
}

// ==================== Computer API (rcoder /computer/* compat) ====================

// Shared types — single source of truth
export type {
  HttpResult,
  ComputerChatRequest,
  ComputerChatResponse,
  UnifiedSessionMessage,
  ComputerAgentStatusResponse,
  ComputerAgentStopResponse,
  ComputerAgentCancelResponse,
} from "./computerTypes";

import type {
  HttpResult,
  ComputerChatRequest,
  ComputerChatResponse,
  UnifiedSessionMessage,
  ComputerAgentStatusResponse,
  ComputerAgentStopResponse,
  ComputerAgentCancelResponse,
} from "./computerTypes";

export interface ComputerAPI {
  chat(request: ComputerChatRequest): Promise<HttpResult<ComputerChatResponse>>;
  agentStatus(request: {
    user_id: string;
    project_id?: string;
  }): Promise<HttpResult<ComputerAgentStatusResponse>>;
  agentStop(request: {
    user_id: string;
    project_id?: string;
  }): Promise<HttpResult<ComputerAgentStopResponse>>;
  cancelSession(request: {
    user_id: string;
    project_id?: string;
    session_id?: string;
  }): Promise<HttpResult<ComputerAgentCancelResponse>>;
  health(): Promise<{
    status: string;
    engineType?: string | null;
    timestamp: string;
  }>;
  onProgress(
    callback: (event: unknown, data: UnifiedSessionMessage) => void,
  ): void;
  offProgress(
    callback: (event: unknown, data: UnifiedSessionMessage) => void,
  ): void;
}

export interface ServicesAPI {
  restartAll: () => Promise<{
    success: boolean;
    results?: Record<string, { success: boolean; error?: string }>;
  }>;
  stopAll: () => Promise<{
    success: boolean;
    results?: Record<string, { success: boolean; error?: string }>;
  }>;
}

export type TrayStatus = "running" | "stopped" | "error" | "starting";

export interface TrayAPI {
  updateStatus: (status: TrayStatus) => Promise<void>;
  updateServicesStatus: (running: boolean) => Promise<void>;
}

export interface MirrorPresets {
  npm: { official: string; taobao: string; tencent: string };
  uv: { official: string; tuna: string; aliyun: string; tencent: string };
}

export interface MirrorAPI {
  get: () => Promise<{
    success: boolean;
    npmRegistry: string;
    uvIndexUrl: string;
    presets: MirrorPresets;
  }>;
  set: (config: {
    npmRegistry?: string;
    uvIndexUrl?: string;
  }) => Promise<{ success: boolean; error?: string }>;
}

export interface DialogAPI {
  openDirectory: (title?: string) => Promise<{
    success: boolean;
    path?: string;
    canceled?: boolean;
    error?: string;
  }>;
}

import type { QuickInitConfig } from "./quickInit";

export interface QuickInitAPI {
  getConfig: () => Promise<QuickInitConfig | null>;
}

export interface ElectronAPI {
  versions: {
    node: string;
    electron: string;
    chrome: string;
  };
  session: {
    setCookie: (params: {
      url: string;
      name: string;
      value: string;
      domain: string;
      httpOnly?: boolean;
      secure?: boolean;
    }) => Promise<{ success: boolean; error?: string }>;
  };
  webview: {
    openWindow: (params: {
      url: string;
      title?: string;
    }) => Promise<{ success: boolean; reused?: boolean; error?: string }>;
    closeWindow: () => Promise<{ success: boolean; error?: string }>;
    isWindowOpen: () => Promise<boolean>;
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
  computerServer: ComputerServerAPI;
  dependencies: DependenciesAPI;
  shell: ShellAPI;
  mirror: MirrorAPI;
  dialog: DialogAPI;
  engine: EngineAPI;
  agent: AgentAPI;
  computer: ComputerAPI;
  services: ServicesAPI;
  tray: TrayAPI;
  autolaunch: AutolaunchAPI;
  log: LogAPI;
  app: AppAPI;
  permissions: PermissionsAPI;
  quickInit: QuickInitAPI;
  on: (channel: string, callback: (...args: unknown[]) => void) => void;
  off: (channel: string, callback: (...args: unknown[]) => void) => void;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}
