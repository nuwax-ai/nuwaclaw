/**
 * Graceful shutdown utilities
 */

import { logInfo, logError } from '../logger.js';

/**
 * Register SIGINT/SIGTERM handlers that run a cleanup function once,
 * then exit. Guards against double-invocation.
 */
export function setupGracefulShutdown(cleanupFn: () => Promise<void>): void {
  let isShuttingDown = false;

  const shutdown = async (signal: string) => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    logInfo(`Received ${signal}, shutting down...`);

    try {
      await cleanupFn();
    } catch (e) {
      logError(`Shutdown cleanup error: ${e}`);
    }

    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}
