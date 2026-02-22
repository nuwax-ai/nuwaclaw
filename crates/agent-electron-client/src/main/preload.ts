import { contextBridge, ipcRenderer } from 'electron';

// Expose protected methods to the renderer process
contextBridge.exposeInMainWorld('electronAPI', {
  // Session management (SQLite)
  session: {
    list: () => ipcRenderer.invoke('session:list'),
    create: (session: { id: string; title: string; model: string; system_prompt?: string }) =>
      ipcRenderer.invoke('session:create', session),
    delete: (sessionId: string) => ipcRenderer.invoke('session:delete', sessionId),
  },

  // Message management (SQLite)
  message: {
    list: (sessionId: string) => ipcRenderer.invoke('message:list', sessionId),
    add: (message: { id: string; session_id: string; role: string; content: string }) =>
      ipcRenderer.invoke('message:add', message),
  },

  // Settings
  settings: {
    get: (key: string) => ipcRenderer.invoke('settings:get', key),
    set: (key: string, value: unknown) => ipcRenderer.invoke('settings:set', key, value),
  },

  // Window controls
  window: {
    minimize: () => ipcRenderer.invoke('window:minimize'),
    maximize: () => ipcRenderer.invoke('window:maximize'),
    close: () => ipcRenderer.invoke('window:close'),
  },

  // MCP management (via IPC to main process)
  mcp: {
    install: (packageName: string, registry?: string) =>
      ipcRenderer.invoke('mcp:install', { packageName, registry }),
    uninstall: (packageName: string) =>
      ipcRenderer.invoke('mcp:uninstall', packageName),
    isInstalled: (packageName: string) =>
      ipcRenderer.invoke('mcp:isInstalled', packageName),
    start: (id: string, command: string, args: string[], env?: Record<string, string>) =>
      ipcRenderer.invoke('mcp:start', { id, command, args, env }),
    stop: (id: string) =>
      ipcRenderer.invoke('mcp:stop', id),
    running: () =>
      ipcRenderer.invoke('mcp:running'),
  },

  // Lanproxy management (via IPC to main process)
  lanproxy: {
    start: (config: { binPath: string; serverIp: string; serverPort: number; clientKey: string; localPort: number }) =>
      ipcRenderer.invoke('lanproxy:start', config),
    stop: () =>
      ipcRenderer.invoke('lanproxy:stop'),
    status: () =>
      ipcRenderer.invoke('lanproxy:status'),
  },

  // Agent Runner management (via IPC to main process)
  agentRunner: {
    start: (config: { binPath: string; backendPort: number; proxyPort: number; apiKey: string; apiBaseUrl: string; defaultModel: string }) =>
      ipcRenderer.invoke('agentRunner:start', config),
    stop: () =>
      ipcRenderer.invoke('agentRunner:stop'),
    status: () =>
      ipcRenderer.invoke('agentRunner:status'),
  },

  // Agent - unified SDK service (@nuwax-ai/sdk)
  agent: {
    // Legacy (process-level)
    start: (config: { type: 'nuwaxcode' | 'claude-code'; binPath: string; env: Record<string, string>; apiKey?: string; apiBaseUrl?: string; model?: string }) =>
      ipcRenderer.invoke('agent:start', config),
    stop: () =>
      ipcRenderer.invoke('agent:stop'),
    status: () =>
      ipcRenderer.invoke('agent:status'),
    send: (message: string) =>
      ipcRenderer.invoke('agent:send', message),

    // Unified Agent SDK
    init: (config: any) =>
      ipcRenderer.invoke('agent:init', config),
    destroy: () =>
      ipcRenderer.invoke('agent:destroy'),
    getEngineType: () =>
      ipcRenderer.invoke('agent:getEngineType'),
    isReady: () =>
      ipcRenderer.invoke('agent:isReady'),

    // Session management (SDK)
    listSessions: () =>
      ipcRenderer.invoke('agent:listSessions'),
    createSession: (opts?: { parentID?: string; title?: string }) =>
      ipcRenderer.invoke('agent:createSession', opts),
    getSession: (id: string) =>
      ipcRenderer.invoke('agent:getSession', id),
    deleteSession: (id: string) =>
      ipcRenderer.invoke('agent:deleteSession', id),
    updateSession: (id: string, title?: string) =>
      ipcRenderer.invoke('agent:updateSession', id, title),
    getSessionStatus: () =>
      ipcRenderer.invoke('agent:getSessionStatus'),
    forkSession: (id: string, messageId?: string) =>
      ipcRenderer.invoke('agent:forkSession', id, messageId),

    // Messages
    getMessages: (sessionId: string, limit?: number) =>
      ipcRenderer.invoke('agent:getMessages', sessionId, limit),
    getMessage: (sessionId: string, messageId: string) =>
      ipcRenderer.invoke('agent:getMessage', sessionId, messageId),

    // Prompt / Command / Shell
    prompt: (sessionId: string, parts: any[], opts?: any) =>
      ipcRenderer.invoke('agent:prompt', sessionId, parts, opts),
    promptAsync: (sessionId: string, parts: any[], opts?: any) =>
      ipcRenderer.invoke('agent:promptAsync', sessionId, parts, opts),
    command: (sessionId: string, cmd: string, args?: string, opts?: any) =>
      ipcRenderer.invoke('agent:command', sessionId, cmd, args, opts),
    shell: (sessionId: string, cmd: string, agent?: string, model?: any) =>
      ipcRenderer.invoke('agent:shell', sessionId, cmd, agent, model),

    // Abort
    abort: (sessionId: string) =>
      ipcRenderer.invoke('agent:abort', sessionId),

    // Permission
    respondPermission: (sessionId: string, permissionId: string, response: 'once' | 'always' | 'reject') =>
      ipcRenderer.invoke('agent:respondPermission', sessionId, permissionId, response),

    // Session operations
    getSessionDiff: (sessionId: string, messageId?: string) =>
      ipcRenderer.invoke('agent:getSessionDiff', sessionId, messageId),
    revert: (sessionId: string, messageId: string, partId?: string) =>
      ipcRenderer.invoke('agent:revert', sessionId, messageId, partId),
    unrevert: (sessionId: string) =>
      ipcRenderer.invoke('agent:unrevert', sessionId),
    shareSession: (sessionId: string) =>
      ipcRenderer.invoke('agent:shareSession', sessionId),

    // Tools
    listTools: (provider?: string, model?: string) =>
      ipcRenderer.invoke('agent:listTools', provider, model),

    // Providers
    listProviders: () =>
      ipcRenderer.invoke('agent:listProviders'),

    // Config
    getConfig: () =>
      ipcRenderer.invoke('agent:getConfig'),

    // File operations
    findText: (pattern: string) =>
      ipcRenderer.invoke('agent:findText', pattern),
    findFiles: (query: string, dirs?: boolean) =>
      ipcRenderer.invoke('agent:findFiles', query, dirs),
    listFiles: (dirPath: string) =>
      ipcRenderer.invoke('agent:listFiles', dirPath),
    readFile: (filePath: string) =>
      ipcRenderer.invoke('agent:readFile', filePath),

    // MCP via SDK
    mcpStatus: () =>
      ipcRenderer.invoke('agent:mcpStatus'),

    // Agents & Commands
    listAgents: () =>
      ipcRenderer.invoke('agent:listAgents'),
    listCommands: () =>
      ipcRenderer.invoke('agent:listCommands'),

    // Claude Code specific
    claudePrompt: (message: string) =>
      ipcRenderer.invoke('agent:claudePrompt', message),

    // SSE Event listening
    onEvent: (callback: (event: any, data: { type: string; data: any }) => void) => {
      ipcRenderer.on('agent:event', callback);
    },
    offEvent: (callback: (event: any, data: { type: string; data: any }) => void) => {
      ipcRenderer.removeListener('agent:event', callback);
    },
  },

  // File Server management
  fileServer: {
    start: (port?: number) =>
      ipcRenderer.invoke('fileServer:start', port),
    stop: () =>
      ipcRenderer.invoke('fileServer:stop'),
    status: () =>
      ipcRenderer.invoke('fileServer:status'),
  },

  // Dependency management
  dependencies: {
    checkAll: () =>
      ipcRenderer.invoke('dependencies:checkAll'),
    checkNode: () =>
      ipcRenderer.invoke('dependencies:checkNode'),
    checkUv: () =>
      ipcRenderer.invoke('dependencies:checkUv'),
    detectPackage: (packageName: string, binName?: string) =>
      ipcRenderer.invoke('dependencies:detectPackage', packageName, binName),
    installPackage: (packageName: string, options?: { registry?: string; version?: string }) =>
      ipcRenderer.invoke('dependencies:installPackage', packageName, options),
    installMissing: () =>
      ipcRenderer.invoke('dependencies:installMissing'),
    getAppDataDir: () =>
      ipcRenderer.invoke('dependencies:getAppDataDir'),
    getRequiredList: () =>
      ipcRenderer.invoke('dependencies:getRequiredList'),
  },

  // Engine Manager (claude-code / nuwaxcode)
  engine: {
    checkLocal: (engine: string) =>
      ipcRenderer.invoke('engine:checkLocal', engine),
    checkGlobal: (engine: string) =>
      ipcRenderer.invoke('engine:checkGlobal', engine),
    getVersion: (engine: string) =>
      ipcRenderer.invoke('engine:getVersion', engine),
    findBinary: (engine: string) =>
      ipcRenderer.invoke('engine:findBinary', engine),
    install: (engine: string, options?: { registry?: string }) =>
      ipcRenderer.invoke('engine:install', engine, options),
    start: (config: { engine: string; apiKey?: string; baseUrl?: string; model?: string; workspaceDir?: string }) =>
      ipcRenderer.invoke('engine:start', config),
    stop: (engineId: string) =>
      ipcRenderer.invoke('engine:stop', engineId),
    status: (engineId?: string) =>
      ipcRenderer.invoke('engine:status', engineId),
    send: (engineId: string, message: string) =>
      ipcRenderer.invoke('engine:send', engineId, message),
    stopAll: () =>
      ipcRenderer.invoke('engine:stopAll'),
  },

  // Shell utilities
  shell: {
    openExternal: (url: string) => ipcRenderer.invoke('shell:openExternal', url),
  },

  // Dialog utilities
  dialog: {
    openDirectory: (title?: string) => ipcRenderer.invoke('dialog:openDirectory', title),
  },

  // Autolaunch
  autolaunch: {
    get: () => ipcRenderer.invoke('autolaunch:get'),
    set: (enabled: boolean) => ipcRenderer.invoke('autolaunch:set', enabled),
  },

  // Log
  log: {
    getDir: () => ipcRenderer.invoke('log:getDir'),
    openDir: () => ipcRenderer.invoke('log:openDir'),
    list: (count?: number) => ipcRenderer.invoke('log:list', count),
  },

  // App
  app: {
    checkUpdate: () => ipcRenderer.invoke('app:checkUpdate'),
    getVersion: () => ipcRenderer.invoke('app:getVersion'),
  },

  // Permissions (macOS)
  permissions: {
    check: () => ipcRenderer.invoke('permissions:check'),
    openSettings: (permissionKey: string) => ipcRenderer.invoke('permissions:openSettings', permissionKey),
  },

  // Event listeners
  on: (channel: string, callback: (...args: unknown[]) => void) => {
    const validChannels = ['menu:new-session', 'menu:settings', 'menu:mcp-settings', 'cowork:message', 'cowork:permission', 'agent:event'];
    if (validChannels.includes(channel)) {
      ipcRenderer.on(channel, (_, ...args) => callback(...args));
    }
  },

  off: (channel: string, callback: (...args: unknown[]) => void) => {
    ipcRenderer.removeListener(channel, callback);
  },
});
