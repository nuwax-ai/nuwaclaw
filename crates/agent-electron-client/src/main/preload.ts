import { contextBridge, ipcRenderer } from 'electron';

// Expose protected methods to the renderer process
contextBridge.exposeInMainWorld('electronAPI', {
  // Session management
  session: {
    list: () => ipcRenderer.invoke('session:list'),
    create: (session: { id: string; title: string; model: string; system_prompt?: string }) =>
      ipcRenderer.invoke('session:create', session),
    delete: (sessionId: string) => ipcRenderer.invoke('session:delete', sessionId),
  },

  // Message management
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

  // Agent (nuwaxcode/claude-code) management
  agent: {
    start: (config: { type: 'nuwaxcode' | 'claude-code'; binPath: string; env: Record<string, string>; apiKey?: string; apiBaseUrl?: string; model?: string }) =>
      ipcRenderer.invoke('agent:start', config),
    stop: () =>
      ipcRenderer.invoke('agent:stop'),
    status: () =>
      ipcRenderer.invoke('agent:status'),
    send: (message: string) =>
      ipcRenderer.invoke('agent:send', message),
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

  // Event listeners
  on: (channel: string, callback: (...args: unknown[]) => void) => {
    const validChannels = ['menu:new-session', 'menu:settings', 'menu:mcp-settings', 'cowork:message', 'cowork:permission'];
    if (validChannels.includes(channel)) {
      ipcRenderer.on(channel, (_, ...args) => callback(...args));
    }
  },

  off: (channel: string, callback: (...args: unknown[]) => void) => {
    ipcRenderer.removeListener(channel, callback);
  },
});
