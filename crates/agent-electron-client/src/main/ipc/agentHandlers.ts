import { ipcMain } from "electron";
import log from "electron-log";
import { z } from "zod";
import { agentService } from "../services/engines/unifiedAgent";
import type { AgentConfig } from "../services/engines/unifiedAgent";
import {
  mcpProxyManager,
  syncMcpConfigToProxyAndReload,
} from "../services/packages/mcp";

const agentConfigSchema = z
  .object({
    engine: z.enum(["nuwaxcode", "claude-code"]),
    workspaceDir: z.string(),
    apiKey: z.string().optional(),
    baseUrl: z.string().optional(),
    model: z.string().optional(),
    apiProtocol: z.string().optional(),
    hostname: z.string().optional(),
    port: z.number().int().positive().optional(),
    timeout: z.number().int().positive().optional(),
    engineBinaryPath: z.string().optional(),
    env: z.record(z.string()).optional(),
    mcpServers: z.record(z.unknown()).optional(),
    permissionMode: z
      .enum(["default", "acceptEdits", "bypassPermissions"])
      .optional(),
    systemPrompt: z.string().optional(),
    purpose: z.enum(["engine"]).optional(),
  })
  .passthrough();

const sessionIdSchema = z.string().min(1);
const partsSchema = z.array(z.any());
const promptOptionsSchema = z.any().optional();
const permissionResponseSchema = z.enum(["once", "always", "reject"]);

function invalidArgs(channel: string, issues: unknown) {
  log.warn(`[IPC] ${channel} invalid args:`, issues);
  return { success: false, error: `Invalid arguments for ${channel}` };
}

export function registerAgentHandlers(): void {
  // Initialize unified agent service
  ipcMain.handle("agent:init", async (_, config: AgentConfig) => {
    const parsedConfig = agentConfigSchema.safeParse(config);
    if (!parsedConfig.success) {
      return invalidArgs("agent:init", parsedConfig.error.issues);
    }
    const typedConfig = parsedConfig.data as AgentConfig;

    log.info("[IPC] Initializing unified agent:", config.engine);
    try {
      // Auto-inject MCP config if MCP proxy is running and no mcpServers provided
      let finalConfig: AgentConfig = typedConfig;
      if (!typedConfig.mcpServers) {
        const mcpConfig = mcpProxyManager.getAgentMcpConfig();
        if (mcpConfig) {
          finalConfig = { ...typedConfig, mcpServers: mcpConfig };
          log.info(
            "[IPC] Auto-injected MCP config into agent:",
            Object.keys(mcpConfig),
          );
        }
      }
      const ok = await agentService.init(finalConfig);

      // 仅当调用方显式传入 mcpServers（原始服务器列表）时，同步到 MCP Proxy 并动态加载
      // auto-inject 时 finalConfig.mcpServers 是桥接配置，不能写回 proxy
      if (
        typedConfig.mcpServers &&
        Object.keys(typedConfig.mcpServers).length > 0
      ) {
        await syncMcpConfigToProxyAndReload(typedConfig.mcpServers);
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
      const sid = sessionIdSchema.safeParse(sessionId);
      const ps = partsSchema.safeParse(parts);
      const op = promptOptionsSchema.safeParse(opts);
      if (!sid.success || !ps.success || !op.success) {
        return invalidArgs("agent:prompt", {
          sessionId: sid.success ? null : sid.error.issues,
          parts: ps.success ? null : ps.error.issues,
          opts: op.success ? null : op.error.issues,
        });
      }
      try {
        const result = await agentService.prompt(sid.data, ps.data, op.data);
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
      const sid = sessionIdSchema.safeParse(sessionId);
      const ps = partsSchema.safeParse(parts);
      const op = promptOptionsSchema.safeParse(opts);
      if (!sid.success || !ps.success || !op.success) {
        return invalidArgs("agent:promptAsync", {
          sessionId: sid.success ? null : sid.error.issues,
          parts: ps.success ? null : ps.error.issues,
          opts: op.success ? null : op.error.issues,
        });
      }
      try {
        await agentService.promptAsync(sid.data, ps.data, op.data);
        return { success: true };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    },
  );

  // Abort session
  ipcMain.handle("agent:abort", async (_, sessionId?: string) => {
    if (sessionId !== undefined) {
      const sid = sessionIdSchema.safeParse(sessionId);
      if (!sid.success) {
        return invalidArgs("agent:abort", sid.error.issues);
      }
    }
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
    async (
      _,
      _sessionId: string,
      permissionId: string,
      response: "once" | "always" | "reject",
    ) => {
      const pid = z.string().min(1).safeParse(permissionId);
      const rsp = permissionResponseSchema.safeParse(response);
      if (!pid.success || !rsp.success) {
        return invalidArgs("agent:respondPermission", {
          permissionId: pid.success ? null : pid.error.issues,
          response: rsp.success ? null : rsp.error.issues,
        });
      }
      try {
        agentService.respondPermission(pid.data, rsp.data);
        return { success: true };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    },
  );

  // Respond to model switch confirmation (T3.3)
  ipcMain.handle(
    "agent:respondModelSwitch",
    async (_, requestId: string, approved: boolean) => {
      const rid = z.string().min(1).safeParse(requestId);
      if (!rid.success) {
        return invalidArgs("agent:respondModelSwitch", {
          requestId: rid.error.issues,
        });
      }
      try {
        agentService.respondModelSwitch(rid.data, !!approved);
        return { success: true };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    },
  );

  // Respond to checkpoint confirmation (T3.5)
  ipcMain.handle("agent:respondCheckpoint", async (_, sessionId: string) => {
    const sid = z.string().min(1).safeParse(sessionId);
    if (!sid.success) {
      return invalidArgs("agent:respondCheckpoint", {
        sessionId: sid.error.issues,
      });
    }
    try {
      agentService.respondCheckpoint(sid.data);
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

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
