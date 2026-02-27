/**
 * PersistentMcpBridge — Electron 主进程内置的持久化 MCP Server Bridge
 *
 * 将需要长生命周期的 MCP server（如 chrome-devtools-mcp）从 ACP session
 * 中拉出来，由 Electron 主进程管理。通过 HTTP bridge 供每个 ACP session
 * 连接（via mcp-bridge-client.mjs）。
 *
 * 架构:
 *   persistent child process (stdio)
 *     ↕ StdioClientTransport
 *   MCP Client (缓存 tools, 代理 callTool)
 *     ↕
 *   HTTP Server (单端口, 路径路由 /mcp/<serverId>)
 *     ↕ StreamableHTTPServerTransport (per HTTP session)
 *   MCP Server (tool handlers → Client.callTool)
 */

import * as http from 'http';
import log from 'electron-log';
import type { McpServerEntry } from './mcp';

// MCP SDK types — import from CJS paths (require .js suffix for wildcard exports)
import { Client } from '@modelcontextprotocol/sdk/client';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { Server } from '@modelcontextprotocol/sdk/server';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';

const LOG_TAG = '[PersistentMcpBridge]';
const RESTART_COOLDOWN_MS = 5_000;
const MAX_BODY_SIZE = 10 * 1024 * 1024; // 10 MB
const SESSION_CLEANUP_INTERVAL_MS = 60_000; // 1 minute

// ========== Types ==========

interface PersistentServerEntry {
  config: McpServerEntry;
  client: Client | null;
  transport: StdioClientTransport | null;
  tools: Tool[];
  healthy: boolean;
  restarting: boolean;
  restartTimer: ReturnType<typeof setTimeout> | null;
}

/** session ID → { server, transport } */
interface HttpSession {
  server: Server;
  transport: StreamableHTTPServerTransport;
}

// ========== PersistentMcpBridge ==========

class PersistentMcpBridge {
  private httpServer: http.Server | null = null;
  private port = 0;
  private servers = new Map<string, PersistentServerEntry>();
  /** "serverId:sessionId" → HttpSession */
  private httpSessions = new Map<string, HttpSession>();
  private running = false;
  private sessionCleanupTimer: ReturnType<typeof setInterval> | null = null;

  /**
   * 启动 bridge: 为每个 persistent server spawn 子进程并创建 HTTP server
   */
  async start(servers: Record<string, McpServerEntry>): Promise<void> {
    if (this.running) {
      log.warn(`${LOG_TAG} Already running, stopping first`);
      await this.stop();
    }

    log.info(`${LOG_TAG} Starting with ${Object.keys(servers).length} persistent servers`);

    // 1. Spawn each persistent server + create MCP Client
    for (const [id, config] of Object.entries(servers)) {
      await this.startServer(id, config);
    }

    // 2. Start HTTP server
    await this.startHttpServer();
    this.running = true;

    // 3. Start periodic session cleanup
    this.sessionCleanupTimer = setInterval(() => this.cleanupStaleSessions(), SESSION_CLEANUP_INTERVAL_MS);

    log.info(`${LOG_TAG} Bridge ready on port ${this.port}`);
  }

  /**
   * 停止 bridge: 关闭 HTTP, kill 所有子进程
   */
  async stop(): Promise<void> {
    log.info(`${LOG_TAG} Stopping...`);
    this.running = false;

    // Stop session cleanup timer
    if (this.sessionCleanupTimer) {
      clearInterval(this.sessionCleanupTimer);
      this.sessionCleanupTimer = null;
    }

    // Close all HTTP sessions
    for (const [key, session] of this.httpSessions) {
      try {
        await session.transport.close();
      } catch (e) {
        log.warn(`${LOG_TAG} Error closing HTTP session ${key}:`, e);
      }
    }
    this.httpSessions.clear();

    // Close HTTP server
    if (this.httpServer) {
      await new Promise<void>((resolve) => {
        this.httpServer!.close(() => resolve());
      });
      this.httpServer = null;
      this.port = 0;
    }

    // Stop all persistent servers
    for (const [id] of this.servers) {
      await this.stopServer(id);
    }
    this.servers.clear();

    log.info(`${LOG_TAG} Stopped`);
  }

  /**
   * 获取 bridge URL (供 bridge client 连接)
   */
  getBridgeUrl(serverId: string): string | null {
    if (!this.running || !this.port) return null;
    const entry = this.servers.get(serverId);
    if (!entry || !entry.healthy) return null;
    return `http://127.0.0.1:${this.port}/mcp/${serverId}`;
  }

  /**
   * 是否有 server 在运行
   */
  isRunning(): boolean {
    return this.running && this.port > 0;
  }

  /**
   * 健康检查
   */
  isServerHealthy(serverId: string): boolean {
    return this.servers.get(serverId)?.healthy ?? false;
  }

  // ==================== Internal: Server Lifecycle ====================

  private async startServer(id: string, config: McpServerEntry): Promise<void> {
    const entry: PersistentServerEntry = {
      config,
      client: null,
      transport: null,
      tools: [],
      healthy: false,
      restarting: false,
      restartTimer: null,
    };
    this.servers.set(id, entry);

    await this.spawnAndConnect(id, entry);
  }

