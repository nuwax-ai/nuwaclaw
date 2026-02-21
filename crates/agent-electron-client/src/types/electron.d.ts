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
  dependencies: DependenciesAPI;
  engine: EngineAPI;
  on: (channel: string, callback: (...args: unknown[]) => void) => void;
  off: (channel: string, callback: (...args: unknown[]) => void) => void;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}
