// @nuwax-ai/agent-kit — PersistentMcpBridge singleton manager.
//
// Both nuwa-cli and nuwaclaw keep a single bridge instance and restart it on
// config change. The bridge constructor + logger are host-injected, so agent-kit
// does NOT depend on @nuwax-ai/mcp-proxy-ts directly — this keeps the module
// ESM/CJS-agnostic (no host-adapter import to resolve at build time).
//
// CONTRACT for the injected bridge's `start(servers)`: it MUST be idempotent /
// diff-aware — calling it with the servers it already runs must be a no-op (or a
// clean restart), never an error. agent-kit's ensureStarted forwards EVERY call
// to `start` (no internal dedup); the host invokes ensureStarted on every MCP
// rewrite, so the change-detection intelligence lives in the bridge itself.
// nuwa-cli's PersistentMcpBridge satisfies this; nuwaclaw's injected bridge must
// too. (If a future host's `start` is NOT idempotent, that host must diff before
// calling ensureStarted, otherwise persistent proxies will flap on each rewrite.)

export interface McpProxyLogger {
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

/**
 * The slice of a host bridge (e.g. PersistentMcpBridge) that this manager drives.
 *
 * Generic over `Servers` so the host's concrete bridge — whose `start` takes a
 * narrower `Record<string, ConcreteServerEntry>` — flows through WITHOUT casts:
 * agent-kit never names the host's server type (zero runtime dep on
 * `@nuwax-ai/mcp-proxy-ts`), yet `ensureStarted`'s parameter is type-checked
 * against exactly what the injected bridge's `start` accepts. This replaces the
 * earlier `start(servers: any)` + host-side `as Record<string, unknown>` escape,
 * which silently let the two sides drift.
 *
 * See the file-level note: `start` must be idempotent / diff-aware.
 */
export interface PersistentBridgeInstance<Servers = Record<string, unknown>> {
  start(servers: Servers): Promise<unknown>;
  stop(): Promise<void>;
}

/** Pull the concrete `start(servers)` parameter type off a bridge instance type. */
type BridgeServers<B> = B extends PersistentBridgeInstance<infer S>
  ? S
  : Record<string, unknown>;

export interface CreatePersistentBridgeOptions<B extends PersistentBridgeInstance> {
  /** Host-provided factory — typically `() => new PersistentMcpBridge(logger)`. */
  create: (logger: McpProxyLogger) => B;
  logger: McpProxyLogger;
  onStarted?: (names: string[]) => void;
  onStopped?: () => void;
  onStopError?: (err: unknown) => void;
}

export interface PersistentBridgeHandle<B extends PersistentBridgeInstance> {
  /**
   * Ensure the bridge is started with `servers`. Empty servers → stop + null
   * (mirrors nuwa-cli's existing semantics). Forwards to `bridge.start` on every
   * call (no internal diff — see the file-level contract note) and returns the
   * bridge instance (or null) so the caller can pass it to
   * rewriteServersToProxyCommands.
   */
  ensureStarted(servers: BridgeServers<B>): Promise<B | null>;
  /** Stop the bridge if running; safe to call when not running. */
  stop(): Promise<void>;
  isRunning(): boolean;
}

/**
 * Manage a single bridge across config changes: create-on-first-use,
 * forward-to-start on every call, stop on shutdown. Replaces the per-host
 * singleton + bookkeeping that nuwa-cli (proxyRewrite.ts) and nuwaclaw
 * (persistentMcpBridge.ts) duplicate.
 */
export function createPersistentBridge<B extends PersistentBridgeInstance>(
  opts: CreatePersistentBridgeOptions<B>,
): PersistentBridgeHandle<B> {
  const { create, logger, onStarted, onStopped, onStopError } = opts;
  let bridge: B | null = null;

  const stop = async (): Promise<void> => {
    if (!bridge) return;
    try {
      await bridge.stop();
      onStopped?.();
    } catch (err) {
      onStopError?.(err);
    } finally {
      bridge = null;
    }
  };

  return {
    async ensureStarted(servers) {
      const names = Object.keys(servers);
      if (names.length === 0) {
        await stop();
        return null;
      }
      if (!bridge) bridge = create(logger);
      await bridge.start(servers);
      onStarted?.(names);
      return bridge;
    },
    stop,
    isRunning: () => bridge !== null,
  };
}
