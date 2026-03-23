/**
 * Resilient Transport Wrapper for MCP
 *
 * Provides heartbeat monitoring, automatic reconnection, and request queueing
 * for MCP transports (HTTP, SSE, Stdio).
 *
 * Retry strategy: exponential backoff 1s → 2s → 4s → ... → 60s (capped),
 * unlimited retries. Matches the Rust mcp-proxy CappedExponentialBackoff.
 *
 * NOTE: This class is a pure Transport decorator with NO MCP protocol knowledge.
 * - Health checks are delegated to the caller via `healthCheckFn`
 * - MCP session re-initialization on reconnect is handled by caller via `onreconnect`
 */

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
  /** Heartbeat check interval (ms). Default: 20000. Set to 0 to disable. */
  pingIntervalMs?: number;
  /** Max consecutive failures before reconnecting. Default: 3 */
  maxConsecutiveFailures?: number;
  /** Timeout for health check (ms). Default: 5000 */
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
  /**
   * Optional health check function. Called periodically to verify the
   * connection is still alive. Should return true if healthy, false otherwise.
   * If not provided, only transport-level liveness is checked.
   *
   * Example: Use MCP Client's listTools() method for health checking:
   *   healthCheckFn: async () => {
   *     try { await client.listTools(); return true; }
   *     catch { return false; }
   *   }
   */
  healthCheckFn?: () => Promise<boolean>;
}

const DEFAULT_OPTIONS = {
  // Heartbeat interval for SSE/HTTP connections using ping()
  // Reduced to 20s to keep connection alive (servers may close idle connections after 60s)
  pingIntervalMs: 30000,
  maxConsecutiveFailures: 3,
  pingTimeoutMs: 5000,
  reconnectDelayMs: 1000,
  maxReconnectDelayMs: 60000,
  maxQueueSize: 100,
  name: 'remote',
  healthCheckFn: undefined as (() => Promise<boolean>) | undefined,
};

/** Default logger that delegates to logger.js (stderr) */
const defaultLogger: ResilientLogger = {
  info: (...args) => logInfo(args.map(String).join(' ')),
  warn: (...args) => logWarn(args.map(String).join(' ')),
  error: (...args) => logError(args.map(String).join(' ')),
};

export class ResilientTransportWrapper implements Transport {
  private options: Required<Omit<ResilientTransportOptions, 'healthCheckFn'>> & { healthCheckFn?: () => Promise<boolean> };
  private log: ResilientLogger;
  private activeTransport: Transport | null = null;
  private healthCheckFn?: () => Promise<boolean>;

  // Note: Using setTimeout for response-driven heartbeat (not setInterval)
  private heartbeatTimer: ReturnType<typeof setTimeout> | null = null;
  private consecutiveFailures = 0;
  private consecutivePingTimeouts = 0;
  private heartbeatOkCount = 0;

  /** Guard to prevent concurrent health check executions */
  private healthCheckInProgress = false;

  private state: 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'closed' = 'idle';

  /** Current retry attempt count (reset on successful connect) */
  private retryAttempt = 0;

