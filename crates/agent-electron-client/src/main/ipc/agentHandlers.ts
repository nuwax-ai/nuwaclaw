import { ipcMain } from "electron";
import log from "electron-log";
import { agentService } from "../services/engines/unifiedAgent";
import type { AgentConfig } from "../services/engines/unifiedAgent";
import {
  mcpProxyManager,
  syncMcpConfigToProxyAndReload,
} from "../services/packages/mcp";

export function registerAgentHandlers(): void {
  // Initialize unified agent service
  ipcMain.handle("agent:init", async (_, config: AgentConfig) => {
    log.info("[IPC] Initializing unified agent:", config.engine);
    try {
      // Auto-inject MCP config if MCP proxy is running and no mcpServers provided
      let finalConfig = config;
      if (!config.mcpServers) {
        const mcpConfig = mcpProxyManager.getAgentMcpConfig();
        if (mcpConfig) {
          finalConfig = { ...config, mcpServers: mcpConfig };
          log.info(
            "[IPC] Auto-injected MCP config into agent:",
            Object.keys(mcpConfig),
          );
        }
      }
      const ok = await agentService.init(finalConfig);

      // 仅当调用方显式传入 mcpServers（原始服务器列表）时，同步到 MCP Proxy 并动态加载
      // auto-inject 时 finalConfig.mcpServers 是桥接配置，不能写回 proxy
      if (config.mcpServers && Object.keys(config.mcpServers).length > 0) {
        await syncMcpConfigToProxyAndReload(config.mcpServers);
      }

      return {
        success: ok,
        engineType: agentService.getEngineType(),
      };
    } catch (error) {
      log.error("[IPC] agent:init failed:", error);
      return { success: false, error: String(error) };
    }
  });

  // Get agent service status
  ipcMain.handle("agent:serviceStatus", () => {
    return {
      running: agentService.isReady,
      engineType: agentService.getEngineType(),
    };
  });

  // Destroy unified agent service
  ipcMain.handle("agent:destroy", async () => {
    try {
      await agentService.destroy();
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // Get engine type
  ipcMain.handle("agent:getEngineType", () => {
    return agentService.getEngineType();
  });

  // Check if ready
  ipcMain.handle("agent:isReady", () => {
    return agentService.isReady;
  });

  // List sessions
  ipcMain.handle("agent:listSessions", async () => {
    try {
      const sessions = await agentService.listSessions();
      return { success: true, data: sessions };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // Create session
  ipcMain.handle(
    "agent:createSession",
    async (_, opts?: { parentID?: string; title?: string }) => {
      try {
        const session = await agentService.createSession(opts);
        return { success: true, data: session };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    },
  );

  // Get session
  ipcMain.handle("agent:getSession", async (_, id: string) => {
    try {
      const session = await agentService.getSession(id);
      return { success: true, data: session };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // Delete session
  ipcMain.handle("agent:deleteSession", async (_, id: string) => {
    try {
      await agentService.deleteSession(id);
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // Update session title (ACP doesn't support this, but keep for compatibility)
  ipcMain.handle(
    "agent:updateSession",
    async (_, id: string, title?: string) => {
      try {
        // ACP doesn't have a separate update method, title is set via session info updates
        // Return success for compatibility
        return { success: true, data: { id, title } };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    },
  );

  // Get session status (ACP doesn't have this, return empty for compatibility)
  ipcMain.handle("agent:getSessionStatus", async () => {
    try {
      return { success: true, data: {} };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // Get messages (ACP doesn't store messages, return empty for compatibility)
  ipcMain.handle("agent:getMessages", async () => {
    try {
      return { success: true, data: [] };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // Get single message (ACP doesn't store messages, return error for compatibility)
  ipcMain.handle(
    "agent:getMessage",
    async (_, sessionId: string, messageId: string) => {
      try {
        return { success: false, error: "ACP engine does not store messages" };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    },
  );

  // Prompt (blocking)
  ipcMain.handle(
    "agent:prompt",
    async (_, sessionId: string, parts: any[], opts?: any) => {
      try {
        const result = await agentService.prompt(sessionId, parts, opts);
        return { success: true, data: result };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    },
  );

  // Prompt (async, non-blocking - results via SSE events)
  ipcMain.handle(
    "agent:promptAsync",
    async (_, sessionId: string, parts: any[], opts?: any) => {
      try {
        await agentService.promptAsync(sessionId, parts, opts);
        return { success: true };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    },
  );

  // Abort session
  ipcMain.handle("agent:abort", async (_, sessionId?: string) => {
    try {
      await agentService.abortSession(sessionId || "");
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // Respond to permission request
  ipcMain.handle(
    "agent:respondPermission",
    async (_, permissionId: string, response: "once" | "always" | "reject") => {
      try {
        agentService.respondPermission(permissionId, response);
        return { success: true };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    },
  );

  // List tools (ACP doesn't support this, return empty for compatibility)
  ipcMain.handle("agent:listTools", async () => {
    try {
      return { success: true, data: [] };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // List providers (ACP doesn't support this, return empty for compatibility)
  ipcMain.handle("agent:listProviders", async () => {
    try {
      return { success: true, data: [] };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // Get session diff (ACP doesn't support this, return empty for compatibility)
  ipcMain.handle("agent:getSessionDiff", async () => {
    try {
      return { success: true, data: [] };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // Revert session (ACP doesn't support this, return error for compatibility)
  ipcMain.handle("agent:revert", async () => {
    try {
      return { success: false, error: "ACP engine does not support revert" };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // Unrevert session (ACP doesn't support this, return error for compatibility)
  ipcMain.handle("agent:unrevert", async () => {
    try {
      return { success: false, error: "ACP engine does not support unrevert" };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // Share session (ACP doesn't support this, return error for compatibility)
  ipcMain.handle("agent:shareSession", async () => {
    try {
      return { success: false, error: "ACP engine does not support share" };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // Fork session (ACP doesn't support this, return error for compatibility)
  ipcMain.handle("agent:forkSession", async () => {
    try {
      return { success: false, error: "ACP engine does not support fork" };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // Get config (ACP doesn't support this, return empty for compatibility)
  ipcMain.handle("agent:getConfig", async () => {
    try {
      return { success: true, data: {} };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // Find text (ACP doesn't support this, return empty for compatibility)
  ipcMain.handle("agent:findText", async () => {
    try {
      return { success: true, data: [] };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // Find files (ACP doesn't support this, return empty for compatibility)
  ipcMain.handle("agent:findFiles", async () => {
    try {
      return { success: true, data: [] };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // List files (ACP doesn't support this, return empty for compatibility)
  ipcMain.handle("agent:listFiles", async () => {
    try {
      return { success: true, data: [] };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // Read file (ACP doesn't support this, return error for compatibility)
  ipcMain.handle("agent:readFile", async () => {
    try {
      return { success: false, error: "ACP engine does not support readFile" };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // Claude Code prompt (ACP engine)
  ipcMain.handle("agent:claudePrompt", async (_, message: string) => {
    try {
      const result = await agentService.claudePrompt(message);
      return { success: true, data: result };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // MCP status (ACP doesn't support this, return empty for compatibility)
  ipcMain.handle("agent:mcpStatus", async () => {
    try {
      return { success: true, data: {} };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // List agents (ACP doesn't support this, return empty for compatibility)
  ipcMain.handle("agent:listAgents", async () => {
    try {
      return { success: true, data: [] };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // List commands (ACP doesn't support this, return empty for compatibility)
  ipcMain.handle("agent:listCommands", async () => {
    try {
      return { success: true, data: [] };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // List all sessions with detailed status (for Sessions tab)
  ipcMain.handle("agent:listSessionsDetailed", async () => {
    try {
      const sessions = agentService.listAllSessionsDetailed();
      return { success: true, data: sessions };
    } catch (error) {
      log.error("[IPC] agent:listSessionsDetailed failed:", error);
      return { success: false, error: String(error), data: [] };
    }
  });

  // Stop a specific session (abort + delete from engine)
  ipcMain.handle("agent:stopSession", async (_, sessionId: string) => {
    try {
      const stopped = await agentService.stopSession(sessionId);
      return { success: stopped };
    } catch (error) {
      log.error("[IPC] agent:stopSession failed:", error);
      return { success: false, error: String(error) };
    }
  });
}
