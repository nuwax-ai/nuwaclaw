/**
 * PersistentMcpBridge — long-lived MCP server bridge
 *
 * Manages persistent MCP servers (e.g. chrome-devtools-mcp) that outlive
 * individual ACP sessions. Spawns child processes via CustomStdioClientTransport
 * (with Windows fixes) and exposes them over HTTP for downstream consumers.
 *
 * Architecture:
 *   persistent child process (stdio)
 *     ↕ CustomStdioClientTransport
 *   MCP Client (cached tools, proxies callTool)
 *     ↕
 *   HTTP Server (single port, path routing /mcp/<serverId>)
 *     ↕ StreamableHTTPServerTransport (per HTTP session)
 *   MCP Server (tool handlers → Client.callTool)
 */

import * as http from 'http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { CustomStdioClientTransport } from './customStdio.js';
import { ResilientTransportWrapper } from './resilient.js';
import type { StdioServerEntry } from './types.js';

const LOG_TAG = '[McpProxy] [PersistentMcpBridge]';
const BASE_RESTART_COOLDOWN_MS = 5_000;
const MAX_RESTART_ATTEMPTS = 5;
const MAX_BODY_SIZE = 10 * 1024 * 1024; // 10 MB
const SESSION_CLEANUP_INTERVAL_MS = 60_000; // 1 minute

// ========== Types ==========

export interface BridgeLogger {
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
}

interface PersistentServerEntry {
  config: StdioServerEntry;
  client: Client | null;
  transport: ResilientTransportWrapper | null;
  tools: Tool[];
  healthy: boolean;
  restarting: boolean;
  restartTimer: ReturnType<typeof setTimeout> | null;
  restartCount: number;
}

/** session ID → { server, transport } */
interface HttpSession {
  server: Server;
  transport: StreamableHTTPServerTransport;
}

// ========== PersistentMcpBridge ==========

export class PersistentMcpBridge {
  private log: BridgeLogger;
  private httpServer: http.Server | null = null;
  private port = 0;
  private servers = new Map<string, PersistentServerEntry>();
  /** "serverId:sessionId" → HttpSession */
  private httpSessions = new Map<string, HttpSession>();
  private running = false;
  private sessionCleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor(logger?: BridgeLogger) {
    this.log = logger ?? console;
  }

  /**
   * Start bridge: spawn child processes for each persistent server and create HTTP server
   *
   * @param servers - Map of server ID to stdio config
   * @param options - Optional settings (e.g. port to listen on)
   */
  async start(servers: Record<string, StdioServerEntry>, options?: { port?: number }): Promise<void> {
    if (this.running) {
      this.log.warn(`${LOG_TAG} Already running, stopping first`);
      await this.stop();
    }

    const serverCount = Object.keys(servers).length;
    this.log.info(`${LOG_TAG} Starting with ${serverCount} persistent servers (parallel)`);

    // 1. 并行启动 HTTP server 和所有 MCP server 子进程。
    //    两者完全独立：HTTP server 在请求时才查询 this.servers，
    //    startServer 会在异步 spawnAndConnect 前先同步写入 this.servers，
    //    所以 HTTP server 收到第一个请求时所有 entry 都已注册。
    //
    //    提前保存 serverPromises 引用：若 startHttpServer 抛出，在 catch 中先
    //    await Promise.allSettled(serverPromises) 等所有 spawnAndConnect 跑完
    //    （保证 entry.client / entry.transport 已赋值），再调用 stopServer，
    //    才能可靠关闭子进程，防止孤儿进程残留。
    const serverPromises = Object.entries(servers).map(([id, config]) => this.startServer(id, config));

    try {
      await Promise.all([
        this.startHttpServer(options?.port),
        ...serverPromises,
      ]);
    } catch (e) {
      this.log.error(`${LOG_TAG} 启动失败，清理已 spawn 的子进程:`, e);
      // 等待所有 spawnAndConnect 完成，确保 entry.client/transport 已赋值后再清理
      await Promise.allSettled(serverPromises);
      await Promise.all(Array.from(this.servers.keys()).map((id) => this.stopServer(id)));
      this.servers.clear();
      throw e;
    }

    this.running = true;

    // 2. Start periodic session cleanup
    this.sessionCleanupTimer = setInterval(() => this.cleanupStaleSessions(), SESSION_CLEANUP_INTERVAL_MS);

    this.log.info(`${LOG_TAG} Bridge ready on port ${this.port} (${serverCount} servers)`);
  }