  // Handlers required by the Transport interface
  // These are set by SDK's Protocol.connect() and should be called when events occur
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage) => void;

  /**
   * Optional reconnect handler. Called after a successful reconnect (transport
   * re-established) but before resuming normal operation. The caller should
   * use this to re-initialize the MCP session (e.g., call client.connect()).
   *
   * If this handler throws, the reconnect is treated as failed and a retry
   * with backoff is scheduled.
   */
  onreconnect?: () => Promise<void>;

  // Queue for messages sent while reconnecting
  private messageQueue: JSONRPCMessage[] = [];

  /** Flag to track if we've already logged an error during this reconnect cycle */
  private hasLoggedError = false;

  constructor(options: ResilientTransportOptions) {
    this.log = options.logger ?? defaultLogger;
    this.healthCheckFn = options.healthCheckFn;

    // Build options by starting from defaults and only overriding with
    // explicitly provided values. Spreading { pingIntervalMs: undefined }
    // would clobber the default 20000, causing setInterval(fn, undefined)
    // → interval ~0ms (fires every tick).
    this.options = {
      ...DEFAULT_OPTIONS,
      logger: this.log,
      connectParams: options.connectParams,
      healthCheckFn: options.healthCheckFn,
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
   * Set or update the health check function after construction.
   * Useful when the caller needs to create the wrapper before having
   * a Client instance available.
   */
  setHealthCheckFn(fn: (() => Promise<boolean>) | undefined): void {
    this.healthCheckFn = fn;
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
      // DEBUG: Log when start() is skipped due to idempotent check
      // this.log.info(`[McpProxy] [ResilientTransport:${this.options.name}] ⏭️ start() skipped (state: ${this.state})`);
      return;
    }
    this.state = 'connecting';
    await this.performConnect(true);
  }

  /**
   * Enable heartbeat monitoring. Call this AFTER the MCP client has
   * completed its initialize handshake (client.connect()), otherwise
   * the health check may fail if it requires an initialized session.
   */
  enableHeartbeat(): void {
    this.startHeartbeat();
  }

  private async performConnect(initial = false): Promise<void> {
    if (this.state === 'closed') return;

    try {
      // Clean up old transport BEFORE creating new one to prevent stale event handlers
      if (this.activeTransport) {
        const oldTransport = this.activeTransport;
        const endpoint = (oldTransport as any)?._endpoint?.href || (oldTransport as any)?._endpoint || 'no-endpoint';
        const sessionId = endpoint.includes('sessionId=')
          ? endpoint.split('sessionId=')[1].split('&')[0]
          : 'n/a';
        this.log.info(`[McpProxy] [ResilientTransport:${this.options.name}] 🧹 Cleaning up old transport (session: ${sessionId})`);

        // Detach handlers first to prevent stale events
        oldTransport.onclose = undefined;
        oldTransport.onerror = undefined;
        oldTransport.onmessage = undefined;
        try {
          await oldTransport.close();
        } catch { /* ignore */ }
        this.activeTransport = null;
      }

      this.activeTransport = await this.options.connectParams();
      this.log.info(`[McpProxy] [ResilientTransport:${this.options.name}] 🔧 Created new transport (${this.activeTransport.constructor.name})`);

      // Bind handlers to the inner transport
      this.bindInnerTransport(this.activeTransport);

      await this.activeTransport.start();

      this.state = 'connected';
      this.consecutiveFailures = 0;
      this.consecutivePingTimeouts = 0;
      this.heartbeatOkCount = 0;
      // Reset error logging flag on successful connect
      this.hasLoggedError = false;

      // Extract session info from SSE endpoint (if available)
      const endpoint = (this.activeTransport as any)?._endpoint;
      if (endpoint) {
        const endpointUrl = new URL(endpoint);
        const sessionId = endpointUrl.searchParams.get('session_id') || endpointUrl.pathname.split('/').pop() || endpoint;
        this.log.info(`[McpProxy] [ResilientTransport:${this.options.name}] ✅ Connected via ${this.activeTransport.constructor.name} (session: ${sessionId}, endpoint: ${endpoint})`);
      } else {
        this.log.info(`[McpProxy] [ResilientTransport:${this.options.name}] ✅ Connected via ${this.activeTransport.constructor.name}`);
      }

      // On reconnect (not initial), invoke the onreconnect handler for MCP session re-initialization
      if (!initial && this.onreconnect) {
        this.log.info(`[McpProxy] [ResilientTransport:${this.options.name}] 🔄 Invoking reconnect handler...`);
        try {
          await this.onreconnect();
          this.log.info(`[McpProxy] [ResilientTransport:${this.options.name}] ✅ Reconnect handler completed`);
        } catch (err) {
          // Reconnect handler failed — treat as a connect failure, preserve backoff
          this.retryAttempt++;
          const delay = this.getBackoffDelay();
          this.log.error(`[McpProxy] [ResilientTransport:${this.options.name}] ❌ Reconnect handler failed: ${err}`);
          this.log.info(`[McpProxy] [ResilientTransport:${this.options.name}] 🔄 Retrying in ${delay}ms (attempt ${this.retryAttempt})...`);
          this.state = 'reconnecting';
          this.cleanupTransport();
          setTimeout(() => {
            this.performConnect();
          }, delay);
          return;
        }
      }

      // Reset retry count only after successful connect (and reconnect handler if applicable)
      this.retryAttempt = 0;

      // Clear any requests queued during onreconnect (they may use stale session)
      if (this.messageQueue.length > 0) {
        this.log.warn(`[McpProxy] [ResilientTransport:${this.options.name}] 🗑️ Dropping ${this.messageQueue.length} requests queued during reconnect`);
        this.messageQueue = [];
      }

      // Only start heartbeat on reconnects — initial connections need
      // the caller to invoke enableHeartbeat() after client.connect()
      // completes the MCP initialize handshake. Sending health checks before
      // initialize may cause errors.
      if (!initial) {
        this.startHeartbeat();
      }

    } catch (err) {
      this.retryAttempt++;

      if (initial) {
        // For initial connection failure, throw to let caller handle retry logic.
        // Caller (e.g., bridge.ts) has its own retry mechanism with max attempts.
        this.state = 'idle';
        this.log.error(`[McpProxy] [ResilientTransport:${this.options.name}] ❌ Initial connection failed: ${err}`);
        throw err;
      }

      // For reconnection failures, schedule automatic retry with backoff
      const delay = this.getBackoffDelay();
      this.log.error(`[McpProxy] [ResilientTransport:${this.options.name}] ❌ Connect failed (attempt ${this.retryAttempt}): ${err}`);
      this.log.info(`[McpProxy] [ResilientTransport:${this.options.name}] 🔄 Retrying in ${delay}ms...`);
      this.state = 'reconnecting';
      setTimeout(() => {
        this.performConnect();
      }, delay);
    }
  }

  private bindInnerTransport(transport: Transport) {
    // Flag to prevent both onerror and onclose from triggering reconnect
    let hasInitiatedReconnect = false;

    transport.onclose = () => {
      if (this.state !== 'closed') {
        // Get session_id from current transport
        const endpoint = (transport as any)?._endpoint?.href || (transport as any)?._endpoint || 'no-endpoint';
        const sessionId = endpoint.includes('sessionId=')
          ? endpoint.split('sessionId=')[1].split('&')[0]
          : 'n/a';

        // Forward to SDK handler (protected to ensure reconnect always triggers)
        if (this.onclose) {
          try { this.onclose(); } catch { /* ignore */ }
        }

        // Only trigger reconnect if onerror hasn't already done so
        if (!hasInitiatedReconnect && this.state !== 'reconnecting') {
          hasInitiatedReconnect = true;
          this.triggerReconnect(sessionId);
        }
      }
    };

    transport.onerror = (error: Error) => {
      if (this.state !== 'closed') {
        // Handle undefined error.message (e.g., SDK's SseError)
        const errorMsg = error?.message ?? String(error);

        // Get session_id from current transport
        const endpoint = (transport as any)?._endpoint?.href || (transport as any)?._endpoint || 'no-endpoint';
        const sessionId = endpoint.includes('sessionId=')
          ? endpoint.split('sessionId=')[1].split('&')[0]
          : 'n/a';

        // Forward to SDK handler (protected to ensure reconnect logic continues)
        if (this.onerror) {
          try { this.onerror(error); } catch { /* ignore */ }
        }

        if (this.state === 'connecting') {
          // Log during initial connection - performConnect will handle the error
          this.log.warn(`[McpProxy] [ResilientTransport:${this.options.name}] Connection error (session: ${sessionId}): ${errorMsg}`);
          return;
        }

        // Only trigger reconnect once per transport
        if (!hasInitiatedReconnect && this.state !== 'reconnecting') {
          hasInitiatedReconnect = true;
          this.log.warn(`[McpProxy] [ResilientTransport:${this.options.name}] Transport error (session: ${sessionId}): ${errorMsg}`);
          this.triggerReconnect(sessionId);
        }
      }
    };

    transport.onmessage = (message: JSONRPCMessage) => {
      // Forward to SDK handler
      if (this.onmessage) {
        this.onmessage(message);
      }
    };
  }

  private startHeartbeat() {
    this.stopHeartbeat();
    if (this.options.pingIntervalMs <= 0) return;

    // Use response-driven scheduling: schedule next check AFTER current one completes.
    // This prevents request piling when network is slow.
    this.scheduleNextHealthCheck();
  }

  private stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearTimeout(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  /**
   * Schedule the next health check after pingIntervalMs.
   * Called after each health check completes (response-driven heartbeat).
   */
  private scheduleNextHealthCheck() {
    if (this.state !== 'connected' || this.options.pingIntervalMs <= 0) return;
    // Clear any existing timer before scheduling new one
    if (this.heartbeatTimer) {
      clearTimeout(this.heartbeatTimer);
    }
    this.heartbeatTimer = setTimeout(() => {
      this.checkHealth();
    }, this.options.pingIntervalMs);
  }

  private async checkHealth() {
    // Prevent concurrent health check executions
    if (this.healthCheckInProgress) {
      this.log.warn(`[McpProxy] [ResilientTransport:${this.options.name}] ⚠️ Health check already in progress, skipping`);
      // Don't schedule here - let the in-progress check's finally block handle scheduling
      return;
    }
    if (this.state !== 'connected' || !this.activeTransport) return;

    this.healthCheckInProgress = true;
    try {
      let isHealthy: boolean;

      if (this.healthCheckFn) {
        // Use caller-provided health check function with timeout
        isHealthy = await Promise.race([
          this.healthCheckFn(),
          this.createTimeoutPromise(this.options.pingTimeoutMs, false),
        ]);
      } else {
        // No health check function - use lightweight transport liveness check
        // For SSE/HTTP transports, onclose/onerror handlers already monitor connection health
        // This avoids creating new connections for each health check
        isHealthy = this.activeTransport !== null && this.state === 'connected';
      }

      if (!isHealthy) {
        this.consecutivePingTimeouts++;
        this.log.warn(`[McpProxy] [ResilientTransport:${this.options.name}] ⏱️ Health check failed (${this.consecutivePingTimeouts}/${this.options.maxConsecutiveFailures})`);
        if (this.consecutivePingTimeouts >= this.options.maxConsecutiveFailures) {
          this.log.error(`[McpProxy] [ResilientTransport:${this.options.name}] Max consecutive health check failures reached. Reconnecting...`);
          this.triggerReconnect();
          return; // Don't schedule next check when reconnecting
        }
        return;
      }

      // Health check passed — server is alive
      this.heartbeatOkCount++;
      this.log.info(`[McpProxy] [ResilientTransport:${this.options.name}] 💖 Health check OK (count: ${this.heartbeatOkCount})`);
      this.consecutiveFailures = 0;
      this.consecutivePingTimeouts = 0;
    } catch (err) {
      this.consecutiveFailures++;
      this.log.warn(`[McpProxy] [ResilientTransport:${this.options.name}] 💔 Health check error (${this.consecutiveFailures}/${this.options.maxConsecutiveFailures}): ${err}`);
      if (this.consecutiveFailures >= this.options.maxConsecutiveFailures) {
        this.log.error(`[McpProxy] [ResilientTransport:${this.options.name}] Max consecutive health check errors reached. Reconnecting...`);
        this.triggerReconnect();
        return; // Don't schedule next check when reconnecting
      }
    } finally {
      this.healthCheckInProgress = false;
      // Only schedule next check if still connected (not reconnecting/closing)
      if (this.state === 'connected') {
        this.scheduleNextHealthCheck();
      }
    }
  }

  private createTimeoutPromise<T>(ms: number, fallback: T): Promise<T> {
    return new Promise((resolve) => {
      setTimeout(() => resolve(fallback), ms);
    });
  }

  /**
   * Detach handlers from and close the current active transport.
   */
  private cleanupTransport() {
    if (this.activeTransport) {
      this.activeTransport.onclose = undefined;
      this.activeTransport.onerror = undefined;
      this.activeTransport.onmessage = undefined;
      try {
        this.activeTransport.close();
      } catch { /* ignore */ }
      this.activeTransport = null;
    }
  }

  /**
   * Close the current transport and schedule a reconnect with exponential backoff.
   */
  private triggerReconnect(fromSessionId?: string) {
    if (this.state === 'reconnecting' || this.state === 'closed') return;

    this.state = 'reconnecting';
    this.stopHeartbeat();
    this.cleanupTransport();

    // Clear queued messages from old session - they use stale session_id
    const droppedCount = this.messageQueue.length;
    if (droppedCount > 0) {
      this.log.warn(`[McpProxy] [ResilientTransport:${this.options.name}] 🗑️ Dropping ${droppedCount} queued requests from old session`);
      this.messageQueue = [];
    }

    const delay = this.getBackoffDelay();
    this.retryAttempt++;
    const sessionInfo = fromSessionId ? ` (session: ${fromSessionId})` : '';
    this.log.warn(`[McpProxy] [ResilientTransport:${this.options.name}] 🔄 Reconnecting in ${delay}ms (attempt ${this.retryAttempt})${sessionInfo}...`);

    setTimeout(() => {
      this.performConnect();
    }, delay);
  }

  private async flushQueue() {
    if (!this.activeTransport || this.state !== 'connected') return;

    if (this.messageQueue.length > 0) {
      // Get current session for logging
      const endpoint = (this.activeTransport as any)?._endpoint?.href || 'no-endpoint';
      const sessionId = endpoint.includes('sessionId=')
        ? endpoint.split('sessionId=')[1].split('&')[0]
        : 'n/a';
      this.log.info(`[McpProxy] [ResilientTransport:${this.options.name}] Flushing ${this.messageQueue.length} queued requests (new session: ${sessionId})...`);
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
      this.activeTransport.onmessage = undefined;
      await this.activeTransport.close();
      this.activeTransport = null;
    }

    if (this.onclose) {
      this.onclose();
    }
  }
}
