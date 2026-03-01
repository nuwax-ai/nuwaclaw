/**
 * PersistentMcpBridge — thin wrapper
 *
 * The implementation lives in nuwax-mcp-stdio-proxy.
 * This module creates a singleton with electron-log injected as the logger.
 */

import log from 'electron-log';
import { PersistentMcpBridge } from 'nuwax-mcp-stdio-proxy';

export { PersistentMcpBridge };
export const persistentMcpBridge = new PersistentMcpBridge(log);
