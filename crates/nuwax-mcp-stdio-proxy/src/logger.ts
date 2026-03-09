/**
 * Logging utilities — stderr only, stdout is the MCP JSON-RPC channel.
 *
 * When the environment variable MCP_PROXY_LOG_FILE is set, log lines are
 * also appended to that file so the Electron host can tail them into main.log.
 *
 * Log rotation: file is named by date (e.g. mcp-proxy-2026-03-09.log).
 * A new file is created each day. Old files beyond MAX_LOG_FILES are deleted.
 */

import * as fs from 'fs';
import * as path from 'path';

const logFilePath = process.env.MCP_PROXY_LOG_FILE;
const MAX_LOG_FILES = 7;

let logStream: fs.WriteStream | null = null;
let logDir = '';
let logBaseName = '';
let logExt = '';
let currentDateStr = '';

function dateStr(): string {
  const d = new Date();
  const pad2 = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function openLogFile(): void {
  if (!logFilePath) return;

  const today = dateStr();
  if (today === currentDateStr && logStream) return;

  // Close previous stream
  if (logStream) {
    try { logStream.end(); } catch { /* ignore */ }
  }

  currentDateStr = today;
  const dated = path.join(logDir, `${logBaseName}-${today}${logExt}`);
  try {
    logStream = fs.createWriteStream(dated, { flags: 'a' });
  } catch {
    logStream = null;
  }

  // Cleanup old log files
  cleanupOldLogs();
}

function cleanupOldLogs(): void {
  if (!logDir || !logBaseName) return;
  try {
    const prefix = `${logBaseName}-`;
    const files = fs.readdirSync(logDir)
      .filter(f => f.startsWith(prefix) && f.endsWith(logExt))
      .sort()
      .reverse();
    for (let i = MAX_LOG_FILES; i < files.length; i++) {
      try { fs.unlinkSync(path.join(logDir, files[i])); } catch { /* ignore */ }
    }
  } catch { /* ignore */ }
}

if (logFilePath) {
  try {
    logDir = path.dirname(logFilePath);
    if (logDir && !fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
    const fullName = path.basename(logFilePath);
    const dotIdx = fullName.lastIndexOf('.');
    if (dotIdx > 0) {
      logBaseName = fullName.substring(0, dotIdx);
      logExt = fullName.substring(dotIdx);
    } else {
      logBaseName = fullName;
      logExt = '.log';
    }
    openLogFile();
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
  if (logFilePath) {
    openLogFile(); // Rotate if date changed
    logStream?.write(line);
  }
}

export const logInfo = (msg: string) => log('INFO', msg);
export const logWarn = (msg: string) => log('WARN', msg);
export const logError = (msg: string) => log('ERROR', msg);
