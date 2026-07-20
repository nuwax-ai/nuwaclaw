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

/** Quote a single argv token for cmd.exe /c (avoids DEP0190 shell+args). */
export function quoteWindowsCmdArg(arg: string): string {
  if (!/[\s"]/.test(arg)) {
    return arg;
  }
  return `"${arg.replace(/"/g, '""')}"`;
}

/**
 * On Windows, bypass npx.cmd/npm.cmd shims and spawn node.exe + cli.js directly.
 * cmd.exe /c quoting for .cmd files is fragile (especially with /s); node+cli is reliable.
 */
export function resolveWindowsNpmShim(
  command: string,
  args: string[],
): { command: string; args: string[] } | null {
  if (process.platform !== 'win32') return null;

  const base = path.basename(command).replace(/\.(cmd|bat|exe)$/i, '');
  if (base !== 'npx' && base !== 'npm') return null;

  const binDir = path.dirname(command);
  const nodeExe = path.join(binDir, 'node.exe');
  const cliJs = path.join(
    binDir,
    'node_modules',
    'npm',
    'bin',
    base === 'npx' ? 'npx-cli.js' : 'npm-cli.js',
  );

  if (fs.existsSync(nodeExe) && fs.existsSync(cliJs)) {
    return { command: nodeExe, args: [cliJs, ...args] };
  }
  return null;
}

/** Build cmdline for `cmd.exe /d /s /c` when spawning .cmd/.bat on Windows. */
export function buildWindowsBatchSpawn(
  command: string,
  args: string[],
): { command: string; args: string[] } {
  // Robust quoting pattern for batch files:
  //   cmd.exe /d /s /c ""C:\path with spaces\tool.cmd" arg1 "arg 2""
  //
  // IMPORTANT:
  // - The outer double-quotes wrap the whole command line for /c
  // - The *first* token (the .cmd/.bat path) must be quoted separately
  // - DO NOT quote the entire "<cmd> <args>" as a single token, or cmd.exe will
  //   treat it as a command name and fail with "is not recognized..."
  const cmdToken = quoteWindowsCmdArg(command);
  const rest = args.map(quoteWindowsCmdArg).join(' ');
  const cmdline = `""${cmdToken}"${rest ? ` ${rest}` : ''}"`;
  return {
    command: process.env.ComSpec || 'cmd.exe',
    args: ['/d', '/s', '/c', cmdline],
  };
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

      const spawnArgs = this._serverParams.args ?? [];
      let spawnCommand = command;
      let spawnArgv = spawnArgs;

      // Prefer node.exe + npx-cli.js / npm-cli.js over npx.cmd/npm.cmd on Windows.
      const npmShim = isWindows ? resolveWindowsNpmShim(command, spawnArgs) : null;
      if (npmShim) {
        spawnCommand = npmShim.command;
        spawnArgv = npmShim.args;
        logDebug(`Resolved npm shim ${command} -> ${spawnCommand}`);
      } else {
        // Node DEP0190: do not use shell:true with a separate args array for .cmd/.bat.
        // Invoke via cmd.exe /c with a single command line instead.
        const isBatch =
          isWindows &&
          (command.toLowerCase().endsWith('.cmd') || command.toLowerCase().endsWith('.bat'));
        if (isBatch) {
          const batchSpawn = buildWindowsBatchSpawn(command, spawnArgs);
          spawnCommand = batchSpawn.command;
          spawnArgv = batchSpawn.args;
          logDebug(`Using cmd.exe for ${command}`);
        }
      }

      this._process = spawn(spawnCommand, spawnArgv, {
        env: mergedEnv,
        stdio: ['pipe', 'pipe', this._serverParams.stderr ?? 'inherit'],
        shell: false,
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
