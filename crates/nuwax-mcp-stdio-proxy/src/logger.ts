/**
 * Logging utilities — stderr only, stdout is the MCP JSON-RPC channel.
 *
 * When the environment variable MCP_PROXY_LOG_FILE is set, log lines are
 * also appended to that file so the Electron host can tail them into main.log.
 */

import * as fs from 'fs';

const logFilePath = process.env.MCP_PROXY_LOG_FILE;
let logStream: fs.WriteStream | null = null;

if (logFilePath) {
  try {
    const lastSlash = logFilePath.lastIndexOf('/');
    const dir = lastSlash > 0 ? logFilePath.substring(0, lastSlash) : '';
    if (dir && !fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    logStream = fs.createWriteStream(logFilePath, { flags: 'a' });
  } catch {
    // If file creation fails, continue without file logging
  }
}

function timestamp(): string {
  const d = new Date();
  const pad2 = (n: number) => String(n).padStart(2, '0');
  const pad3 = (n: number) => String(n).padStart(3, '0');
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}.${pad3(d.getMilliseconds())}`;
}

export function log(level: string, msg: string): void {
  const line = `[${timestamp()}] [${level.toLowerCase()}]  [nuwax-mcp-proxy] ${msg}\n`;
  process.stderr.write(line);
  logStream?.write(line);
}

export const logInfo = (msg: string) => log('INFO', msg);
export const logWarn = (msg: string) => log('WARN', msg);
export const logError = (msg: string) => log('ERROR', msg);
