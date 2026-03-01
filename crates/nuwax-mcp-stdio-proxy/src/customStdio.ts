/**
 * Custom Stdio Transport — fixes Windows console popup issue
 *
 * The MCP SDK's StdioClientTransport sets:
 *   windowsHide: process.platform === 'win32' && isElectron()
 *
 * But when running via ELECTRON_RUN_AS_NODE=1, isElectron() returns false,
 * causing console popup windows on Windows.
 *
 * This custom transport always sets windowsHide: true on Windows.
 */

import { spawn, ChildProcess } from 'child_process';
import { PassThrough, Readable } from 'stream';
import { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';
import { serializeMessage } from '@modelcontextprotocol/sdk/shared/stdio.js';
import * as fs from 'fs';
import * as path from 'path';

function logDebug(msg: string): void {
  process.stderr.write(`[customStdio] ${msg}\n`);
}

export interface CustomStdioServerParameters {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  stderr?: 'inherit' | 'pipe' | 'overlapped';
  cwd?: string;
}

export class CustomStdioClientTransport implements Transport {
  private _process: ChildProcess | undefined;
  private _readBuffer = new ReadBuffer();
  private _stderrStream: PassThrough | null = null;
  private _serverParams: CustomStdioServerParameters;

  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage) => void;

  constructor(server: CustomStdioServerParameters) {
    this._serverParams = server;
    if (server.stderr === 'pipe' || server.stderr === 'overlapped') {
      this._stderrStream = new PassThrough();
    }
  }

  async start(): Promise<void> {
    if (this._process) {
      throw new Error('StdioClientTransport already started!');
    }

    return new Promise((resolve, reject) => {
      const mergedEnv = {
        ...getDefaultEnvironment(),
        ...this._serverParams.env,
      };

      logDebug(`Starting "${this._serverParams.command}" with PATH: ${(mergedEnv.PATH || '').split(';').slice(0, 3).join(';')}...`);

      // On Windows, resolve .cmd/.bat files if command not found directly
      let command = this._serverParams.command;
      let useShell = false;
      const isWindows = process.platform === 'win32';
      const cmdExtensions = ['.cmd', '.bat', '.exe'];

      if (isWindows && !cmdExtensions.some(ext => command.toLowerCase().endsWith(ext))) {
        // Try to find the command with .cmd extension in PATH
        const pathDirs = (mergedEnv.PATH || '').split(';');
        for (const dir of pathDirs) {
          for (const ext of cmdExtensions) {
            const fullPath = path.join(dir, command + ext);
            if (fs.existsSync(fullPath)) {
              command = fullPath;
              logDebug(`Resolved "${this._serverParams.command}" to "${command}"`);
              break;
            }
          }
          if (command !== this._serverParams.command) break;
        }
      }

      // For .cmd/.bat files on Windows, we need shell: true
      if (isWindows && (command.toLowerCase().endsWith('.cmd') || command.toLowerCase().endsWith('.bat'))) {
        useShell = true;
        // Quote the command if it contains spaces, otherwise cmd.exe
        // misparses paths like "D:\Program Files\...\npx.cmd"
        if (command.includes(' ')) {
          command = `"${command}"`;
        }
        logDebug(`Using shell: true for ${command}`);
      }

      this._process = spawn(command, this._serverParams.args ?? [], {
        env: mergedEnv,
        stdio: ['pipe', 'pipe', this._serverParams.stderr ?? 'inherit'],
        shell: useShell,
        windowsHide: true,
        cwd: this._serverParams.cwd,
      });

      this._process.on('error', (error) => {
        reject(error);
        this.onerror?.(error);
      });

      this._process.on('spawn', () => {
        resolve();
      });

      this._process.on('close', (_code) => {
        this._process = undefined;
        this.onclose?.();
      });

      this._process.stdin?.on('error', (error) => {
        this.onerror?.(error);
      });

      this._process.stdout?.on('data', (chunk) => {
        this._readBuffer.append(chunk);
        this.processReadBuffer();
      });

      this._process.stdout?.on('error', (error) => {
        this.onerror?.(error);
      });

      if (this._stderrStream && this._process.stderr) {
        this._process.stderr.pipe(this._stderrStream);
      }
    });
  }

  get stderr(): Readable | null {
    if (this._stderrStream) {
      return this._stderrStream;
    }
    return this._process?.stderr ?? null;
  }

  get pid(): number | null {
    return this._process?.pid ?? null;
  }

  private processReadBuffer(): void {
    while (true) {
      try {
        const message = this._readBuffer.readMessage();
        if (message === null) {
          break;
        }
        this.onmessage?.(message);
      } catch (error) {
        this.onerror?.(error as Error);
      }
    }
  }

  async close(): Promise<void> {
    if (this._process) {
      const processToClose = this._process;
      this._process = undefined;

      const closePromise = new Promise<void>((resolve) => {
        processToClose.once('close', () => {
          resolve();
        });
      });

      try {
        processToClose.stdin?.end();
      } catch {
        // ignore
      }

      await Promise.race([closePromise, new Promise<void>((resolve) => setTimeout(resolve, 2000).unref())]);

      if (processToClose.exitCode === null) {
        try {
          processToClose.kill('SIGTERM');
        } catch {
          // ignore
        }
        await Promise.race([closePromise, new Promise<void>((resolve) => setTimeout(resolve, 2000).unref())]);
      }

      if (processToClose.exitCode === null) {
        try {
          processToClose.kill('SIGKILL');
        } catch {
          // ignore
        }
      }
    }
    this._readBuffer.clear();
  }

  async send(message: JSONRPCMessage): Promise<void> {
    return new Promise((resolve) => {
      if (!this._process?.stdin) {
        throw new Error('Not connected');
      }
      const json = serializeMessage(message);
      if (this._process.stdin.write(json)) {
        resolve();
      } else {
        this._process.stdin.once('drain', resolve);
      }
    });
  }
}

class ReadBuffer {
  private _buffer?: Buffer;

  append(chunk: Buffer): void {
    this._buffer = this._buffer ? Buffer.concat([this._buffer, chunk]) : chunk;
  }

  readMessage(): JSONRPCMessage | null {
    if (!this._buffer) {
      return null;
    }

    const separatorIndex = this._buffer.indexOf('\n');
    if (separatorIndex === -1) {
      return null;
    }

    const line = this._buffer.subarray(0, separatorIndex);
    this._buffer = this._buffer.subarray(separatorIndex + 1);

    try {
      const obj = JSON.parse(line.toString('utf-8'));
      return obj as JSONRPCMessage;
    } catch {
      throw new Error('Failed to parse JSON-RPC message');
    }
  }

  clear(): void {
    this._buffer = undefined;
  }
}

const DEFAULT_INHERITED_ENV_VARS =
  process.platform === 'win32'
    ? [
        'APPDATA',
        'HOMEDRIVE',
        'HOMEPATH',
        'LOCALAPPDATA',
        'PATH',
        'PROCESSOR_ARCHITECTURE',
        'SYSTEMDRIVE',
        'SYSTEMROOT',
        'TEMP',
        'USERNAME',
        'USERPROFILE',
        'PROGRAMFILES',
      ]
    : ['HOME', 'LOGNAME', 'PATH', 'SHELL', 'TERM', 'USER'];

function getDefaultEnvironment(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of DEFAULT_INHERITED_ENV_VARS) {
    const value = process.env[key];
    if (value === undefined) {
      continue;
    }
    if (value.startsWith('()')) {
      continue;
    }
    env[key] = value;
  }
  return env;
}
