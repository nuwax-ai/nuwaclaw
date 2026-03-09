/**
 * Resilient Transport Wrapper for MCP
 *
 * Provides heartbeat monitoring, automatic reconnection, and request queueing
 * for MCP transports (HTTP, SSE, Stdio).
 *
 * Retry strategy: exponential backoff 1s → 2s → 4s → ... → 60s (capped),
 * unlimited retries. Matches the Rust mcp-proxy CappedExponentialBackoff.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';
import { logInfo, logWarn, logError } from './logger.js';

/** Logger interface — compatible with console, electron-log, and BridgeLogger */
export interface ResilientLogger {
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
}

export interface ResilientTransportOptions {
  /** Connection factory function */
  connectParams: () => Promise<Transport>;
  /** Heartbeat check interval (ms). Default: 20000 */
  pingIntervalMs?: number;
  /** Max consecutive failures before reconnecting. Default: 3 */
  maxConsecutiveFailures?: number;
  /** Timeout for checking ping or listTools (ms). Default: 5000 */
  pingTimeoutMs?: number;
  /** Base backoff delay for reconnect (ms). Default: 1000 */
  reconnectDelayMs?: number;
  /** Max backoff delay cap (ms). Default: 60000 */
  maxReconnectDelayMs?: number;
  /** Max queued requests during reconnect. Default: 100 */
  maxQueueSize?: number;
  /** Server name/ID for logging */
  name?: string;
  /**
   * Optional custom logger. When running inside the Electron main process
   * (e.g. PersistentMcpBridge), pass electron-log so heartbeat/reconnect
   * logs appear in main.log alongside other application logs.
   * Defaults to the built-in stderr logger (logger.js).
   */
  logger?: ResilientLogger;
}

const DEFAULT_OPTIONS = {
  pingIntervalMs: 20000,
  maxConsecutiveFailures: 3,
  pingTimeoutMs: 5000,
  reconnectDelayMs: 1000,
  maxReconnectDelayMs: 60000,
  maxQueueSize: 100,
  name: 'remote',
};

/** Default logger that delegates to logger.js (stderr) */
const defaultLogger: ResilientLogger = {
  info: (...args) => logInfo(args.map(String).join(' ')),
  warn: (...args) => logWarn(args.map(String).join(' ')),
  error: (...args) => logError(args.map(String).join(' ')),
};

export class ResilientTransportWrapper implements Transport {
  private options: Required<ResilientTransportOptions>;
  private log: ResilientLogger;
  private activeTransport: Transport | null = null;
  private mcpClient: Client | null = null;

  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private consecutiveFailures = 0;

  /** Captured MCP initialize request for replay on reconnect */
  private initializeMessage: JSONRPCMessage | null = null;
  /** Captured MCP notifications/initialized for replay on reconnect */
  private initializedNotification: JSONRPCMessage | null = null;
  /** Pending re-initialize promise resolver */
  private pendingReInit: ((success: boolean) => void) | null = null;

  private state: 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'closed' = 'idle';

  /** Current retry attempt count (reset on successful connect) */
  private retryAttempt = 0;

