/**
 * Resilient Transport Wrapper for MCP
 *
 * Provides heartbeat monitoring, automatic reconnection, and request queueing
 * for MCP transports (HTTP, SSE, Stdio).
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';
import { logInfo, logWarn, logError } from './logger.js';

export interface ResilientTransportOptions {
  /** Connection factory function */
  connectParams: () => Promise<Transport>;
  /** Heartbeat check interval (ms). Default: 20000 */
  pingIntervalMs?: number;
  /** Max consecutive failures before reconnecting. Default: 3 */
  maxConsecutiveFailures?: number;
  /** Timeout for checking ping or listTools (ms). Default: 5000 */
  pingTimeoutMs?: number;
  /** Backoff delay before reconnect attempt (ms). Default: 3000 */
  reconnectDelayMs?: number;
  /** Max queued requests during reconnect. Default: 100 */
  maxQueueSize?: number;
  /** Server name/ID for logging */
  name?: string;
}

const DEFAULT_OPTIONS = {
  pingIntervalMs: 20000,
  maxConsecutiveFailures: 3,
  pingTimeoutMs: 5000,
  reconnectDelayMs: 3000,
  maxQueueSize: 100,
  name: 'remote',
};

export class ResilientTransportWrapper implements Transport {
  private options: Required<ResilientTransportOptions>;
  private activeTransport: Transport | null = null;
  private mcpClient: Client | null = null;
  
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private consecutiveFailures = 0;
  
  private state: 'connecting' | 'connected' | 'reconnecting' | 'closed' = 'connecting';
  
  // Handlers required by the Transport interface
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage) => void;

  // Queue for messages sent while reconnecting
  private messageQueue: JSONRPCMessage[] = [];
  
  // Pending ping requests awaiting a response
  private pendingPings = new Map<string, (resolve: boolean) => void>();

  constructor(options: ResilientTransportOptions) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  /**
   * Initializes the transport and connects to the backend
   */
  async start(): Promise<void> {
    this.state = 'connecting';
    await this.performConnect(true);
  }

  private async performConnect(initial = false): Promise<void> {
    try {
      this.activeTransport = await this.options.connectParams();
      
      // Inherit the handlers from this wrapper
      this.bindInnerTransport(this.activeTransport);
      
      await this.activeTransport.start();
      
      this.state = 'connected';
      this.consecutiveFailures = 0;
      
      logInfo(`[ResilientTransport:${this.options.name}] Connected via ${this.activeTransport.constructor.name}`);
      
      // Flush any queued messages
      this.flushQueue();

      // Start inner client for health checks if needed
      // To perform RPC 'ping' or 'listTools', we need a Client wrapper over this *active* transport
      // However, creating a full Client here just for pinging intercepts all inbound 'onmessage'.
      // Wait, if we intercept `onmessage` for pinging, we'll break the downstream proxy!
      // Actually, we can just send raw JSON-RPC ping requests directly to `activeTransport.send()`
      // and intercept its response in our own `onmessage` wrapper before passing up.

      this.startHeartbeat();

    } catch (err) {
      logError(`[ResilientTransport:${this.options.name}] Connect failed: ${err}`);
      if (initial) {
        this.state = 'closed';
        throw err;
      }
      this.triggerReconnect(); // Retry connection
    }
  }

  private bindInnerTransport(transport: Transport) {
    transport.onclose = () => {
      // If the inner transport closes but we are not intentionally closed
      if (this.state !== 'closed') {
        logWarn(`[ResilientTransport:${this.options.name}] Inner transport closed unexpectedly. Reconnecting...`);
        this.triggerReconnect();
      }
    };

    transport.onerror = (error) => {
      // If it throws ENOENT or similar before we even catch it, we might be here.
      if (this.state !== 'closed') {
        logWarn(`[ResilientTransport:${this.options.name}] Inner transport error: ${error.message}`);
        if (this.state === 'connecting') {
           if (this.onerror) this.onerror(error);
           return;
        }
        this.triggerReconnect();
      }
    };

    transport.onmessage = (message: JSONRPCMessage) => {
      // Intercept our own ping responses here
      if ('id' in message && typeof message.id === 'string' && message.id.startsWith('respl-ping-')) {
        const resolve = this.pendingPings.get(message.id);
        if (resolve) {
          resolve(true); // Got a response, server is alive
          this.pendingPings.delete(message.id);
        }
        return;
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

  private async checkHealth() {
    if (this.state !== 'connected' || !this.activeTransport) return;

    try {
      // Send raw ping JSON-RPC
      const pingId = `respl-ping-${Date.now()}`;
      
      const responsePromise = new Promise<boolean>((resolve) => {
        this.pendingPings.set(pingId, resolve);
        setTimeout(() => {
          if (this.pendingPings.has(pingId)) {
            this.pendingPings.delete(pingId);
            resolve(false); // Timeout
          }
        }, this.options.pingTimeoutMs);
      });

      await this.activeTransport.send({
        jsonrpc: '2.0',
        id: pingId,
        method: 'ping',
      });
      
      const success = await responsePromise;
      if (!success) {
        throw new Error('Ping response timed out');
      }
      
      this.consecutiveFailures = 0; // Reset on successful response
    } catch (err) {
      this.consecutiveFailures++;
      logWarn(`[ResilientTransport:${this.options.name}] Heartbeat failed (attempt ${this.consecutiveFailures}): ${err}`);
      if (this.consecutiveFailures >= this.options.maxConsecutiveFailures) {
        logError(`[ResilientTransport:${this.options.name}] Max consecutive heartbeat failures reached. Force reconnecting.`);
        this.triggerReconnect();
      }
    }
  }

  private triggerReconnect() {
    if (this.state === 'reconnecting' || this.state === 'closed') return;
    this.state = 'reconnecting';
    this.stopHeartbeat();

    // Clean up old transport
    if (this.activeTransport) {
      // Avoid triggering our own onclose
      this.activeTransport.onclose = undefined;
      this.activeTransport.onerror = undefined;
      try {
        this.activeTransport.close();
      } catch { /* ignore */ }
      this.activeTransport = null;
    }

    setTimeout(() => {
      this.performConnect();
    }, this.options.reconnectDelayMs);
  }

  private async flushQueue() {
    if (!this.activeTransport || this.state !== 'connected') return;

    if (this.messageQueue.length > 0) {
      logInfo(`[ResilientTransport:${this.options.name}] Flushing ${this.messageQueue.length} queued requests...`);
    }

    const queueToFlush = [...this.messageQueue];
    this.messageQueue = [];

    for (let i = 0; i < queueToFlush.length; i++) {
      const msg = queueToFlush[i];
      try {
        await this.activeTransport.send(msg);
      } catch (e) {
        logError(`[ResilientTransport:${this.options.name}] Error flushing queue: ${e}`);
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
        logWarn(`[ResilientTransport:${this.options.name}] Message queue full, dropping oldest request.`);
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
      await this.activeTransport.close();
      this.activeTransport = null;
    }

    if (this.onclose) {
      this.onclose();
    }
  }
}