  private async spawnAndConnect(id: string, entry: PersistentServerEntry): Promise<void> {
    try {
      log.info(`${LOG_TAG} Spawning server "${id}": ${entry.config.command} ${(entry.config.args || []).join(' ')}`);

      // Create MCP Client + StdioClientTransport (handles spawn internally)
      const transport = new StdioClientTransport({
        command: entry.config.command,
        args: entry.config.args || [],
        env: entry.config.env,
        stderr: 'pipe',
      });

      const client = new Client(
        { name: 'nuwax-persistent-bridge', version: '1.0.0' },
        { capabilities: {} },
      );

      // Handle transport close → auto restart
      transport.onclose = () => {
        log.warn(`${LOG_TAG} Server "${id}" transport closed`);
        entry.healthy = false;
        if (this.running && !entry.restarting) {
          this.scheduleRestart(id, entry);
        }
      };

      transport.onerror = (err) => {
        log.error(`${LOG_TAG} Server "${id}" transport error:`, err.message);
      };

      // Connect client to transport (this starts the subprocess)
      await client.connect(transport);

      entry.client = client;
      entry.transport = transport;

      // Pipe stderr for debugging (using public API)
      const stderrStream = transport.stderr;
      if (stderrStream) {
        stderrStream.on('data', (chunk: Buffer) => {
          const text = chunk.toString().trim();
          if (text) log.info(`${LOG_TAG} [${id}:stderr] ${text}`);
        });
      }

      // List tools (cached)
      const result = await client.listTools();
      entry.tools = result.tools;
      entry.healthy = true;

      log.info(`${LOG_TAG} Server "${id}" ready with ${entry.tools.length} tools: ${entry.tools.map((t) => t.name).join(', ')}`);
    } catch (e) {
      log.error(`${LOG_TAG} Failed to start server "${id}":`, e);
      entry.healthy = false;
      if (this.running && !entry.restarting) {
        this.scheduleRestart(id, entry);
      }
    }
  }

  private scheduleRestart(id: string, entry: PersistentServerEntry): void {
    if (entry.restartTimer) return;
    entry.restarting = true;
    log.info(`${LOG_TAG} Scheduling restart for "${id}" in ${RESTART_COOLDOWN_MS}ms`);

    entry.restartTimer = setTimeout(async () => {
      entry.restartTimer = null;
      entry.restarting = false;
      if (!this.running) return;

      // Clean up old resources
      try {
        if (entry.client) await entry.client.close();
      } catch { /* ignore */ }
      try {
        if (entry.transport) await entry.transport.close();
      } catch { /* ignore */ }
      entry.client = null;
      entry.transport = null;

      log.info(`${LOG_TAG} Restarting server "${id}"...`);
      await this.spawnAndConnect(id, entry);
    }, RESTART_COOLDOWN_MS);
  }

  private async stopServer(id: string): Promise<void> {
    const entry = this.servers.get(id);
    if (!entry) return;

    if (entry.restartTimer) {
      clearTimeout(entry.restartTimer);
      entry.restartTimer = null;
    }
    entry.restarting = false;
    entry.healthy = false;

    // Capture PID before closing (transport.close() may invalidate the getter)
    const pid = entry.transport?.pid;

    try {
      if (entry.client) await entry.client.close();
    } catch (e) {
      log.warn(`${LOG_TAG} Error closing client for "${id}":`, e);
    }

    // transport.close() terminates the child process
    try {
      if (entry.transport) await entry.transport.close();
    } catch (e) {
      log.warn(`${LOG_TAG} Error closing transport for "${id}":`, e);
    }

    // Force kill via PID if still alive after transport.close()
    if (pid) {
      try {
        process.kill(pid, 0); // test if alive
        process.kill(pid, 'SIGTERM');
        setTimeout(() => {
          try {
            process.kill(pid, 0);
            process.kill(pid, 'SIGKILL');
          } catch { /* already dead */ }
        }, 2000);
      } catch { /* already dead */ }
    }

    entry.client = null;
    entry.transport = null;
  }

  // ==================== Internal: HTTP Server ====================

  private async startHttpServer(): Promise<void> {
    return new Promise((resolve, reject) => {
      const server = http.createServer((req, res) => {
        this.handleHttpRequest(req, res).catch((e) => {
          log.error(`${LOG_TAG} HTTP request error:`, e);
          if (!res.headersSent) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Internal server error' }));
          }
        });
      });

      // Listen on random port
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address();
        if (addr && typeof addr === 'object') {
          this.port = addr.port;
        }
        this.httpServer = server;
        log.info(`${LOG_TAG} HTTP server listening on 127.0.0.1:${this.port}`);
        resolve();
      });