  // Handlers required by the Transport interface
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage) => void;

  // Queue for messages sent while reconnecting
  private messageQueue: JSONRPCMessage[] = [];

  // Pending ping requests awaiting a response
  private pendingPings = new Map<string, (resolve: boolean) => void>();

  constructor(options: ResilientTransportOptions) {
    this.log = options.logger ?? defaultLogger;
    // Build options by starting from defaults and only overriding with
    // explicitly provided values. Spreading { pingIntervalMs: undefined }
    // would clobber the default 20000, causing setInterval(fn, undefined)
    // → interval ~0ms (fires every tick).
    this.options = {
      ...DEFAULT_OPTIONS,
      logger: this.log,
      connectParams: options.connectParams,
      ...(options.name !== undefined && { name: options.name }),
      ...(options.pingIntervalMs !== undefined && { pingIntervalMs: options.pingIntervalMs }),
      ...(options.pingTimeoutMs !== undefined && { pingTimeoutMs: options.pingTimeoutMs }),
      ...(options.maxConsecutiveFailures !== undefined && { maxConsecutiveFailures: options.maxConsecutiveFailures }),
      ...(options.reconnectDelayMs !== undefined && { reconnectDelayMs: options.reconnectDelayMs }),
      ...(options.maxReconnectDelayMs !== undefined && { maxReconnectDelayMs: options.maxReconnectDelayMs }),
      ...(options.maxQueueSize !== undefined && { maxQueueSize: options.maxQueueSize }),
    };
  }

  /**
   * Calculate backoff delay using capped exponential backoff.
   * 1s → 2s → 4s → 8s → 16s → 32s → 60s (capped)
   */
  private getBackoffDelay(): number {
    const delay = this.options.reconnectDelayMs * Math.pow(2, this.retryAttempt);
    return Math.min(delay, this.options.maxReconnectDelayMs);
  }

  /**
   * Initializes the transport and connects to the backend
   *
   * This method is idempotent - if the transport is already connected or
   * connecting, subsequent calls will return immediately without creating
   * duplicate connections. This is important because MCP SDK's client.connect()
   * internally calls transport.start(), and we also call it explicitly in bridge.ts.
   */
  async start(): Promise<void> {
    // Idempotent check: if already connected, connecting, or retrying, return early
    if (this.state === 'connected' || this.state === 'connecting' || this.state === 'reconnecting') {
      return;
    }
    this.state = 'connecting';
    await this.performConnect(true);
  }

  /**
   * Enable heartbeat monitoring. Call this AFTER the MCP client has
   * completed its initialize handshake (client.connect()), otherwise
   * the server will reject requests with "Server not initialized".
   */
  enableHeartbeat(): void {
    this.startHeartbeat();
  }

  private async performConnect(initial = false): Promise<void> {
    if (this.state === 'closed') return;

    try {
      this.activeTransport = await this.options.connectParams();

      // Inherit the handlers from this wrapper
      this.bindInnerTransport(this.activeTransport);

      await this.activeTransport.start();

      this.state = 'connected';
      this.consecutiveFailures = 0;
      this.consecutivePingTimeouts = 0;
      this.heartbeatOkCount = 0;

      this.log.info(`[McpProxy] [ResilientTransport:${this.options.name}] ✅ Connected via ${this.activeTransport.constructor.name}`);

      // On reconnect, replay MCP initialize handshake before doing anything else.
      // The server requires initialize + notifications/initialized before accepting
      // any other requests (tools/list, etc).
      if (!initial && this.initializeMessage) {
        this.log.info(`[McpProxy] [ResilientTransport:${this.options.name}] 🔄 Re-initializing MCP session...`);
        try {
          await this.performReInitialize();
          this.log.info(`[McpProxy] [ResilientTransport:${this.options.name}] ✅ MCP session re-initialized`);
        } catch (err) {
          // Re-initialize failed — treat as a connect failure, preserve backoff
          this.retryAttempt++;
          const delay = this.getBackoffDelay();
          this.log.error(`[McpProxy] [ResilientTransport:${this.options.name}] ❌ Re-initialize failed: ${err}`);
          this.log.info(`[McpProxy] [ResilientTransport:${this.options.name}] 🔄 Retrying in ${delay}ms (attempt ${this.retryAttempt})...`);
          this.state = 'reconnecting';
          this.cleanupTransport();
          setTimeout(() => {
            this.performConnect();
          }, delay);
          return;
        }
      }

      // Reset retry count only after successful connect + re-initialize
      this.retryAttempt = 0;

      // Flush any queued messages
      this.flushQueue();

      // Only start heartbeat on reconnects — initial connections need
      // the caller to invoke enableHeartbeat() after client.connect()
      // completes the MCP initialize handshake. Sending pings before
      // initialize causes "Server not initialized" errors.
      if (!initial) {
        this.startHeartbeat();
      }

    } catch (err) {
      const delay = this.getBackoffDelay();
      this.retryAttempt++;
      this.log.error(`[McpProxy] [ResilientTransport:${this.options.name}] ❌ Connect failed (attempt ${this.retryAttempt}): ${err}`);
      this.log.info(`[McpProxy] [ResilientTransport:${this.options.name}] 🔄 Retrying in ${delay}ms...`);
      this.state = 'reconnecting';
      setTimeout(() => {
        this.performConnect();
      }, delay);
    }
  }

  /**
   * Replay the MCP initialize handshake on a reconnected transport.
   * Sends the captured `initialize` request with a unique internal ID,
   * waits for the response, then sends `notifications/initialized`.
   */
  private async performReInitialize(): Promise<void> {
    if (!this.activeTransport || !this.initializeMessage) {
      throw new Error('No transport or no captured initialize message');
    }

    const initId = `respl-init-${Date.now()}`;

    // Build the re-initialize request using the original params but with our internal ID
    const initRequest: JSONRPCMessage = {
      ...(this.initializeMessage as any),
      id: initId,
    };

    const initPromise = new Promise<boolean>((resolve) => {
      this.pendingReInit = resolve;
      setTimeout(() => {
        if (this.pendingReInit) {
          this.pendingReInit = null;
          resolve(false); // Timeout
        }
      }, this.options.pingTimeoutMs);
    });

    try {
      await this.activeTransport.send(initRequest);
    } catch (err) {
      this.pendingReInit = null;
      throw err;
    }
    const success = await initPromise;

    if (!success) {
      throw new Error('Re-initialize timed out');
    }

    // Send notifications/initialized if we captured it
    if (this.initializedNotification) {
      await this.activeTransport.send(this.initializedNotification);
    }
  }

  private bindInnerTransport(transport: Transport) {
    transport.onclose = () => {
      // If the inner transport closes but we are not intentionally closed
      if (this.state !== 'closed') {
        this.log.warn(`[McpProxy] [ResilientTransport:${this.options.name}] Inner transport closed unexpectedly. Reconnecting...`);
        this.triggerReconnect();
      }
    };

    transport.onerror = (error) => {
      // If it throws ENOENT or similar before we even catch it, we might be here.
      if (this.state !== 'closed') {
        this.log.warn(`[McpProxy] [ResilientTransport:${this.options.name}] Inner transport error: ${error.message}`);
        if (this.state === 'connecting') {
           if (this.onerror) this.onerror(error);
           return;
        }
        this.triggerReconnect();
      }
    };

    transport.onmessage = (message: JSONRPCMessage) => {
      // Intercept re-initialize responses (don't forward to Client)
      if ('id' in message && typeof message.id === 'string' && message.id.startsWith('respl-init-')) {
        if (this.pendingReInit) {
          this.pendingReInit(true);
          this.pendingReInit = null;
        }
        return;
      }

      // Intercept our own heartbeat responses (tools/list used as health check)
      if ('id' in message && typeof message.id === 'string' && message.id.startsWith('respl-ping-')) {
        const resolve = this.pendingPings.get(message.id);
        if (resolve) {
          // Any response (even error like "Method not found") means server is alive
          resolve(true);
          this.pendingPings.delete(message.id);
        }
        return; // Don't forward ping responses to downstream
      }

      if (this.onmessage) {
        this.onmessage(message);
      }
    };
  }

  private startHeartbeat() {
    this.stopHeartbeat();
    if (this.options.pingIntervalMs <= 0) return;

    this.heartbeatTimer = setInterval(() => {
      this.checkHealth();
    }, this.options.pingIntervalMs);
  }

  private stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  /** Track consecutive ping timeouts (no response at all, not even an error) */
  private consecutivePingTimeouts = 0;
  /** Successful heartbeat counter (for reducing log volume) */
  private heartbeatOkCount = 0;

  private async checkHealth() {
    if (this.state !== 'connected' || !this.activeTransport) return;

    try {
      // Use tools/list as health check (all MCP servers must support it).
      // Unlike ping, which is optional and many servers ignore, tools/list
      // is a required MCP method — matching Rust mcp-proxy behavior.
      const healthId = `respl-ping-${Date.now()}`;

      const responsePromise = new Promise<boolean>((resolve) => {
        this.pendingPings.set(healthId, resolve);
        setTimeout(() => {
          if (this.pendingPings.has(healthId)) {
            this.pendingPings.delete(healthId);
            resolve(false); // Timeout
          }
        }, this.options.pingTimeoutMs);
      });

      // Try to send tools/list — if send() throws, the transport itself is broken
      try {
        await this.activeTransport.send({
          jsonrpc: '2.0',
          id: healthId,
          method: 'tools/list',
          params: {},
        });
      } catch (sendErr) {
        throw sendErr; // Transport broken, treat as real failure
      }

      const success = await responsePromise;
      if (!success) {
        this.consecutivePingTimeouts++;
        this.log.warn(`[McpProxy] [ResilientTransport:${this.options.name}] ⏱️ Heartbeat timeout (${this.consecutivePingTimeouts}/${this.options.maxConsecutiveFailures})`);
        if (this.consecutivePingTimeouts >= this.options.maxConsecutiveFailures) {
          this.log.error(`[McpProxy] [ResilientTransport:${this.options.name}] Max consecutive heartbeat timeouts reached. Closing and retrying...`);
          this.triggerReconnect();
        }
        return;
      }

      // Got a response — server is alive
      this.heartbeatOkCount++;
      // Only log every 5th success to reduce log volume (~100s interval)
      if (this.heartbeatOkCount % 5 === 1 || this.consecutiveFailures > 0 || this.consecutivePingTimeouts > 0) {
        this.log.info(`[McpProxy] [ResilientTransport:${this.options.name}] 💖 Heartbeat OK (count: ${this.heartbeatOkCount})`);
      }
      this.consecutiveFailures = 0;
      this.consecutivePingTimeouts = 0;
    } catch (err) {
      this.consecutiveFailures++;
      this.log.warn(`[McpProxy] [ResilientTransport:${this.options.name}] 💔 Heartbeat error (${this.consecutiveFailures}/${this.options.maxConsecutiveFailures}): ${err}`);
      if (this.consecutiveFailures >= this.options.maxConsecutiveFailures) {
        this.log.error(`[McpProxy] [ResilientTransport:${this.options.name}] Max consecutive heartbeat failures reached. Closing and retrying...`);
        this.triggerReconnect();
      }
    }
  }

  /**
   * Detach handlers from and close the current active transport.
   */
  private cleanupTransport() {
    if (this.activeTransport) {
      this.activeTransport.onclose = undefined;
      this.activeTransport.onerror = undefined;
      try {
        this.activeTransport.close();
      } catch { /* ignore */ }
      this.activeTransport = null;
    }
  }

  /**
   * Close the current transport and schedule a reconnect with exponential backoff.
   */
  private triggerReconnect() {
    if (this.state === 'reconnecting' || this.state === 'closed') return;

    this.state = 'reconnecting';
    this.stopHeartbeat();
    this.cleanupTransport();

    const delay = this.getBackoffDelay();
    this.retryAttempt++;
    this.log.warn(`[McpProxy] [ResilientTransport:${this.options.name}] 🔄 Closed. Retrying in ${delay}ms (attempt ${this.retryAttempt})...`);

    setTimeout(() => {
      this.performConnect();
    }, delay);
  }

  private async flushQueue() {
    if (!this.activeTransport || this.state !== 'connected') return;

    if (this.messageQueue.length > 0) {
      this.log.info(`[McpProxy] [ResilientTransport:${this.options.name}] Flushing ${this.messageQueue.length} queued requests...`);
    }

    const queueToFlush = [...this.messageQueue];
    this.messageQueue = [];

    for (let i = 0; i < queueToFlush.length; i++) {
      const msg = queueToFlush[i];
      try {
        await this.activeTransport.send(msg);
      } catch (e) {
        this.log.error(`[McpProxy] [ResilientTransport:${this.options.name}] Error flushing queue: ${e}`);
        // If sending fails, put this message and remaining ones back at the front of the queue
        const failedAndRemaining = queueToFlush.slice(i);
        this.messageQueue = [...failedAndRemaining, ...this.messageQueue];
        this.triggerReconnect();
        break; // Stop flushing until reconnected
      }
    }
  }

  // --- Transport Interface Methods ---

  async send(message: JSONRPCMessage): Promise<void> {
    if (this.state === 'closed') {
      throw new Error('Transport is closed');
    }

    if (this.state === 'reconnecting' || this.state === 'connecting') {
      // Queue the message
      if (this.messageQueue.length >= this.options.maxQueueSize) {
        this.log.warn(`[McpProxy] [ResilientTransport:${this.options.name}] Message queue full, dropping oldest request.`);
        this.messageQueue.shift(); // Drop oldest
      }
      this.messageQueue.push(message);
      return;
    }

    // Capture initialize handshake messages for replay on reconnect
    if ('method' in message) {
      if (message.method === 'initialize') this.initializeMessage = message;
      else if (message.method === 'notifications/initialized') this.initializedNotification = message;
    }

    if (!this.activeTransport) {
      throw new Error('No active transport to send message');
    }

    try {
      await this.activeTransport.send(message);
    } catch (err) {
      // Queue it and reconnect
      this.messageQueue.push(message);
      this.triggerReconnect();
    }
  }

  async close(): Promise<void> {
    if (this.state === 'closed') return;
    this.state = 'closed';
    this.stopHeartbeat();
    this.messageQueue = [];

    if (this.activeTransport) {
      // Prevent bubble up closure
      this.activeTransport.onclose = undefined;
      this.activeTransport.onerror = undefined;
      await this.activeTransport.close();
      this.activeTransport = null;
    }

    if (this.onclose) {
      this.onclose();
    }
  }
}
