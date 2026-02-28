/**
 * ACP Client - Agent Client Protocol connection manager for Electron
 *
 * Spawns an ACP-compatible agent binary as a subprocess and communicates
 * via NDJSON over stdio. Uses @agentclientprotocol/sdk's ClientSideConnection + ndJsonStream.
 *
 * Supported engines:
 * - claude-code:  spawn `claude-code-acp-ts` (npm-local dependency)
 * - nuwaxcode:    spawn `nuwaxcode acp` (npm-local dependency)
 *
 * References Tauri client's rcoder_impl.rs pattern:
 * - Binaries installed as npm-local dependencies in ~/.nuwax-agent/node_modules/.bin/
 * - CLAUDE_CODE_ACP_PATH env var points to claude-code-acp-ts binary
 * - ACP protocol uses NDJSON (newline-delimited JSON) over stdin/stdout
 */

import { spawn, ChildProcess } from 'child_process';
import { Readable, Writable } from 'stream';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { app } from 'electron';
import log from 'electron-log';
import { getAppEnv } from '../../system/dependencies';
import { APP_DATA_DIR_NAME } from '../../constants';
import { APP_NAME_IDENTIFIER } from '../../../../shared/constants';
import { isWindows } from '../../system/shellEnv';
import { spawnJsFile, resolveNpmPackageEntry } from '../../utils/spawnNoWindow';

// ==================== Types ====================

/** ACP MCP Server types (matching @agentclientprotocol/sdk schema) */
export interface AcpEnvVariable {
  name: string;
  value: string;
}

export interface AcpHttpHeader {
  name: string;
  value: string;
}

export type AcpMcpServer =
  | { name: string; command: string; args: string[]; env: AcpEnvVariable[] }
  | { name: string; url: string; headers: AcpHttpHeader[]; type: 'http' }
  | { name: string; url: string; headers: AcpHttpHeader[]; type: 'sse' };

/** ACP SDK module shape (loaded dynamically since it's ESM) */
export interface AcpSdkModule {
  ndJsonStream: (
    input: WritableStream,
    output: ReadableStream<Uint8Array>,
  ) => unknown;
  ClientSideConnection: new (
    clientFactory: (agent: unknown) => unknown,
    stream: unknown,
  ) => AcpClientSideConnection;
  PROTOCOL_VERSION: string;
}

/** ClientSideConnection interface */
export interface AcpClientSideConnection {
  initialize(params: {
    protocolVersion: string;
    clientCapabilities?: Record<string, unknown>;
  }): Promise<{ protocolVersion: string; agentCapabilities?: Record<string, unknown> }>;

  newSession(params: {
    cwd: string;
    mcpServers: Array<AcpMcpServer>;
  }): Promise<{ sessionId: string }>;

  prompt(params: {
    sessionId: string;
    prompt: Array<{ type: string; text?: string; uri?: string; mimeType?: string }>;
  }): Promise<{ stopReason: string }>;

  cancel(params: { sessionId: string }): Promise<void>;

  closed: Promise<void>;
}

/** ACP Client handler interface (callbacks from agent → client) */
export interface AcpClientHandler {
  sessionUpdate?(params: {
    sessionId: string;
    update: AcpSessionUpdate;
  }): Promise<void>;

  requestPermission?(params: AcpPermissionRequest): Promise<AcpPermissionResponse>;

  readTextFile?(params: {
    sessionId: string;
    uri: string;
  }): Promise<{ content: string }>;

  writeTextFile?(params: {
    sessionId: string;
    uri: string;
    content: string;
  }): Promise<Record<string, never>>;
}

/** ACP session update types */
export type AcpSessionUpdate =
  | AcpAgentMessageChunk
  | AcpAgentThoughtChunk
  | AcpToolCall
  | AcpToolCallUpdate
  | AcpSessionInfoUpdate
  | AcpUsageUpdate
  | { sessionUpdate: string; [key: string]: unknown };

export interface AcpAgentMessageChunk {
  sessionUpdate: 'agent_message_chunk';
  content: { type: string; text?: string };
}

export interface AcpAgentThoughtChunk {
  sessionUpdate: 'agent_thought_chunk';
  content: { type: string; text?: string };
}

export interface AcpToolCall {
  sessionUpdate: 'tool_call';
  toolCallId: string;
  title: string;
  kind?: string;
  status: string;
  rawInput?: unknown;
  content?: Array<{ type: string; [key: string]: unknown }>;
  locations?: unknown[];
}

export interface AcpToolCallUpdate {
  sessionUpdate: 'tool_call_update';
  toolCallId: string;
  status: string;
  rawOutput?: unknown;
  content?: Array<{ type: string; [key: string]: unknown }>;
}

export interface AcpSessionInfoUpdate {
  sessionUpdate: 'session_info_update';
  title?: string;
  [key: string]: unknown;
}

export interface AcpUsageUpdate {
  sessionUpdate: 'usage_update';
  [key: string]: unknown;
}

export type AcpPermissionOptionKind = 'allow_once' | 'allow_always' | 'reject_once' | 'reject_always';