      server.on('error', (err) => {
        log.error(`${LOG_TAG} HTTP server error:`, err);
        reject(err);
      });
    });
  }

  private async handleHttpRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const url = new URL(req.url || '/', `http://127.0.0.1:${this.port}`);
    const pathParts = url.pathname.split('/').filter(Boolean);

    // Route: /mcp/<serverId>
    if (pathParts.length !== 2 || pathParts[0] !== 'mcp') {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found. Use /mcp/<serverId>' }));
      return;
    }

    const serverId = pathParts[1];
    const serverEntry = this.servers.get(serverId);
    if (!serverEntry || !serverEntry.healthy || !serverEntry.client) {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `Server "${serverId}" not available` }));
      return;
    }

    // Handle DELETE → terminate session
    if (req.method === 'DELETE') {
      const sessionId = req.headers['mcp-session-id'] as string | undefined;
      if (sessionId) {
        const key = `${serverId}:${sessionId}`;
        const session = this.httpSessions.get(key);
        if (session) {
          try {
            await session.transport.close();
          } catch { /* ignore */ }
          this.httpSessions.delete(key);
        }
      }
      res.writeHead(200);
      res.end();
      return;
    }

    // POST or GET → route to session
    if (req.method === 'POST' || req.method === 'GET') {
      const sessionId = req.headers['mcp-session-id'] as string | undefined;

      // Try to find existing session
      if (sessionId) {
        const key = `${serverId}:${sessionId}`;
        const session = this.httpSessions.get(key);
        if (session) {
          if (req.method === 'POST') {
            const body = await this.readBody(req);
            await session.transport.handleRequest(req, res, body);
          } else {
            await session.transport.handleRequest(req, res);
          }
          return;
        }
      }

      // New session: only for POST (initialize request)
      if (req.method === 'POST') {
        const body = await this.readBody(req);
        const session = this.createHttpSession(serverId, serverEntry);
        await session.transport.handleRequest(req, res, body);

        // Register session immediately after first handleRequest (sessionId is now set)
        const sid = session.transport.sessionId;
        if (sid) {
          const key = `${serverId}:${sid}`;
          this.httpSessions.set(key, session);
          log.info(`${LOG_TAG} New HTTP session: ${key}`);
        }
        return;
      }

      // GET without session → 400
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Missing mcp-session-id header for GET' }));
      return;
    }

    res.writeHead(405);
    res.end();
  }

  private createHttpSession(serverId: string, serverEntry: PersistentServerEntry): HttpSession {
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => `${serverId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    });

    const mcpServer = new Server(
      { name: `nuwax-bridge-${serverId}`, version: '1.0.0' },
      {
        capabilities: {
          tools: {},
        },
      },
    );

    // Register tool handlers that proxy to the persistent Client
    mcpServer.setRequestHandler(ListToolsRequestSchema, async () => {
      return { tools: serverEntry.tools };
    });

    mcpServer.setRequestHandler(CallToolRequestSchema, async (request: { params: { name: string; arguments?: Record<string, unknown> } }) => {
      if (!serverEntry.client || !serverEntry.healthy) {
        return {
          content: [{ type: 'text', text: `Server "${serverId}" is not available` }],
          isError: true,
        };
      }

      try {
        const result = await serverEntry.client.callTool({
          name: request.params.name,
          arguments: request.params.arguments,
        });
        return result as { content: Array<{ type: string; text?: string }>; isError?: boolean };
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        return {
          content: [{ type: 'text', text: `Tool call failed: ${msg}` }],
          isError: true,
        };
      }
    });

    // Clean up on close
    transport.onclose = () => {
      const sid = transport.sessionId;
      if (sid) {
        const key = `${serverId}:${sid}`;
        this.httpSessions.delete(key);
        log.info(`${LOG_TAG} HTTP session closed: ${key}`);
      }
    };

    // Connect server to transport
    mcpServer.connect(transport).catch((e: unknown) => {
      log.error(`${LOG_TAG} Failed to connect HTTP session server:`, e);
    });

    return { server: mcpServer, transport };
  }

  /**
   * Remove sessions whose transport has been closed but not cleaned up
   * (e.g., bridge client crashed without sending DELETE).
   */
  private cleanupStaleSessions(): void {
    let cleaned = 0;
    for (const [key, session] of this.httpSessions) {
      // sessionId becomes undefined after transport.close()
      if (!session.transport.sessionId) {
        this.httpSessions.delete(key);
        cleaned++;
      }
    }
    if (cleaned > 0) {
      log.info(`${LOG_TAG} Cleaned up ${cleaned} stale HTTP session(s)`);
    }
  }

  private readBody(req: http.IncomingMessage): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      let totalSize = 0;
      req.on('data', (chunk: Buffer) => {
        totalSize += chunk.length;
        if (totalSize > MAX_BODY_SIZE) {
          req.destroy();
          reject(new Error(`Request body exceeds ${MAX_BODY_SIZE} bytes`));
          return;
        }
        chunks.push(chunk);
      });
      req.on('end', () => {
        try {
          const raw = Buffer.concat(chunks).toString('utf-8');
          resolve(JSON.parse(raw));
        } catch (e) {
          reject(e);
        }
      });
      req.on('error', reject);
    });
  }
}

// ========== Singleton Export ==========

export const persistentMcpBridge = new PersistentMcpBridge();