  /**
   * Stop bridge: close HTTP, kill all child processes
   */
  async stop(): Promise<void> {
    this.log.info(`${LOG_TAG} Stopping...`);
    this.running = false;

    // Stop session cleanup timer
    if (this.sessionCleanupTimer) {
      clearInterval(this.sessionCleanupTimer);
      this.sessionCleanupTimer = null;
    }

    // 并行关闭所有 HTTP sessions（各 session transport 独立，无顺序依赖）。
    // 内层 async 函数自行 catch 错误后不再 throw，Promise.all 足够，不需要 allSettled。
    await Promise.all(
      Array.from(this.httpSessions.entries()).map(async ([key, session]) => {
        try {
          await session.transport.close();
        } catch (e) {
          this.log.warn(`${LOG_TAG} Error closing HTTP session ${key}:`, e);
        }
      }),
    );
    this.httpSessions.clear();

    // Close HTTP server
    if (this.httpServer) {
      await new Promise<void>((resolve) => {
        this.httpServer!.close(() => resolve());
      });
      this.httpServer = null;
      this.port = 0;
    }

    // 并行关闭所有 MCP server 子进程（各自独立，无顺序依赖）
    await Promise.all(
      Array.from(this.servers.keys()).map((id) => this.stopServer(id)),
    );
    this.servers.clear();

    this.log.info(`${LOG_TAG} Stopped`);
  }

  /**
   * Get bridge URL for a server (for bridge clients to connect)
   */
  getBridgeUrl(serverId: string): string | null {
    if (!this.running || !this.port) return null;
    const entry = this.servers.get(serverId);
    if (!entry || !entry.healthy) return null;
    return `http://127.0.0.1:${this.port}/mcp/${serverId}`;
  }

  /**
   * Whether the bridge is running
   */
  isRunning(): boolean {
    return this.running && this.port > 0;
  }

  /**
   * Health check for a specific server
   */
  isServerHealthy(serverId: string): boolean {
    return this.servers.get(serverId)?.healthy ?? false;
  }

  // ==================== Internal: Server Lifecycle ====================

  private async startServer(id: string, config: StdioServerEntry): Promise<void> {
    const entry: PersistentServerEntry = {
      config,
      client: null,
      transport: null,
      tools: [],
      healthy: false,
      restarting: false,
      restartTimer: null,
      restartCount: 0,
    };
    this.servers.set(id, entry);

    await this.spawnAndConnect(id, entry);
  }

  private async spawnAndConnect(id: string, entry: PersistentServerEntry): Promise<void> {
    try {
      this.log.info(`${LOG_TAG} Spawning server "${id}": ${entry.config.command} ${(entry.config.args || []).join(' ')}`);

      // Create MCP Client + ResilientTransportWrapper
      const wrapper = new ResilientTransportWrapper({
        name: id,
        logger: this.log,
        connectParams: async () => {
          const t = new CustomStdioClientTransport({
            command: entry.config.command,
            args: entry.config.args || [],
            env: entry.config.env,
            stderr: 'pipe',
          });
          if (t.stderr) {
            t.stderr.on('data', (chunk: Buffer) => {
              const text = chunk.toString().trim();
              if (text) this.log.info(`${LOG_TAG} [${id}:stderr] ${text}`);
            });
          }
          return t;
        },
        pingIntervalMs: 0, // No heartbeat for stdio — child process close/error events handle detection
      });

      const client = new Client(
        { name: 'nuwax-persistent-bridge', version: '1.0.0' },
        { capabilities: {} },
      );

      // Handle transport close → auto restart
      wrapper.onclose = () => {
        this.log.warn(`${LOG_TAG} Server "${id}" transport closed`);
        entry.healthy = false;
        if (this.running && !entry.restarting) {
          this.scheduleRestart(id, entry);
        }
      };

      wrapper.onerror = (err: Error) => {
        this.log.error(`${LOG_TAG} Server "${id}" transport error:`, err.message);
      };

      // Connect client to transport (this starts the subprocess)
      await wrapper.start();
      await client.connect(wrapper);

      entry.client = client;
      entry.transport = wrapper;

      // List tools (cached)
      const result = await client.listTools();
      entry.tools = result.tools;
      entry.healthy = true;
      entry.restartCount = 0; // reset on success

      this.log.info(`${LOG_TAG} Server "${id}" ready with ${entry.tools.length} tools: ${entry.tools.map((t) => t.name).join(', ')}`);
    } catch (e) {
      this.log.error(`${LOG_TAG} Failed to start server "${id}":`, e);
      entry.healthy = false;
      if (this.running && !entry.restarting) {
        this.scheduleRestart(id, entry);
      }
    }
  }

