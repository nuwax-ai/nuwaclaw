/**
 * MCP Proxy Manager (Electron)
 *
 * 使用 nuwax-mcp-stdio-proxy 纯 Node.js stdio 聚合代理。
 * Agent 引擎直接 spawn proxy 进程（stdio 直通），无需 HTTP 中间层。
 *
 * proxy 同时支持两种上游传输:
 * - stdio: spawn 子进程（临时 server）
 * - bridge: 连接 PersistentMcpBridge（持久化 server，如 chrome-devtools-mcp）
 *
 * Electron 侧负责：
 * - 验证 nuwax-mcp-stdio-proxy 包已安装
 * - 管理 mcpServers 配置（持久化到 SQLite）
 * - 管理 PersistentMcpBridge 生命周期
 * - 提供 getAgentMcpConfig() 供 Agent 引擎初始化时注入
 */

import * as path from 'path';
import * as fs from 'fs';
import log from 'electron-log';
import { app } from 'electron';
import { getAppEnv, getUvBinPath, getNodeBinPath, getNodeBinPathWithFallback } from '../system/dependencies';
import { getAppPaths, isInstalledLocally } from './packageLocator';
import { resolveNpmPackageEntry } from '../utils/spawnNoWindow';
import { APP_DATA_DIR_NAME } from '../constants';
import { isWindows } from '../system/shellEnv';
import { persistentMcpBridge } from './persistentMcpBridge';

// ========== Shared Helpers ==========

/**
 * Returns the directory containing the app-internal `uv` binary.
 * Priority: bundled resources/uv/bin → ~/.nuwax-agent/bin
 * Returns empty string if uv not found anywhere.
 */
export function getUvBinDir(): string {
  const p = getUvBinPath();
  if (p && fs.existsSync(p)) return path.dirname(p);
  const appBin = path.join(app.getPath('home'), APP_DATA_DIR_NAME, 'bin');
  const uvName = isWindows() ? 'uv.exe' : 'uv';
  if (fs.existsSync(path.join(appBin, uvName))) return appBin;
  return '';
}

/**
 * Resolves `uvx`/`uv` commands to app-internal binaries.
 * - If `uvx`: always rewrite to `<uvBinDir>/uv tool run ...`
 *   (uv >= 0.10 dropped the uvx multicall — invoking the binary as `uvx` no longer
 *    behaves as `uv tool run`; it shows the full `uv` CLI instead)
 * - If `uv`: resolve to `<uvBinDir>/uv`
 */
export function resolveUvCommand(
  command: string,
  args: string[],
  uvBinDir?: string,
): { command: string; args: string[] } {
  const dir = uvBinDir ?? getUvBinDir();
  if (!dir) return { command, args };

  const base = path.basename(command).replace(/\.(exe)?$/i, '');
  if (base === 'uvx') {
    // Always use `uv tool run` — the uvx multicall binary is broken in uv >= 0.10
    const uvName = isWindows() ? 'uv.exe' : 'uv';
    const uvPath = path.join(dir, uvName);
    if (fs.existsSync(uvPath)) {
      return { command: uvPath, args: ['tool', 'run', ...args] };
    }
    return { command, args };
  }
  if (base === 'uv') {
    const uvName = isWindows() ? 'uv.exe' : 'uv';
    const uvPath = path.join(dir, uvName);
    if (fs.existsSync(uvPath)) {
      return { command: uvPath, args };
    }
  }
  return { command, args };
}

/**
 * Resolve uvx/uv commands inside a `mcp-proxy convert --config '{...}'` bridge entry.
 * Only rewrites inner command paths (uvx → uv tool run); does NOT inject env.
 * Kept for backward compatibility with context_servers that may still use bridge entries.
 */
export function resolveBridgeEntry(
  command: string,
  args: string[],
  uvBinDir?: string,
): { command: string; args: string[] } {
  const dir = uvBinDir ?? getUvBinDir();
  const idx = args.indexOf('--config');
  if (idx < 0 || idx + 1 >= args.length) return { command, args };
  const configStr = args[idx + 1];
  if (typeof configStr !== 'string') return { command, args };

  let parsed: { mcpServers?: Record<string, { command?: string; args?: string[]; env?: Record<string, string> }> };
  try {
    parsed = JSON.parse(configStr);
  } catch {
    return { command, args };
  }
  const inner = parsed?.mcpServers;
  if (!inner || typeof inner !== 'object') return { command, args };

  let changed = false;
  for (const [, srv] of Object.entries(inner)) {
    if (!srv || typeof srv.command !== 'string') continue;
    const resolved = resolveUvCommand(srv.command, srv.args || [], dir);
    if (resolved.command !== srv.command) {
      srv.command = resolved.command;
      srv.args = resolved.args;
      changed = true;
    }
  }

  if (!changed) return { command, args };
  const newConfigStr = JSON.stringify(parsed);
  const newArgs = [...args];
  newArgs[idx + 1] = newConfigStr;
  return { command, args: newArgs };
}

