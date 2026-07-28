/**
 * PersistentMcpBridge — thin wrapper
 *
 * The implementation lives in @nuwax-ai/mcp-stdio-proxy.
 * This module creates a singleton with electron-log injected as the logger.
 * Prefer bundled resources; fall back to app node_modules.
 */

import * as path from "path";
import log from "electron-log";
import { getAppPaths, getBundledMcpProxyDir } from "./packageLocator";

const PKG_NAME = "@nuwax-ai/mcp-stdio-proxy";

/**
 * Wrap electron-log so high-frequency messages (e.g. "New HTTP session")
 * are downgraded from info → debug to reduce log noise.
 */
const NOISY_PATTERNS = [/New HTTP session/];

function createQuietLogger(): typeof log {
  const quiet = Object.create(log) as typeof log;
  const originalInfo = log.info.bind(log);
  quiet.info = (...args: Parameters<typeof log.info>) => {
    const first = args[0];
    if (
      typeof first === "string" &&
      NOISY_PATTERNS.some((p) => p.test(first))
    ) {
      log.debug(...args);
      return;
    }
    originalInfo(...args);
  };
  return quiet;
}

/** Lazy-loaded singleton instance (from @nuwax-ai/mcp-stdio-proxy) */
let instance: {
  start: (args: unknown) => Promise<void>;
  stop: () => Promise<void>;
  isRunning: () => boolean;
  getBridgeUrl: (name: string) => string | null;
} | null = null;

function getInstance(): NonNullable<typeof instance> {
  if (instance) return instance;

  // 1. 应用内集成版本（bundled resources）
  const bundledDir = getBundledMcpProxyDir();
  if (bundledDir) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const pkg = require(bundledDir);
      if (pkg.PersistentMcpBridge) {
        log.info(
          `[PersistentMcpBridge] Using bundled integration: ${bundledDir}`,
        );
        instance = new pkg.PersistentMcpBridge(
          createQuietLogger(),
        ) as NonNullable<typeof instance>;
        return instance;
      }
    } catch (err) {
      log.warn(
        `[PersistentMcpBridge] Bundled integration load failed, falling back to node_modules:`,
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  // 2. 回退: 应用 node_modules / ~/.nuwaclaw/node_modules
  const nodeModules = getAppPaths().nodeModules;
  const pkgPath = path.join(nodeModules, ...PKG_NAME.split("/"));
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const pkg = require(pkgPath);
    if (!pkg.PersistentMcpBridge) {
      throw new Error(`${PKG_NAME}: PersistentMcpBridge export not found`);
    }
    log.info(`[PersistentMcpBridge] Using node_modules path: ${pkgPath}`);
    instance = new pkg.PersistentMcpBridge(createQuietLogger()) as NonNullable<
      typeof instance
    >;
    return instance;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error(`[PersistentMcpBridge] Failed to load ${PKG_NAME}:`, msg);
    throw new Error(
      `${PKG_NAME} not installed or failed to load.${msg ? ` (${msg})` : ""}`,
    );
  }
}

export const persistentMcpBridge = {
  async start(
    args: Parameters<NonNullable<typeof instance>["start"]>[0],
  ): Promise<void> {
    return getInstance().start(args);
  },
  async stop(): Promise<void> {
    return getInstance().stop();
  },
  isRunning(): boolean {
    try {
      return getInstance().isRunning();
    } catch {
      return false;
    }
  },
  getBridgeUrl(name: string): string | null {
    try {
      return getInstance().getBridgeUrl(name);
    } catch {
      return null;
    }
  },
};