  private scheduleRestart(id: string, entry: PersistentServerEntry): void {
    if (entry.restartTimer) return;

    entry.restartCount++;
    if (entry.restartCount > MAX_RESTART_ATTEMPTS) {
      this.log.warn(`${LOG_TAG} Server "${id}" failed ${entry.restartCount - 1} times, giving up (max ${MAX_RESTART_ATTEMPTS})`);
      entry.restarting = false;
      return;
    }

    entry.restarting = true;
    // Exponential backoff: 5s, 10s, 20s, 40s, 80s
    const delay = BASE_RESTART_COOLDOWN_MS * Math.pow(2, entry.restartCount - 1);
    this.log.info(`${LOG_TAG} Scheduling restart for "${id}" in ${delay}ms (attempt ${entry.restartCount}/${MAX_RESTART_ATTEMPTS})`);

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

      this.log.info(`${LOG_TAG} Restarting server "${id}"... (attempt ${entry.restartCount}/${MAX_RESTART_ATTEMPTS})`);
      await this.spawnAndConnect(id, entry);
    }, delay);
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

    try {
      if (entry.client) await entry.client.close();
    } catch (e) {
      this.log.warn(`${LOG_TAG} Error closing client for "${id}":`, e);
    }

    // transport.close() handles graceful shutdown: stdin.end → SIGTERM → SIGKILL
    try {
      if (entry.transport) await entry.transport.close();
    } catch (e) {
      this.log.warn(`${LOG_TAG} Error closing transport for "${id}":`, e);
    }

    entry.client = null;
    entry.transport = null;
  }

  // ==================== Internal: HTTP Server ====================

  private async startHttpServer(listenPort?: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const server = http.createServer((req, res) => {
        this.handleHttpRequest(req, res).catch((e) => {
          this.log.error(`${LOG_TAG} HTTP request error:`, e);
          if (!res.headersSent) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Internal server error' }));
          }
        });
      });

      // Listen on specified port or random port (0)
      server.listen(listenPort ?? 0, '127.0.0.1', () => {
        const addr = server.address();
        if (addr && typeof addr === 'object') {
          this.port = addr.port;
        }
        this.httpServer = server;
        this.log.info(`${LOG_TAG} HTTP server listening on 127.0.0.1:${this.port}`);
        resolve();
      });

      server.on('error', (err) => {
        this.log.error(`${LOG_TAG} HTTP server error:`, err);
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
          this.log.info(`${LOG_TAG} New HTTP session: ${key}`);
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
        this.log.info(`${LOG_TAG} HTTP session closed: ${key}`);
      }
    };

    // Connect server to transport
    mcpServer.connect(transport).catch((e: unknown) => {
      this.log.error(`${LOG_TAG} Failed to connect HTTP session server:`, e);
    });

    return { server: mcpServer, transport };
  }

  /**
   * Remove sessions whose transport has been closed but not cleaned up
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
      this.log.info(`${LOG_TAG} Cleaned up ${cleaned} stale HTTP session(s)`);
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