/**
 * Extract real MCP servers from a bridge entry (mcp-proxy convert --config '{...}').
 *
 * Bridge entries are a legacy format where the command is "mcp-proxy" and the
 * actual MCP server config is embedded in the --config JSON argument. This function
 * extracts the inner server configs and resolves uvx/uv commands to app-internal paths.
 *
 * @param command - The command string (e.g., "mcp-proxy" or "/path/to/mcp-proxy")
 * @param args - Arguments array, should contain "--config" followed by JSON string
 * @param env - Optional external environment variables to merge with server-specific env.
 *              Note: Server-specific env takes precedence over external env for the same keys.
 * @param uvBinDir - Optional uv binary directory override for resolving uvx commands
 * @returns Extracted MCP servers config, or null if not a valid bridge entry
 *
 * @example
 * ```typescript
 * const result = extractRealMcpServers(
 *   'mcp-proxy',
 *   ['convert', '--config', '{"mcpServers":{"fetch":{"command":"uvx","args":["mcp-server-fetch"]}}}'],
 *   { MY_VAR: 'value' }
 * );
 * // Returns: { fetch: { command: '/path/to/uv', args: ['tool', 'run', 'mcp-server-fetch'], env: { MY_VAR: 'value' } } }
 * ```
 */
export function extractRealMcpServers(
  command: string,
  args: string[],
  env?: Record<string, string>,
  uvBinDir?: string,
): Record<string, { command: string; args: string[]; env?: Record<string, string> }> | null {
  // Must be a bridge entry
  if (command !== 'mcp-proxy' && path.basename(command) !== 'mcp-proxy') return null;

  const dir = uvBinDir ?? getUvBinDir();
  const idx = args.indexOf('--config');
  if (idx < 0 || idx + 1 >= args.length) return null;

  const configStr = args[idx + 1];
  if (typeof configStr !== 'string') return null;

  let parsed: { mcpServers?: Record<string, { command?: string; args?: string[]; env?: Record<string, string> }> };
  try {
    parsed = JSON.parse(configStr);
  } catch {
    return null;
  }

  const inner = parsed?.mcpServers;
  if (!inner || typeof inner !== 'object') return null;

  const result: Record<string, { command: string; args: string[]; env?: Record<string, string> }> = {};
  for (const [name, srv] of Object.entries(inner)) {
    if (!srv || typeof srv.command !== 'string') continue;
    const resolved = resolveUvCommand(srv.command, srv.args || [], dir);
    // Env merge: external env as base, server-specific env overrides (documented behavior)
    result[name] = {
      command: resolved.command,
      args: resolved.args,
      env: { ...env, ...(srv.env || {}) },
    };
  }

  return Object.keys(result).length > 0 ? result : null;
}

/**
 * Apply resolveUvCommand + inject minimal env for all server entries.
 * Filters out mcp-proxy bridge entries.
 *
 * Note: Full env (getAppEnv) is not needed here because nuwax-mcp-stdio-proxy
 * will inject the proper environment when spawning child processes.
 * We only include essential variables for MCP server operation.
 */
export function resolveServersConfig(
  servers: Record<string, McpServerEntry>,
): Record<string, McpServerEntry> {
  const appEnv = getAppEnv();
  // Minimal env - only essential variables
  // PATH is included but other npm/uv config is handled by the proxy
  const baseEnv: Record<string, string> = {
    PATH: appEnv.PATH,
    HOME: process.env.HOME || process.env.USERPROFILE || '',
    USER: process.env.USER || process.env.USERNAME || '',
    USERNAME: process.env.USERNAME || process.env.USER || '',
    LANG: process.env.LANG || 'en_US.UTF-8',
    TZ: process.env.TZ || '',
  };
  const dir = getUvBinDir();
  const result: Record<string, McpServerEntry> = {};
  for (const [name, entry] of Object.entries(servers)) {
    if (entry.command === 'mcp-proxy') continue;
    const resolved = resolveUvCommand(entry.command, entry.args || [], dir);
    result[name] = {
      command: resolved.command,
      args: resolved.args,
      env: { ...baseEnv, ...(entry.env || {}) },
      ...(entry.persistent ? { persistent: true } : {}),
    };
  }
  return result;
}

