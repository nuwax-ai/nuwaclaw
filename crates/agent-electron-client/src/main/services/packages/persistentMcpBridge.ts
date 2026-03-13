/**
 * PersistentMcpBridge — thin wrapper
 *
 * The implementation lives in nuwax-mcp-stdio-proxy, installed to ~/.nuwaclaw/node_modules.
 * This module creates a singleton with electron-log injected as the logger.
 * Uses dynamic require from ~/.nuwaclaw so the app does not bundle the package.
 */

import * as path from "path";
import log from "electron-log";
import { getAppPaths } from "./packageLocator";

const PKG_NAME = "nuwax-mcp-stdio-proxy";

/** Lazy-loaded singleton instance (from nuwax-mcp-stdio-proxy) */
let instance: { start: (args: unknown) => Promise<void>; stop: () => Promise<void>; isRunning: () => boolean; getBridgeUrl: (name: string) => string | null } | null = null;

function getInstance(): NonNullable<typeof instance> {
  if (instance) return instance;
  const nodeModules = getAppPaths().nodeModules;
  const pkgPath = path.join(nodeModules, PKG_NAME);
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const pkg = require(pkgPath);
    if (!pkg.PersistentMcpBridge) {
      throw new Error(`${PKG_NAME}: PersistentMcpBridge export not found`);
    }
    instance = new pkg.PersistentMcpBridge(log) as NonNullable<typeof instance>;
    return instance;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error(`[PersistentMcpBridge] 加载 ${PKG_NAME} 失败:`, msg);
    throw new Error(
      `${PKG_NAME} 未安装或加载失败，请先在依赖管理中安装。${msg ? ` (${msg})` : ""}`,
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
