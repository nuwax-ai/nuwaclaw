import { ipcMain } from 'electron';
import log from 'electron-log';
import { agentService } from '../../services/main/engines/unifiedAgent';
import type { AgentConfig } from '../../services/main/engines/unifiedAgent';
import { mcpProxyManager } from '../../services/main/packages/mcp';

export function registerAgentHandlers(): void {
  // Initialize unified agent service
  ipcMain.handle('agent:init', async (_, config: AgentConfig) => {
    log.info('[IPC] Initializing unified agent:', config.engine);
    try {
      // Auto-inject MCP config if MCP proxy is running and no mcpServers provided
      let finalConfig = config;
      if (!config.mcpServers) {
        const mcpConfig = mcpProxyManager.getAgentMcpConfig();
        if (mcpConfig) {
          finalConfig = { ...config, mcpServers: mcpConfig };
          log.info('[IPC] Auto-injected MCP config into agent:', Object.keys(mcpConfig));
        }
      }
      const ok = await agentService.init(finalConfig);

      return {
        success: ok,
        engineType: agentService.getEngineType(),
      };
    } catch (error) {
      log.error('[IPC] agent:init failed:', error);
      return { success: false, error: String(error) };
    }
  });

  // Get agent service status
  ipcMain.handle('agent:serviceStatus', () => {
    return {
      running: agentService.isReady,
      engineType: agentService.getEngineType(),
    };
  });

  // Destroy unified agent service
  ipcMain.handle('agent:destroy', async () => {
    try {
      await agentService.destroy();
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // Get engine type
  ipcMain.handle('agent:getEngineType', () => {
    return agentService.getEngineType();
  });

  // Check if ready
  ipcMain.handle('agent:isReady', () => {
    return agentService.isReady;
  });

  // List SDK sessions
  ipcMain.handle('agent:listSessions', async () => {
    try {
      const sessions = await agentService.listSessions();
      return { success: true, data: sessions };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // Create SDK session
  ipcMain.handle('agent:createSession', async (_, opts?: { parentID?: string; title?: string }) => {
    try {
      const session = await agentService.createSession(opts);
      return { success: true, data: session };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // Get SDK session
  ipcMain.handle('agent:getSession', async (_, id: string) => {
    try {
      const session = await agentService.getSession(id);
      return { success: true, data: session };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // Delete SDK session
  ipcMain.handle('agent:deleteSession', async (_, id: string) => {
    try {
      await agentService.deleteSession(id);
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // Update SDK session
  ipcMain.handle('agent:updateSession', async (_, id: string, title?: string) => {
    try {
      const session = await agentService.updateSession(id, title);
      return { success: true, data: session };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // Get session status
  ipcMain.handle('agent:getSessionStatus', async () => {
    try {
      const status = await agentService.getSessionStatus();
      return { success: true, data: status };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // Get messages
  ipcMain.handle('agent:getMessages', async (_, sessionId: string, limit?: number) => {
    try {
      const messages = await agentService.getMessages(sessionId, limit);
      return { success: true, data: messages };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // Get single message
  ipcMain.handle('agent:getMessage', async (_, sessionId: string, messageId: string) => {
    try {
      const message = await agentService.getMessage(sessionId, messageId);
      return { success: true, data: message };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // Prompt (blocking)
  ipcMain.handle('agent:prompt', async (_, sessionId: string, parts: any[], opts?: any) => {
    try {
      const result = await agentService.prompt(sessionId, parts, opts);
      return { success: true, data: result };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // Prompt (async, non-blocking - results via SSE events)
  ipcMain.handle('agent:promptAsync', async (_, sessionId: string, parts: any[], opts?: any) => {
    try {
      await agentService.promptAsync(sessionId, parts, opts);
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // Command
  ipcMain.handle('agent:command', async (_, sessionId: string, cmd: string, args?: string, opts?: any) => {
    try {
      const result = await agentService.command(sessionId, cmd, args, opts);
      return { success: true, data: result };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // Shell
  ipcMain.handle('agent:shell', async (_, sessionId: string, cmd: string, agent?: string, model?: any) => {
    try {
      const result = await agentService.shell(sessionId, cmd, agent, model);
      return { success: true, data: result };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // Abort session
  ipcMain.handle('agent:abort', async (_, sessionId: string) => {
    try {
      await agentService.abortSession(sessionId);
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // Respond to permission request
  ipcMain.handle('agent:respondPermission', async (_, sessionId: string, permissionId: string, response: 'once' | 'always' | 'reject') => {
    try {
      await agentService.respondPermission(sessionId, permissionId, response);
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // List tools
  ipcMain.handle('agent:listTools', async (_, provider?: string, model?: string) => {
    try {
      const tools = await agentService.listTools(provider, model);
      return { success: true, data: tools };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // List providers
  ipcMain.handle('agent:listProviders', async () => {
    try {
      const providers = await agentService.listProviders();
      return { success: true, data: providers };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // Get session diff
  ipcMain.handle('agent:getSessionDiff', async (_, sessionId: string, messageId?: string) => {
    try {
      const diffs = await agentService.diffSession(sessionId, messageId);
      return { success: true, data: diffs };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // Revert session
  ipcMain.handle('agent:revert', async (_, sessionId: string, messageId: string, partId?: string) => {
    try {
      const session = await agentService.revertSession(sessionId, messageId, partId);
      return { success: true, data: session };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // Unrevert session
  ipcMain.handle('agent:unrevert', async (_, sessionId: string) => {
    try {
      const session = await agentService.unrevertSession(sessionId);
      return { success: true, data: session };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // Share session
  ipcMain.handle('agent:shareSession', async (_, sessionId: string) => {
    try {
      const session = await agentService.shareSession(sessionId);
      return { success: true, data: session };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // Fork session
  ipcMain.handle('agent:forkSession', async (_, sessionId: string, messageId?: string) => {
    try {
      const session = await agentService.forkSession(sessionId, messageId);
      return { success: true, data: session };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // Get config
  ipcMain.handle('agent:getConfig', async () => {
    try {
      const config = await agentService.getConfig();
      return { success: true, data: config };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // Find text
  ipcMain.handle('agent:findText', async (_, pattern: string) => {
    try {
      const results = await agentService.findText(pattern);
      return { success: true, data: results };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // Find files
  ipcMain.handle('agent:findFiles', async (_, query: string, dirs?: boolean) => {
    try {
      const results = await agentService.findFiles(query, dirs);
      return { success: true, data: results };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // List files
  ipcMain.handle('agent:listFiles', async (_, dirPath: string) => {
    try {
      const results = await agentService.listFiles(dirPath);
      return { success: true, data: results };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // Read file
  ipcMain.handle('agent:readFile', async (_, filePath: string) => {
    try {
      const result = await agentService.readFile(filePath);
      return { success: true, data: result };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // Claude Code prompt (CLI engine)
  ipcMain.handle('agent:claudePrompt', async (_, message: string) => {
    try {
      const result = await agentService.claudePrompt(message);
      return { success: true, data: result };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // MCP status via SDK
  ipcMain.handle('agent:mcpStatus', async () => {
    try {
      const result = await agentService.mcpStatus();
      return { success: true, data: result };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // List agents
  ipcMain.handle('agent:listAgents', async () => {
    try {
      const result = await agentService.listAgents();
      return { success: true, data: result };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // List commands
  ipcMain.handle('agent:listCommands', async () => {
    try {
      const result = await agentService.listCommands();
      return { success: true, data: result };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });
}
