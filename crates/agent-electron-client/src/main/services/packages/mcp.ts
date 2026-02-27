/**
 * MCP Proxy Manager (Electron)
 *
 * 使用 nuwax-mcp-stdio-proxy 纯 Node.js stdio 聚合代理。
 * Agent 引擎直接 spawn proxy 进程（stdio 直通），无需 HTTP 中间层。
 *
 * Electron 侧仅负责：
 * - 验证 nuwax-mcp-stdio-proxy 包已安装
 * - 管理 mcpServers 配置（持久化到 SQLite）
 * - 提供 getAgentMcpConfig() 供 Agent 引擎初始化时注入
 */

import * as path from 'path';
import * as fs from 'fs';
import log from 'electron-log';
import { app } from 'electron';
import { getAppEnv, getUvBinPath } from '../system/dependencies';
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
 * Apply resolveUvCommand + inject getAppEnv() env for all server entries.
 * Filters out mcp-proxy bridge entries.
 */
export function resolveServersConfig(
  servers: Record<string, McpServerEntry>,
): Record<string, McpServerEntry> {
  const appEnv = getAppEnv();
  const baseEnv: Record<string, string> = {
    ...appEnv,
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
      command: 'chrome-devtools-mcp',
      args: [],
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
   */
  private resolveProxyScriptPath(): string | null {
    const dirs = getAppPaths();
    const packageDir = path.join(dirs.nodeModules, 'nuwax-mcp-stdio-proxy');
    if (!fs.existsSync(packageDir)) return null;
    return resolveNpmPackageEntry(packageDir, 'nuwax-mcp-stdio-proxy');
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
   * 解析 mcp-bridge-client.mjs 脚本路径
   */
  private getBridgeClientScriptPath(): string | null {
    // 打包环境: resources/mcp-bridge-client.mjs
    const packagedPath = path.join(process.resourcesPath || '', 'mcp-bridge-client.mjs');
    if (fs.existsSync(packagedPath)) return packagedPath;

    // 开发环境: resources/mcp-bridge-client.mjs (相对项目根)
    const devPath = path.join(app.getAppPath(), 'resources', 'mcp-bridge-client.mjs');
    if (fs.existsSync(devPath)) return devPath;

    log.warn('[McpProxy] mcp-bridge-client.mjs 未找到');
    return null;
  }

  /**
   * start() → 验证 binary 可用性并刷新缓存 + 启动 PersistentMcpBridge（持久化 servers）
   * proxy 进程的生命周期由 Agent 引擎管理（通过 getAgentMcpConfig 注入）
   */
  async start(): Promise<{ success: boolean; error?: string }> {
    if (!isInstalledLocally('nuwax-mcp-stdio-proxy')) {
      this.cachedScriptPath = null;
      return { success: false, error: 'nuwax-mcp-stdio-proxy 未安装，请先在依赖管理中安装' };
    }
    // 强制重新解析（安装/更新后路径可能变化）
    this.cachedScriptPath = this.resolveProxyScriptPath();
    if (!this.cachedScriptPath) {
      return { success: false, error: 'nuwax-mcp-stdio-proxy 入口文件未找到' };
    }
    log.info('[McpProxy] nuwax-mcp-stdio-proxy 就绪:', this.cachedScriptPath);

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
   * - 临时 server → nuwax-mcp-stdio-proxy 聚合（现有逻辑）
   * - 持久化 server → mcp-bridge-client.mjs 连接 PersistentMcpBridge HTTP
   *
   * 所有平台统一使用 process.execPath (Electron Node.js) + ELECTRON_RUN_AS_NODE=1，
   * 避免依赖系统 PATH 中的 node。
   */
  getAgentMcpConfig(): Record<string, { command: string; args: string[]; env?: Record<string, string> }> | null {
    const servers = this.config.mcpServers;
    if (!servers || Object.keys(servers).length === 0) {
      return null;
    }

    // 分离持久化 vs 临时 server
    const ephemeral: Record<string, McpServerEntry> = {};
    const persistent: Record<string, McpServerEntry> = {};
    for (const [name, entry] of Object.entries(servers)) {
      if (entry.persistent) {
        persistent[name] = entry;
      } else {
        ephemeral[name] = entry;
      }
    }

    const result: Record<string, { command: string; args: string[]; env?: Record<string, string> }> = {};

    // 临时 server → nuwax-mcp-stdio-proxy 聚合（现有逻辑）
    const scriptPath = this.getProxyScriptPath();
    if (Object.keys(ephemeral).length > 0 && scriptPath) {
      const resolvedConfig: McpServersConfig = {
        mcpServers: resolveServersConfig(ephemeral),
      };
      const configJson = JSON.stringify(resolvedConfig);
      result['mcp-proxy'] = {
        command: process.execPath,
        args: [scriptPath, '--config', configJson],
        env: { ELECTRON_RUN_AS_NODE: '1' },
      };
    } else if (Object.keys(ephemeral).length > 0) {
      // fallback: 无 proxy 脚本时直接返回解析后的各 server stdio 配置（无聚合）
      const resolved = resolveServersConfig(ephemeral);
      for (const [name, entry] of Object.entries(resolved)) {
        result[name] = entry;
      }
    }

    // 持久化 server → bridge client
    if (Object.keys(persistent).length > 0 && persistentMcpBridge.isRunning()) {
      const bridgeUrls: Record<string, string> = {};
      for (const name of Object.keys(persistent)) {
        const url = persistentMcpBridge.getBridgeUrl(name);
        if (url) bridgeUrls[name] = url;
      }
      if (Object.keys(bridgeUrls).length > 0) {
        const bridgeClientScript = this.getBridgeClientScriptPath();
        if (bridgeClientScript) {
          const dirs = getAppPaths();
          result['mcp-bridge'] = {
            command: process.execPath,
            args: [bridgeClientScript, JSON.stringify(bridgeUrls)],
            env: { ELECTRON_RUN_AS_NODE: '1', NODE_PATH: dirs.nodeModules },
          };
        }
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