export interface AcpPermissionOption {
  optionId: string;
  kind: AcpPermissionOptionKind;
  name: string;
}

export interface AcpPermissionRequest {
  sessionId: string;
  toolCall: {
    toolCallId: string;
    title?: string | null;
    kind?: string | null;
    rawInput?: unknown;
  };
  options: AcpPermissionOption[];
}

export interface AcpPermissionResponse {
  outcome: {
    outcome: 'selected' | 'cancelled';
    optionId?: string;
  };
}

/** Config for creating an ACP connection */
export interface AcpConnectionConfig {
  /** Binary path to spawn (e.g. claude-code-acp-ts or nuwaxcode) */
  binPath: string;
  /** Binary arguments (e.g. [] for claude-code-acp-ts, ['acp'] for nuwaxcode) */
  binArgs: string[];
  workspaceDir: string;
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  env?: Record<string, string>;
}

/** Result of creating an ACP connection */
export interface AcpConnectionResult {
  connection: AcpClientSideConnection;
  process: ChildProcess;
  /** Isolated HOME directory created for this ACP process (for cleanup) */
  isolatedHome: string;
}

// ==================== SDK Loader ====================

let _acpSdkPromise: Promise<AcpSdkModule> | null = null;

/**
 * Dynamically load the ACP SDK (@agentclientprotocol/sdk).
 *
 * Uses `new Function('s', 'return import(s)')` to bypass CJS → ESM restriction
 * (tsc compiles import() to require() in CJS mode).
 */
export function loadAcpSdk(): Promise<AcpSdkModule> {
  if (!_acpSdkPromise) {
    const dynamicImport = new Function('specifier', 'return import(specifier)') as (
      specifier: string,
    ) => Promise<AcpSdkModule>;

    _acpSdkPromise = dynamicImport('@agentclientprotocol/sdk').catch((error) => {
      log.error('[AcpClient] Failed to load ACP SDK:', error);
      _acpSdkPromise = null;
      throw error;
    });
  }

  return _acpSdkPromise;
}

// ==================== Binary Path ====================

/** Get ~/.nuwax-agent/ base directory */
function getAppDataDir(): string {
  return path.join(app.getPath('home'), APP_DATA_DIR_NAME);
}

/**
 * Get ACP package directory
 */
function getAcpPackageDir(packageName: string): string | null {
  const nodeModules = path.join(app.getPath('home'), APP_DATA_DIR_NAME, 'node_modules');
  const packageDir = path.join(nodeModules, packageName);
  return fs.existsSync(packageDir) ? packageDir : null;
}

/**
 * Resolve ACP entry JS file path for a given engine type.
 *
 * 使用通用工具 resolveNpmPackageEntry 解析入口文件
 *
 * - claude-code → ~/.nuwax-agent/node_modules/claude-code-acp-ts (bin entry)
 * - nuwaxcode   → ~/.nuwax-agent/node_modules/nuwaxcode (bin entry)
 */
export function resolveAcpBinary(engine: 'claude-code' | 'nuwaxcode'): { binPath: string; binArgs: string[] } {
  if (engine === 'claude-code') {
    const packageDir = getAcpPackageDir('claude-code-acp-ts');
    const entryPath = packageDir ? resolveNpmPackageEntry(packageDir, 'claude-code-acp-ts') : null;
    return {
      binPath: entryPath || '',
      binArgs: [],
    };
  }

  // nuwaxcode
  const packageDir = getAcpPackageDir('nuwaxcode');
  const entryPath = packageDir ? resolveNpmPackageEntry(packageDir, 'nuwaxcode') : null;
  return {
    binPath: entryPath || '',
    binArgs: ['acp'],
  };
}

// ==================== Connection Factory ====================

/**
 * Create an ACP connection by spawning an agent binary and establishing
 * a ClientSideConnection over NDJSON stdin/stdout.
 *
 * Works with any ACP-compatible binary:
 * - claude-code-acp-ts (no args)
 * - nuwaxcode acp (args: ['acp'])
 */
