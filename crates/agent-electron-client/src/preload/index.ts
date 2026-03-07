import { contextBridge, ipcRenderer } from 'electron';

// Expose protected methods to the renderer process
contextBridge.exposeInMainWorld('electronAPI', {
  // Process info (available in preload but not in renderer)
  versions: {
    node: process.versions.node,
    electron: process.versions.electron,
    chrome: process.versions.chrome,
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

  // MCP Proxy management (nuwax-mcp-stdio-proxy 聚合代理)
  mcp: {
    start: () =>
      ipcRenderer.invoke('mcp:start'),
    stop: () =>
      ipcRenderer.invoke('mcp:stop'),
    restart: () =>
      ipcRenderer.invoke('mcp:restart'),
    status: () =>
      ipcRenderer.invoke('mcp:status'),
    getConfig: () =>
      ipcRenderer.invoke('mcp:getConfig'),
    setConfig: (config: { mcpServers: Record<string, { command: string; args: string[]; env?: Record<string, string> }> }) =>
      ipcRenderer.invoke('mcp:setConfig', config),
    getPort: () =>
      Promise.resolve(0),
    setPort: (_port: number) =>
      Promise.resolve({ success: true }),
  },

  // Lanproxy management (via IPC to main process)
  lanproxy: {
    start: (config: { serverIp: string; serverPort: number; clientKey: string; ssl?: boolean }) =>
      ipcRenderer.invoke('lanproxy:start', config),
    stop: () =>
      ipcRenderer.invoke('lanproxy:stop'),
    status: () =>
      ipcRenderer.invoke('lanproxy:status'),
    isAvailable: () =>
      ipcRenderer.invoke('lanproxy:isAvailable') as Promise<{ available: boolean }>,
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

  // Agent - unified ACP service (claude-code/nuwaxcode)
  agent: {
    // Unified Agent ACP
    init: (config: any) =>
      ipcRenderer.invoke('agent:init', config),
    destroy: () =>
      ipcRenderer.invoke('agent:destroy'),
    getEngineType: () =>
      ipcRenderer.invoke('agent:getEngineType'),
    isReady: () =>
      ipcRenderer.invoke('agent:isReady'),
    serviceStatus: () =>
      ipcRenderer.invoke('agent:serviceStatus'),

    // Session management (ACP)
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

    // MCP via ACP
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

  // Computer Server lifecycle (Agent HTTP 接口服务)
  computerServer: {
    start: (port?: number) =>
      ipcRenderer.invoke('computerServer:start', port),
    stop: () =>
      ipcRenderer.invoke('computerServer:stop'),
    status: () =>
      ipcRenderer.invoke('computerServer:status'),
  },

  // Computer API (对齐 rcoder /computer/* API)
  computer: {
    chat: (request: any) => ipcRenderer.invoke('computer:chat', request),
    agentStatus: (request: any) => ipcRenderer.invoke('computer:agentStatus', request),
    agentStop: (request: any) => ipcRenderer.invoke('computer:agentStop', request),
    cancelSession: (request: any) => ipcRenderer.invoke('computer:cancelSession', request),
    health: () => ipcRenderer.invoke('computer:health'),
    onProgress: (callback: any) => {
      ipcRenderer.on('computer:progress', callback);
    },
    offProgress: (callback: any) => {
      ipcRenderer.removeListener('computer:progress', callback);
    },
  },

  // Services (对齐 Tauri services_restart_all)
  services: {
    restartAll: () => ipcRenderer.invoke('services:restartAll'),
    stopAll: () => ipcRenderer.invoke('services:stopAll'),
  },

  // Tray status sync
  tray: {
    updateStatus: (status: 'running' | 'stopped' | 'error' | 'starting') =>
      ipcRenderer.invoke('tray:updateStatus', status),
    updateServicesStatus: (running: boolean) =>
      ipcRenderer.invoke('tray:updateServicesStatus', running),
  },

  // Dependency management
  dependencies: {
    checkAll: (options?: { checkLatest?: boolean }) =>
      ipcRenderer.invoke('dependencies:checkAll', options),
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

  // Mirror / Registry
  mirror: {
    get: () => ipcRenderer.invoke('mirror:get'),
    set: (config: { npmRegistry?: string; uvIndexUrl?: string }) =>
      ipcRenderer.invoke('mirror:set', config),
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

  // Long-term Memory
  memory: {
    // Lifecycle
    init: (workspaceDir: string, config?: any) =>
      ipcRenderer.invoke('memory:init', workspaceDir, config),
    destroy: () =>
      ipcRenderer.invoke('memory:destroy'),
    status: () =>
      ipcRenderer.invoke('memory:status'),
    ensureReady: () =>
      ipcRenderer.invoke('memory:ensureReady') as Promise<{ ready: boolean; synced: boolean }>,

    // Configuration
    getConfig: () =>
      ipcRenderer.invoke('memory:getConfig'),
    updateConfig: (config: any) =>
      ipcRenderer.invoke('memory:updateConfig', config),

    // Extraction
    extract: (sessionId: string, messageId: string, messages: any[], modelConfig: any) =>
      ipcRenderer.invoke('memory:extract', sessionId, messageId, messages, modelConfig),
    append: (content: string, title?: string) =>
      ipcRenderer.invoke('memory:append', content, title),
    handleMessage: (message: { role: 'user' | 'assistant'; content: string }, sessionId: string, modelConfig: any) =>
      ipcRenderer.invoke('memory:handleMessage', message, sessionId, modelConfig) as Promise<{ success: boolean; error?: string }>,
    onSessionEnd: (sessionId: string, modelConfig: any) =>
      ipcRenderer.invoke('memory:onSessionEnd', sessionId, modelConfig) as Promise<{ success: boolean; taskId?: string; error?: string }>,
    getExtractionProgress: (sessionId: string) =>
      ipcRenderer.invoke('memory:getExtractionProgress', sessionId) as Promise<{ success: boolean; progress?: any[]; error?: string }>,

    // Retrieval
    search: (query: string, options?: any) =>
      ipcRenderer.invoke('memory:search', query, options),
    getContext: (query: string, options?: any) =>
      ipcRenderer.invoke('memory:getContext', query, options),

    // File operations
    sync: () =>
      ipcRenderer.invoke('memory:sync'),
    rebuildIndex: () =>
      ipcRenderer.invoke('memory:rebuildIndex'),
    getFiles: () =>
      ipcRenderer.invoke('memory:getFiles'),

    // Management
    add: (entry: any) =>
      ipcRenderer.invoke('memory:add', entry),
    update: (id: string, updates: any) =>
      ipcRenderer.invoke('memory:update', id, updates),
    delete: (id: string) =>
      ipcRenderer.invoke('memory:delete', id),
    list: (options?: any) =>
      ipcRenderer.invoke('memory:list', options),

    // Scheduled tasks
    runConsolidation: (modelConfig?: { provider: string; model: string; apiKey: string; baseUrl?: string }) =>
      ipcRenderer.invoke('memory:runConsolidation', modelConfig),
    runCleanup: () =>
      ipcRenderer.invoke('memory:runCleanup'),

    // Vector
    checkVectorSupport: () =>
      ipcRenderer.invoke('memory:checkVectorSupport'),
    setEmbeddingConfig: (config: any) =>
      ipcRenderer.invoke('memory:setEmbeddingConfig', config),

    // Queue status
    getQueueStatus: () =>
      ipcRenderer.invoke('memory:getQueueStatus'),
    getSchedulerStatus: () =>
      ipcRenderer.invoke('memory:getSchedulerStatus'),
  },

  // Log
  log: {
    getDir: () => ipcRenderer.invoke('log:getDir'),
    openDir: () => ipcRenderer.invoke('log:openDir'),
    list: (count?: number, offset?: number) => ipcRenderer.invoke('log:list', count, offset),
  },

  // App
  app: {
    checkUpdate: () => ipcRenderer.invoke('app:checkUpdate'),
    getVersion: () => ipcRenderer.invoke('app:getVersion'),
    downloadUpdate: () => ipcRenderer.invoke('app:downloadUpdate'),
    installUpdate: () => ipcRenderer.invoke('app:installUpdate'),
    getUpdateState: () => ipcRenderer.invoke('app:getUpdateState'),
    openReleasesPage: () => ipcRenderer.invoke('app:openReleasesPage'),
    getDeviceId: () => ipcRenderer.invoke('app:getDeviceId'),
  },

  // Permissions (macOS)
  permissions: {
    check: () => ipcRenderer.invoke('permissions:check'),
    openSettings: (permissionKey: string) => ipcRenderer.invoke('permissions:openSettings', permissionKey),
  },

  // Quick Init — 读取快捷初始化配置
  quickInit: {
    getConfig: () => ipcRenderer.invoke('quickInit:getConfig'),
  },

  // Event listeners
  // 保存 callback → wrapper 映射，使 off() 能正确移除 on() 注册的 listener
  on: (channel: string, callback: (...args: unknown[]) => void) => {
    const validChannels = ['menu:new-session', 'menu:settings', 'menu:mcp-settings', 'menu:dependencies', 'cowork:message', 'cowork:permission', 'agent:event', 'computer:progress', 'update:status', 'deps:syncCompleted', 'autolaunch:changed', 'memory:sync', 'memory:consolidation', 'memory:cleanup'];
    if (validChannels.includes(channel)) {
      const wrapper = (_: unknown, ...args: unknown[]) => callback(...args);
      (callback as any).__ipcWrapper = wrapper;
      ipcRenderer.on(channel, wrapper as any);
    }
  },

  off: (channel: string, callback: (...args: unknown[]) => void) => {
    const wrapper = (callback as any).__ipcWrapper || callback;
    ipcRenderer.removeListener(channel, wrapper);
  },
});
