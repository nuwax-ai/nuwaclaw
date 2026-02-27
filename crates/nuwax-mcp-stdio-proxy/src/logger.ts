/**
 * Logging utilities — stderr only, stdout is the MCP JSON-RPC channel
 */

export function log(level: string, msg: string): void {
  process.stderr.write(`[nuwax-mcp-proxy] ${level}: ${msg}\n`);
}

export const logInfo = (msg: string) => log('INFO', msg);
export const logWarn = (msg: string) => log('WARN', msg);
export const logError = (msg: string) => log('ERROR', msg);
