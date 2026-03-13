/**
 * PersistentMcpBridge — thin wrapper
 *
 * The implementation lives in nuwax-mcp-stdio-proxy, installed to ~/.nuwaclaw/node_modules.
 * This module creates a singleton with electron-log injected as the logger.
 * Uses dynamic require from ~/.nuwaclaw so the app does not bundle the package.
 */

import * as path from "path";
import log from "electron-log";
import { getAppPaths, getBundledMcpProxyDir } from "./packageLocator";

const PKG_NAME = "nuwax-mcp-stdio-proxy";

/** Lazy-loaded singleton instance (from nuwax-mcp-stdio-proxy) */
let instance: { start: (args: unknown) => Promise<void>; stop: () => Promise<void>; isRunning: () => boolean; getBridgeUrl: (name: string) => string | null } | null = null;

function getInstance(): NonNullable<typeof instance> {
  if (instance) return instance;

  // 1. 应用内集成版本（bundled resources）
  const bundledDir = getBundledMcpProxyDir();
  if (bundledDir) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const pkg = require(bundledDir);
      if (pkg.PersistentMcpBridge) {
        log.info(`[PersistentMcpBridge] 使用应用内集成版本: ${bundledDir}`);
        instance = new pkg.PersistentMcpBridge(log) as NonNullable<typeof instance>;
        return instance;
      }
    } catch (err) {
      log.warn(`[PersistentMcpBridge] 应用内集成版本加载失败，回退到 node_modules:`, err instanceof Error ? err.message : String(err));
    }
  }

  // 2. 回退兼容: ~/.nuwaxbot/node_modules
  const nodeModules = getAppPaths().nodeModules;
  const pkgPath = path.join(nodeModules, PKG_NAME);
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const pkg = require(pkgPath);
    if (!pkg.PersistentMcpBridge) {
      throw new Error(`${PKG_NAME}: PersistentMcpBridge export not found`);
    }
    log.info(`[PersistentMcpBridge] 使用 ~/.nuwaxbot 路径（回退兼容）: ${pkgPath}`);
    instance = new pkg.PersistentMcpBridge(log) as NonNullable<typeof instance>;
    return instance;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error(`[PersistentMcpBridge] 加载 ${PKG_NAME} 失败:`, msg);
    throw new Error(
      `${PKG_NAME} 未安装或加载失败。${msg ? ` (${msg})` : ""}`,
    );
  }
}

export const persistentMcpBridge = {
  async start(args: Parameters<NonNullable<typeof instance>["start"]>[0]): Promise<void> {
    return getInstance().start(args);
  },
  async stop(): Promise<void> {
    return getInstance().stop();
  },
  isRunning(): boolean {
    try { return getInstance().isRunning(); } catch { return false; }
  },
  getBridgeUrl(name: string): string | null {
    try { return getInstance().getBridgeUrl(name); } catch { return null; }
  },
};