// ========== Types ==========

/** 默认 mcpServers 配置 */
export const DEFAULT_MCP_PROXY_CONFIG: McpServersConfig = {
  mcpServers: {
    'chrome-devtools': {
      command: 'npx',
      args: ['-y', 'chrome-devtools-mcp@latest'],
      persistent: true,
    },
  },
};

/** 单个 MCP Server 的配置（mcpServers 格式） */
export interface McpServerEntry {
  command: string;
  args: string[];
  env?: Record<string, string>;
  /** 标记为持久化 server（生命周期由 PersistentMcpBridge 管理，而非跟随 ACP session） */
  persistent?: boolean;
}

/** mcpServers 配置（传给 nuwax-mcp-stdio-proxy 的 JSON） */
export interface McpServersConfig {
  mcpServers: Record<string, McpServerEntry>;
}

/** MCP Proxy 运行状态（语义变更：running = "binary 可用" 而非 "进程在运行"） */
export interface McpProxyStatus {
  running: boolean;
  serverCount?: number;
  serverNames?: string[];
}

// ========== MCP Proxy Manager ==========

class McpProxyManager {
  private config: McpServersConfig = JSON.parse(JSON.stringify(DEFAULT_MCP_PROXY_CONFIG));
  /** Cached script path — set by start(), avoids fs I/O on every getStatus() poll */
  private cachedScriptPath: string | null = null;

  /**
   * 解析 nuwax-mcp-stdio-proxy 脚本路径（disk lookup，不使用缓存）
   *
   * 注意：打包后必须使用 extraResources 位置，因为独立 Node.js 无法读取 asar 归档！
   * 只有 Electron 内置的 Node.js 有 asar 支持。
   */
  private resolveProxyScriptPath(): string | null {
    const pkgName = 'nuwax-mcp-stdio-proxy';

    // 1. 打包后优先使用 extraResources（独立 Node.js 可访问的路径）
    if (process.resourcesPath) {
      // extraResources 位置
      let appPackageDir = path.join(process.resourcesPath, pkgName);
      if (fs.existsSync(appPackageDir)) {
        const entry = resolveNpmPackageEntry(appPackageDir, pkgName);
        if (entry) {
          log.info(`[McpProxy] 🔍 resolveProxyScriptPath: 使用 extraResources 路径: ${entry}`);
          return entry;
        }
      }
      // app.asar.unpacked 位置
      appPackageDir = path.join(process.resourcesPath, 'app.asar.unpacked', 'node_modules', pkgName);
      if (fs.existsSync(appPackageDir)) {
        const entry = resolveNpmPackageEntry(appPackageDir, pkgName);
        if (entry) {
          log.info(`[McpProxy] 🔍 resolveProxyScriptPath: 使用 asar.unpacked 路径: ${entry}`);
          return entry;
        }
      }
    }

    // 2. 开发时：应用自身 node_modules（app.asar 内部，开发时可用）
    const appRoot = app.getAppPath();
    const appPackageDir = path.join(appRoot, 'node_modules', pkgName);
    if (fs.existsSync(appPackageDir)) {
      const entry = resolveNpmPackageEntry(appPackageDir, pkgName);
      if (entry) {
        log.info(`[McpProxy] 🔍 resolveProxyScriptPath: 使用 app node_modules 路径: ${entry}`);
        return entry;
      }
    }

    // 3. 应用数据目录 ~/.nuwax-agent/node_modules（用户通过依赖管理安装的版本）
    const dirs = getAppPaths();
    const packageDir = path.join(dirs.nodeModules, pkgName);
    if (!fs.existsSync(packageDir)) {
      log.warn(`[McpProxy] 🔍 resolveProxyScriptPath: 所有路径均未找到 ${pkgName}`);
      return null;
    }
    const entry = resolveNpmPackageEntry(packageDir, pkgName);
    if (entry) {
      log.info(`[McpProxy] 🔍 resolveProxyScriptPath: 使用 ~/.nuwax-agent 路径: ${entry}`);
    }
    return entry;
  }

  /**
   * 获取脚本路径（仅返回缓存值，需先调用 start() 填充）
   */
  private getProxyScriptPath(): string | null {
    return this.cachedScriptPath;
  }

  /**
   * 从当前配置中提取标记为 persistent 的 servers
   */
  getPersistentServers(): Record<string, McpServerEntry> {
    const result: Record<string, McpServerEntry> = {};
    for (const [name, entry] of Object.entries(this.config.mcpServers)) {
      if (entry.persistent) result[name] = entry;
    }
    return result;
  }