export async function createAcpConnection(
  config: AcpConnectionConfig,
  clientHandler: AcpClientHandler,
): Promise<AcpConnectionResult> {
  const { binPath, binArgs } = config;

  if (!fs.existsSync(binPath)) {
    throw new Error(`ACP binary not found at: ${binPath}. Please install it first.`);
  }

  // Build isolated environment (aligned with rcoder + engineManager pattern)
  // 1. Start with getAppEnv() for complete isolation (node/npm/uv paths, no system PATH)
  // 2. Create isolated HOME/config dir so Claude Code uses empty config (not user's global ~/.claude/)
  // 3. Only inject model vars from ACP-provided config

  // Create isolated HOME directory with empty .claude/ config
  // This prevents Claude Code from reading user's global ~/.claude/settings.json
  const runId = `acp-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
  const isolatedHome = path.join(os.tmpdir(), `${APP_NAME_IDENTIFIER}-${runId}`);
  fs.mkdirSync(path.join(isolatedHome, '.claude'), { recursive: true });

  // 获取应用隔离环境变量（包含隔离的 PATH、npm、uv 配置等）
  const appEnv = getAppEnv();

  // 构建最终环境变量：以 appEnv 为基础，添加 ACP 特定配置
  const env: Record<string, string> = {
    ...appEnv,  // 包含完全隔离的 PATH、NODE_PATH、npm/uv 配置等

    // Isolated HOME — Claude Code won't read user's global config
    HOME: isolatedHome,
    USERPROFILE: isolatedHome, // Windows

    // XDG 目录（Unix/Linux 标准，Windows 上也设置以兼容可能的工具）
    XDG_CONFIG_HOME: path.join(isolatedHome, '.config'),
    XDG_DATA_HOME: path.join(isolatedHome, '.local', 'share'),
    XDG_CACHE_HOME: path.join(isolatedHome, '.cache'),

    // 引擎配置目录
    CLAUDE_CONFIG_DIR: path.join(isolatedHome, '.claude'),
    NUWAXCODE_CONFIG_DIR: path.join(isolatedHome, '.nuwaxcode'),

    // Disable non-essential traffic (aligned with rcoder ENV_DISABLE_NONESSENTIAL)
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
  };

  // Set model/api vars from ACP config only (never from user's global env)
  if (config.apiKey) {
    env.ANTHROPIC_API_KEY = config.apiKey;
    env.ANTHROPIC_AUTH_TOKEN = config.apiKey;
  }
  if (config.baseUrl) env.ANTHROPIC_BASE_URL = config.baseUrl;
  // config.model 必须由上层设置（ensureEngineForRequest 从 model_provider 或 agent_config env 提取）
  if (config.model) {
    env.ANTHROPIC_MODEL = config.model;
  } else {
    log.warn('[AcpClient] ⚠️ config.model 未设置，引擎将使用内置默认模型（不推荐）');
  }
  if (config.env) Object.assign(env, config.env);

  // Set CLAUDE_CODE_ACP_PATH for claude-code-acp-ts (matching Tauri's rcoder pattern)
  if (binPath.includes('claude-code-acp-ts')) {
    env.CLAUDE_CODE_ACP_PATH = binPath;
  }

  // 打印最终生效的模型配置（关键调试信息）
  log.info(`[AcpClient] 🚀 Spawning ACP binary:\n` +
    `├─ binPath: ${binPath}\n` +
    `├─ binArgs: ${JSON.stringify(binArgs)}\n` +
    `├─ cwd: ${config.workspaceDir}\n` +
    `├─ isolatedHome: ${isolatedHome}\n` +
    `├─ 📌 ANTHROPIC_MODEL: ${env.ANTHROPIC_MODEL || '⚠️ 未设置'}\n` +
    `├─ ANTHROPIC_BASE_URL: ${env.ANTHROPIC_BASE_URL || '(未设置)'}\n` +
    `├─ ANTHROPIC_API_KEY: ${env.ANTHROPIC_API_KEY ? env.ANTHROPIC_API_KEY.slice(0, Math.min(8, Math.floor(env.ANTHROPIC_API_KEY.length / 2))) + '...' : '(未设置)'}\n` +
    `├─ 📌 OPENCODE_MODEL: ${env.OPENCODE_MODEL || '(未设置)'}\n` +
    `├─ OPENAI_BASE_URL: ${env.OPENAI_BASE_URL || '(未设置)'}\n` +
    `└─ OPENAI_API_KEY: ${env.OPENAI_API_KEY ? env.OPENAI_API_KEY.slice(0, Math.min(8, Math.floor(env.OPENAI_API_KEY.length / 2))) + '...' : '(未设置)'}`,
  );

  // 1. Spawn ACP binary
  // 使用通用 spawnJsFile 启动，自动处理 Windows 无弹窗
  const proc = spawnJsFile(binPath, binArgs, {
    cwd: config.workspaceDir,
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  // Log stderr — MCP/spawn 相关错误突出显示 // TODO: remove after MCP diagnosis
  proc.stderr?.on('data', (data: Buffer) => {
    const text = data.toString().trim();
    if (!text) return;
    const lower = text.toLowerCase();
    if (lower.includes('failed to connect') || lower.includes('enoent') || lower.includes('spawn') || lower.includes('mcp server')) {
      log.error('[AcpClient stderr] 🔴', text);
    } else {
      log.warn('[AcpClient stderr]', text);
    }
  });

  proc.on('error', (error) => {
    log.error('[AcpClient] Process error:', error);
  });

  proc.on('exit', (code, signal) => {
    log.info('[AcpClient] Process exited', { code, signal });
  });

  // 2. Convert Node streams → Web streams
  const readable = Readable.toWeb(proc.stdout!) as ReadableStream<Uint8Array>;
  const writable = Writable.toWeb(proc.stdin!) as WritableStream;

  // 3. Load ACP SDK and create NDJSON stream
  const acp = await loadAcpSdk();
  const stream = acp.ndJsonStream(writable, readable);

  // 4. Create ClientSideConnection with client handler
  const connection = new acp.ClientSideConnection(
    (_agent: unknown) => clientHandler,
    stream,
  ) as AcpClientSideConnection;

  return { connection, process: proc, isolatedHome };
}
