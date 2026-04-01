/**
 * MCP Server with dual transport:
 * - HTTP mode (primary): Streamable HTTP on 127.0.0.1:<port>/mcp
 * - stdio mode (backup): single StdioServerTransport
 *
 * HTTP mode manages per-session Server + Transport instances.
 */

import * as http from 'http';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import type { GuiAgentConfig } from '../config.js';
import { AuditLog } from '../safety/auditLog.js';
import { ATOMIC_TOOLS, handleAtomicToolCall } from './atomicTools.js';
import { TASK_TOOLS, handleTaskTool } from './taskTools.js';
import { registerResources } from './resources.js';
import { logInfo, logWarn, logError } from '../utils/logger.js';

const MCP_SESSION_ID_HEADER = 'mcp-session-id';
const SESSION_CLEANUP_INTERVAL_MS = 60_000;

interface HttpSession {
  server: Server;
  transport: StreamableHTTPServerTransport;
  lastActivity: number;
}

function createMcpServer(config: GuiAgentConfig, auditLog: AuditLog): Server {
  const server = new Server(
    { name: 'gui-agent-server', version: process.env.__GUI_AGENT_PKG_VERSION__ ?? '0.1.0' },
    { capabilities: { tools: {}, resources: {} } },
  );

  // Unified tool registration — combines atomic tools + task tools
  const allTools = [...ATOMIC_TOOLS, ...TASK_TOOLS];

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: allTools,
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    const { name, arguments: args = {} } = request.params;

    // Try atomic tools first
    const atomicResult = await handleAtomicToolCall(name, args, config, auditLog);
    if (atomicResult !== null) return atomicResult;

    // Try task tools
    const taskResult = await handleTaskTool(name, args, config, auditLog, {
      signal: extra.signal,
      sendNotification: extra.sendNotification?.bind(extra) as any,
    });
    if (taskResult !== null) return taskResult;

    return { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true };
  });

  registerResources(server, config, auditLog);
  return server;
}

export interface GuiAgentServer {
  start(): Promise<void>;
  stop(): Promise<void>;
}

export function createGuiAgentServer(config: GuiAgentConfig): GuiAgentServer {
  const auditLog = new AuditLog();

  if (config.transport === 'stdio') {
    return createStdioServer(config, auditLog);
  }
  return createHttpServer(config, auditLog);
}

function createStdioServer(config: GuiAgentConfig, auditLog: AuditLog): GuiAgentServer {
  const server = createMcpServer(config, auditLog);
  let transport: StdioServerTransport | null = null;

  return {
    async start() {
      transport = new StdioServerTransport();
      await server.connect(transport);
      logInfo('MCP Server running on stdio');
    },
    async stop() {
      if (transport) {
        await server.close();
        transport = null;
      }
    },
  };
}

function createHttpServer(config: GuiAgentConfig, auditLog: AuditLog): GuiAgentServer {
  const sessions = new Map<string, HttpSession>();
  let httpServer: http.Server | null = null;
  let cleanupTimer: ReturnType<typeof setInterval> | null = null;

  function getOrCreateSession(sessionId: string | undefined, res: http.ServerResponse): HttpSession | null {
    // Existing session
    if (sessionId && sessions.has(sessionId)) {
      const session = sessions.get(sessionId)!;
      session.lastActivity = Date.now();
      return session;
    }

    // New session — only allowed when no sessionId header (initial request)
    if (sessionId) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Session not found' }));
      return null;
    }

    const server = createMcpServer(config, auditLog);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => crypto.randomUUID(),
      onsessioninitialized: (id) => {
        logInfo(`HTTP session created: ${id}`);
        sessions.set(id, { server, transport, lastActivity: Date.now() });
      },
    });

    server.connect(transport);
    return { server, transport, lastActivity: Date.now() };
  }

  async function handleRequest(req: http.IncomingMessage, res: http.ServerResponse) {
    const url = new URL(req.url ?? '/', `http://${req.headers.host}`);

    if (url.pathname !== '/mcp') {
      res.writeHead(404);
      res.end('Not found');
      return;
    }

    const sessionId = req.headers[MCP_SESSION_ID_HEADER] as string | undefined;

    if (req.method === 'DELETE') {
      if (sessionId && sessions.has(sessionId)) {
        const session = sessions.get(sessionId)!;
        try { await session.transport.close(); } catch { /* ignore */ }
        sessions.delete(sessionId);
        logInfo(`HTTP session closed: ${sessionId}`);
      }
      res.writeHead(200);
      res.end();
      return;
    }

    if (req.method === 'GET' || req.method === 'POST') {
      const session = getOrCreateSession(sessionId, res);
      if (!session) return;

      try {
        await session.transport.handleRequest(req, res);
      } catch (err) {
        logError(`HTTP request error: ${err instanceof Error ? err.message : String(err)}`);
        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Internal server error' }));
        }
      }
      return;
    }

    res.writeHead(405);
    res.end('Method not allowed');
  }

  function cleanupStaleSessions() {
    const now = Date.now();
    const staleThreshold = 5 * 60 * 1000; // 5 minutes
    for (const [id, session] of sessions) {
      if (now - session.lastActivity > staleThreshold) {
        logInfo(`Cleaning up stale session: ${id}`);
        session.transport.close().catch(() => {});
        sessions.delete(id);
      }
    }
  }

  return {
    async start() {
      httpServer = http.createServer(handleRequest);

      await new Promise<void>((resolve, reject) => {
        httpServer!.listen(config.port, '127.0.0.1', () => {
          logInfo(`MCP Server running on http://127.0.0.1:${config.port}/mcp`);
          resolve();
        });
        httpServer!.on('error', reject);
      });

      cleanupTimer = setInterval(cleanupStaleSessions, SESSION_CLEANUP_INTERVAL_MS);
    },
    async stop() {
      if (cleanupTimer) {
        clearInterval(cleanupTimer);
        cleanupTimer = null;
      }

      // Close all sessions
      await Promise.all(
        Array.from(sessions.entries()).map(async ([id, session]) => {
          try { await session.transport.close(); } catch { /* ignore */ }
        }),
      );
      sessions.clear();

      // Close HTTP server
      if (httpServer) {
        await new Promise<void>((resolve) => {
          httpServer!.close(() => resolve());
        });
        httpServer = null;
      }

      logInfo('MCP Server stopped');
    },
  };
}