  /**
   * start() → 验证 binary 可用性并刷新缓存 + 启动 PersistentMcpBridge（持久化 servers）
   * proxy 进程的生命周期由 Agent 引擎管理（通过 getAgentMcpConfig 注入）
   */
  async start(): Promise<{ success: boolean; error?: string }> {
    // 优先从应用 node_modules（npm 依赖）或 ~/.nuwax-agent/node_modules 解析
    this.cachedScriptPath = this.resolveProxyScriptPath();
    if (!this.cachedScriptPath) {
      this.cachedScriptPath = null;
      if (!isInstalledLocally('nuwax-mcp-stdio-proxy')) {
        return { success: false, error: 'nuwax-mcp-stdio-proxy 未安装，请先在依赖管理中安装或确保已 npm install' };
      }
      return { success: false, error: 'nuwax-mcp-stdio-proxy 入口文件未找到' };
    }
    log.info('[McpProxy] nuwax-mcp-stdio-proxy 就绪:', this.cachedScriptPath);

    // 验证内置 Node.js 资源存在
    const nodeBinPath = getNodeBinPath();
    if (!nodeBinPath) {
      log.warn('[McpProxy] ⚠️ 内置 Node.js 资源未找到');
      log.warn('[McpProxy] 请运行以下命令下载 Node.js 资源:');
      log.warn('[McpProxy]   npm run prepare:node');
      log.warn('[McpProxy] 或运行完整准备:');
      log.warn('[McpProxy]   npm run prepare:all');
      // 不返回错误，允许在开发环境下继续（可能使用系统 node）
    }

    // 启动 PersistentMcpBridge（持久化 servers）
    const persistent = this.getPersistentServers();
    if (Object.keys(persistent).length > 0) {
      try {
        await persistentMcpBridge.start(resolveServersConfig(persistent));
        log.info('[McpProxy] PersistentMcpBridge 已启动');
      } catch (e) {
        log.error('[McpProxy] PersistentMcpBridge 启动失败:', e);
      }
    }

    return { success: true };
  }

  /**
   * stop() → 清除缓存状态 + 停止 PersistentMcpBridge
   */
  async stop(): Promise<{ success: boolean }> {
    this.cachedScriptPath = null;
    try {
      await persistentMcpBridge.stop();
    } catch (e) {
      log.warn('[McpProxy] PersistentMcpBridge 停止出错:', e);
    }
    return { success: true };
  }

  /**
   * restart() → 仅验证 binary 可用性
   */
  async restart(): Promise<{ success: boolean; error?: string }> {
    return this.start();
  }

  /**
   * 获取运行状态（使用缓存路径，避免频繁磁盘 I/O）
   */
  getStatus(): McpProxyStatus {
    const serverNames = Object.keys(this.config.mcpServers || {});
    return {
      running: !!this.cachedScriptPath,
      serverCount: serverNames.length,
      serverNames,
    };
  }

  /**
   * 获取当前 mcpServers 配置
   */
  getConfig(): McpServersConfig {
    return this.config;
  }

  /**
   * 设置 mcpServers 配置
   */
  setConfig(config: McpServersConfig): void {
    this.config = config;
  }

  /**
   * 添加一个 MCP Server 到配置
   */
  addServer(id: string, entry: McpServerEntry): void {
    this.config.mcpServers[id] = entry;
  }

  /**
   * 移除一个 MCP Server 从配置
   */
  removeServer(id: string): void {
    delete this.config.mcpServers[id];
  }

  /**
   * 获取 Agent 引擎需要的 MCP 配置
   *
   * 所有 server（临时 + 持久化）统一通过 nuwax-mcp-stdio-proxy 聚合：
   * - 临时 server → { command, args, env } (stdio 子进程)
   * - 持久化 server → { url } (bridge 连接 PersistentMcpBridge)
   *
   * 所有平台统一使用 process.execPath (Electron Node.js) + ELECTRON_RUN_AS_NODE=1，
   * 避免依赖系统 PATH 中的 node。
   */
  getAgentMcpConfig(): Record<string, { command: string; args: string[]; env?: Record<string, string> }> | null {
    const servers = this.config.mcpServers;
    if (!servers || Object.keys(servers).length === 0) {
      return null;
    }

    const scriptPath = this.getProxyScriptPath();

    // 构建统一的 proxy 配置（混合 stdio 和 bridge 类型）
    const proxyServers: Record<string, { command?: string; args?: string[]; env?: Record<string, string>; url?: string }> = {};

    // 1. 临时 server → resolveServersConfig (command/args/env)
    for (const [name, entry] of Object.entries(servers)) {
      if (entry.persistent) continue;
      // resolveServersConfig 处理单个条目
      const resolved = resolveServersConfig({ [name]: entry });
      if (resolved[name]) {
        proxyServers[name] = resolved[name];
      }
    }

    // 2. 持久化 server → bridge URL
    if (persistentMcpBridge.isRunning()) {
      for (const [name, entry] of Object.entries(servers)) {
        if (!entry.persistent) continue;
        const url = persistentMcpBridge.getBridgeUrl(name);
        if (url) {
          proxyServers[name] = { url };
        }
      }
    }

    if (Object.keys(proxyServers).length === 0) {
      return null;
    }

    // 有 proxy 脚本 → 聚合为单个 proxy 入口
    if (scriptPath) {
      const configJson = JSON.stringify({ mcpServers: proxyServers });
      // 使用应用内置的 Node.js（resources/node/<platform-arch>/bin/node）
      // 开发环境下可回退到系统 node（仅 macOS/Linux）
      const nodeBinPath = getNodeBinPathWithFallback();
      if (!nodeBinPath) {
        log.error('[McpProxy] Node.js 未找到，MCP proxy 无法启动');
        log.error('[McpProxy] 请运行 "npm run prepare:node" 下载 Node.js 资源');
        return null;
      }

      // 构建基础环境变量，确保 mcp-proxy 进程能正确启动子进程
      const appEnv = getAppEnv();
      const proxyEnv: Record<string, string> = {
        PATH: appEnv.PATH,
        HOME: process.env.HOME || process.env.USERPROFILE || '',
        USER: process.env.USER || process.env.USERNAME || '',
        USERNAME: process.env.USERNAME || process.env.USER || '',
        LANG: process.env.LANG || 'en_US.UTF-8',
        TZ: process.env.TZ || '',
      };

      return {
        'mcp-proxy': {
          command: nodeBinPath,
          args: [scriptPath, '--config', configJson],
          env: proxyEnv,
        },
      };
    }

    // fallback: 无 proxy 脚本时直接返回各 server 的 stdio 配置（仅临时 server）
    const result: Record<string, { command: string; args: string[]; env?: Record<string, string> }> = {};
    for (const [name, entry] of Object.entries(proxyServers)) {
      if (entry.command) {
        result[name] = { command: entry.command, args: entry.args || [], env: entry.env };
      }
    }
    return Object.keys(result).length > 0 ? result : null;
  }

  /**
   * 清理（退出时调用）— 停止 PersistentMcpBridge + kill 子进程
   */
  cleanup(): void {
    persistentMcpBridge.stop().catch((e) => {
      log.warn('[McpProxy] PersistentMcpBridge cleanup error:', e);
    });
  }
}

// ========== Exports ==========

export const mcpProxyManager = new McpProxyManager();

/**
 * 将 mcpServers 配置同步到 MCP Proxy 配置并持久化。
 * 不再需要重启进程 — Agent 下次 init 时 getAgentMcpConfig() 会使用新配置。
 */
export async function syncMcpConfigToProxyAndReload(
  mcpServers: Record<string, { command: string; args?: string[]; env?: Record<string, string> }>,
): Promise<void> {
  if (!mcpServers || Object.keys(mcpServers).length === 0) return;

  // 提取真实服务（过滤旧桥接项 command==='mcp-proxy'）
  const realOnly: Record<string, { command: string; args: string[]; env?: Record<string, string> }> = {};
  for (const [name, entry] of Object.entries(mcpServers)) {
    if (!entry || entry.command === 'mcp-proxy') continue;
    realOnly[name] = { command: entry.command, args: Array.isArray(entry.args) ? entry.args : [], env: entry.env };
  }
  if (Object.keys(realOnly).length === 0) return;

  // 合并默认服务器（如 chrome-devtools），确保内置 MCP 服务始终存在
  const merged: typeof realOnly = { ...DEFAULT_MCP_PROXY_CONFIG.mcpServers, ...realOnly };

  log.info('[McpProxy] 同步 MCP 配置:', Object.keys(merged).join(', '));
  mcpProxyManager.setConfig({ mcpServers: merged });

  // 持久化到 SQLite
  try {
    const { getDb } = await import('../../db');
    const db = getDb();
    if (db) {
      db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('mcp_proxy_config', JSON.stringify({ mcpServers: merged }));
      log.info('[McpProxy] MCP 配置已持久化');
    }
  } catch (e) {
    log.warn('[McpProxy] 持久化 MCP 配置失败:', e);
  }

  // 不再需要 restart — 无后台进程
  // Agent 下次 init 时 getAgentMcpConfig() 会使用新配置
}
