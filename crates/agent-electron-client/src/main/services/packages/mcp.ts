/**
 * MCP Proxy Manager (Electron)
 *
 * 与 Tauri 客户端一致，使用 mcp-stdio-proxy (mcp-proxy) 统一管理所有 MCP server。
 * 单一进程启动，通过 JSON config 配置所有 mcpServers。
 *
 * 命令格式：mcp-proxy proxy --port <port> --host <host> --config '<json>'
 */

import { spawn, ChildProcess, exec } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as net from 'net';
import log from 'electron-log';
import { app } from 'electron';
import { getAppEnv, getUvBinPath } from '../system/dependencies';
import { getAppPaths, isInstalledLocally } from './packageLocator';
import { spawnJsFile, resolveNpmPackageEntry } from '../utils/spawnNoWindow';
import { DEFAULT_MCP_PROXY_PORT, DEFAULT_MCP_PROXY_HOST, APP_DATA_DIR_NAME, DEFAULT_STARTUP_DELAY } from '../constants';
import { isWindows } from '../system/shellEnv';

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
 * The bridge process inherits env from its parent (ACP engine already has getAppEnv()),
 * so env injection in --config is unnecessary and bloats the command line.
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
    },
  },
};

// ========== Types ==========

/** 单个 MCP Server 的配置（mcpServers 格式） */
export interface McpServerEntry {
  command: string;
  args: string[];
  env?: Record<string, string>;
}

/** mcpServers 配置（传给 mcp-proxy 的 JSON） */
export interface McpServersConfig {
  mcpServers: Record<string, McpServerEntry>;
}

/** MCP Proxy 运行状态 */
export interface McpProxyStatus {
  running: boolean;
  pid?: number;
  port?: number;
  host?: string;
  serverCount?: number;
  serverNames?: string[];
}

/** MCP Proxy 启动配置 */
export interface McpProxyStartConfig {
  port?: number;
  host?: string;
  configJson?: string;  // 序列化的 McpServersConfig
}

// ========== MCP Proxy Manager ==========

/**
 * 检查端口是否被占用
 */
function isPortInUse(port: number, host: string = '127.0.0.1'): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(1000);

    socket.on('connect', () => {
      socket.destroy();
      resolve(true);
    });

    socket.on('timeout', () => {
      socket.destroy();
      resolve(false);
    });

    socket.on('error', () => {
      resolve(false);
    });

    socket.connect(port, host);
  });
}

/**
 * 查找并终止占用指定端口的进程
 */
async function killProcessOnPort(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const platform = process.platform;

    if (platform === 'darwin' || platform === 'linux') {
      // 使用 lsof 查找占用端口的进程
      exec(`lsof -ti:${port}`, (error, stdout) => {
        if (error || !stdout.trim()) {
          resolve(false);
          return;
        }

        const pids = stdout.trim().split('\n');
        log.info(`[McpProxy] 发现端口 ${port} 被进程占用: ${pids.join(', ')}`);

        // 终止所有占用端口的进程
        exec(`kill -9 ${pids.join(' ')}`, (killError) => {
          if (killError) {
            log.warn(`[McpProxy] 终止进程失败: ${killError.message}`);
            resolve(false);
          } else {
            log.info(`[McpProxy] 已终止占用端口 ${port} 的进程`);
            // 等待端口释放
            setTimeout(() => resolve(true), 500);
          }
        });
      });
    } else if (platform === 'win32') {
      // Windows: 使用 netstat 查找进程
      exec(`netstat -ano | findstr :${port}`, (error, stdout) => {
        if (error || !stdout.trim()) {
          resolve(false);
          return;
        }

        // 解析 netstat 输出获取 PID
        const lines = stdout.trim().split('\n');
        const pids = new Set<string>();

        for (const line of lines) {
          const parts = line.trim().split(/\s+/);
          const pid = parts[parts.length - 1];
          if (pid && /^\d+$/.test(pid)) {
            pids.add(pid);
          }
        }

        if (pids.size === 0) {
          resolve(false);
          return;
        }

        log.info(`[McpProxy] 发现端口 ${port} 被进程占用: ${Array.from(pids).join(', ')}`);

        // 终止进程
        exec(`taskkill /F /PID ${Array.from(pids).join(' /PID ')}`, (killError) => {
          if (killError) {
            log.warn(`[McpProxy] 终止进程失败: ${killError.message}`);
            resolve(false);
          } else {
            log.info(`[McpProxy] 已终止占用端口 ${port} 的进程`);
            setTimeout(() => resolve(true), 500);
          }
        });
      });
    } else {
      resolve(false);
    }
  });
}

class McpProxyManager {
  private process: ChildProcess | null = null;
  private port: number = DEFAULT_MCP_PROXY_PORT;
  private host: string = DEFAULT_MCP_PROXY_HOST;
  private config: McpServersConfig = JSON.parse(JSON.stringify(DEFAULT_MCP_PROXY_CONFIG));
  private startPromise: Promise<{ success: boolean; error?: string }> | null = null;

  /**
   * 获取 mcp-proxy 包目录
   */
  private getMcpProxyPackageDir(): string | null {
    const dirs = getAppPaths();

    // 检查 main node_modules
    const mainDir = path.join(dirs.nodeModules, 'mcp-stdio-proxy');
    if (fs.existsSync(mainDir)) return mainDir;

    // 检查 mcp-servers
    const mcpDir = path.join(dirs.mcpModules, 'mcp-stdio-proxy');
    if (fs.existsSync(mcpDir)) return mcpDir;

    return null;
  }

  /**
   * 检查进程是否真正在运行
   */
  private isProcessRunning(): boolean {
    return this.process !== null && !this.process.killed;
  }

  /**
   * 启动 MCP Proxy
   */
  async start(options?: McpProxyStartConfig): Promise<{ success: boolean; error?: string }> {
    // 如果进程已经在运行，直接返回成功
    if (this.isProcessRunning()) {
      log.info('[McpProxy] 进程已在运行中，跳过启动');
      return { success: true };
    }

    // 如果正在启动中，等待启动完成（防止并发调用）
    if (this.startPromise) {
      log.info('[McpProxy] 正在启动中，等待完成...');
      return this.startPromise;
    }

    // 检查 mcp-stdio-proxy 是否已安装
    if (!isInstalledLocally('mcp-stdio-proxy')) {
      return { success: false, error: 'mcp-stdio-proxy 未安装，请先在依赖管理中安装' };
    }

    // 获取包目录并解析入口文件
    const packageDir = this.getMcpProxyPackageDir();
    if (!packageDir) {
      return { success: false, error: 'mcp-stdio-proxy 包目录未找到' };
    }

    const entryPath = resolveNpmPackageEntry(packageDir, 'mcp-proxy');
    if (!entryPath) {
      return { success: false, error: 'mcp-proxy 入口文件未找到' };
    }

    const port = options?.port ?? this.port;
    const host = options?.host ?? this.host;

    // 检查端口是否被占用，如果被占用则尝试终止占用进程
    const portInUse = await isPortInUse(port, host);
    if (portInUse) {
      log.warn(`[McpProxy] 端口 ${port} 已被占用，尝试终止占用进程...`);
      const killed = await killProcessOnPort(port);
      if (!killed) {
        return { success: false, error: `端口 ${port} 被占用且无法终止占用进程` };
      }
      // 再次检查端口
      const stillInUse = await isPortInUse(port, host);
      if (stillInUse) {
        return { success: false, error: `端口 ${port} 仍被占用` };
      }
    }

    // 解析配置
    let config = this.config;
    if (options?.configJson) {
      try {
        config = JSON.parse(options.configJson);
      } catch (e) {
        return { success: false, error: `配置 JSON 解析失败: ${e}` };
      }
    }

    // mcp-stdio-proxy 单进程仅支持单服务，且不能运行桥接项（command===mcp-proxy）
    // 过滤桥接项，若仍有多项则只保留第一项，避免报错「配置包含多个服务，请使用 --name」
    const servers = config.mcpServers || {};
    const realEntries = Object.entries(servers).filter(([, entry]) => entry.command !== 'mcp-proxy');
    if (realEntries.length === 0) {
      config = JSON.parse(JSON.stringify(DEFAULT_MCP_PROXY_CONFIG));
      log.info('[McpProxy] 配置中无真实服务（仅桥接项），使用默认配置');
    } else if (realEntries.length > 1) {
      const first = Object.fromEntries([realEntries[0]]);
      config = { mcpServers: first };
      log.warn('[McpProxy] 配置包含多个真实服务，单进程仅启动第一项:', realEntries[0][0]);
    } else {
      config = { mcpServers: Object.fromEntries(realEntries) };
    }

    // 直接使用应用内环境变量，且 command 指向应用内 uv/uvx 的完整路径，子进程不依赖 PATH
    const appEnv = getAppEnv();
    const baseEnv: Record<string, string> = {
      ...appEnv,
      HOME: process.env.HOME || process.env.USERPROFILE || '',
      USER: process.env.USER || process.env.USERNAME || '',
      USERNAME: process.env.USERNAME || process.env.USER || '',
      LANG: process.env.LANG || 'en_US.UTF-8',
      TZ: process.env.TZ || '',
    };
    const uvDir = getUvBinDir();
    const mcpServersWithEnv: Record<string, McpServerEntry> = {};
    for (const [name, entry] of Object.entries(config.mcpServers || {})) {
      const resolved = resolveUvCommand(entry.command, entry.args || [], uvDir);
      if (resolved.command !== entry.command) {
        log.info(`[McpProxy] 将 ${name} 的 command 指向应用内: ${resolved.command}`);
      }
      mcpServersWithEnv[name] = {
        command: resolved.command,
        args: resolved.args,
        env: { ...baseEnv, ...(entry.env || {}) },
      };
    }
    config = { mcpServers: mcpServersWithEnv };

    const configJson = JSON.stringify(config);
    const finalServers = config.mcpServers || {};
    const serverNames = Object.keys(finalServers);
    const serverCommands = serverNames.map((n) => `${n}=${(finalServers[n] as { command?: string })?.command || '?'}`);
    log.info(`[McpProxy] 追踪: 本次启动的 MCP 配置: 服务数=${serverNames.length}, 列表=${serverCommands.join(', ')}`);

    // 日志目录（对齐 Tauri 客户端）
    const appDataDir = path.join(app.getPath('home'), APP_DATA_DIR_NAME);
    const mcpLogDir = path.join(appDataDir, 'logs', 'mcp');
    try { fs.mkdirSync(mcpLogDir, { recursive: true }); } catch { /* ignore */ }

    const args = [
      'proxy',
      '--port', String(port),
      '--host', host,
      '--config', configJson,
      '--log-dir', mcpLogDir,
    ];

    // 创建启动 Promise 并存储，防止并发调用
    this.startPromise = new Promise((resolve) => {
      let startResolved = false;

      const cleanup = () => {
        this.startPromise = null;
      };

      try {
        // 与 Tauri 一致：proxy 进程与 config 内各服务共用同一套应用内环境（baseEnv），子进程通过 config 的 env 直接获得应用内 PATH/UV_*
        const mcpEnv: Record<string, string> = baseEnv;

        // DEBUG: 输出启动信息（与 Tauri 日志对齐）+ 追踪 uvx 用 env
        const pathSep = isWindows() ? ';' : ':';
        const pathArr = (mcpEnv.PATH || '').split(pathSep).filter(Boolean);
        const pathWithUv = pathArr.filter((p) => p.includes('uv') || p.includes('nuwax-agent'));
        log.info(`[McpProxy] ====== 启动调试信息 ======`);
        log.info(`[McpProxy] 入口文件: ${entryPath}`);
        log.info(`[McpProxy] 参数: ${args.join(' ')}`);
        log.info(`[McpProxy] 端口: ${port}, 主机: ${host}`);
        log.info(`[McpProxy] 环境变量 env 键数: ${Object.keys(mcpEnv).length}`);
        log.info(`[McpProxy] PATH 总段数: ${pathArr.length}, 含 uv/nuwax-agent 的段数: ${pathWithUv.length}`);
        log.info(`[McpProxy] PATH(含uv) 前8段: ${pathWithUv.slice(0, 8).join(' | ') || '(无)'}`);
        log.info(`[McpProxy] UV_INDEX_URL: ${mcpEnv.UV_INDEX_URL || '(未设置)'}`);
        log.info(`[McpProxy] UV_TOOL_DIR: ${mcpEnv.UV_TOOL_DIR || '(未设置)'}`);
        log.info(`[McpProxy] 传入 spawnJsFile 的 env 将作为子进程唯一环境（callerProvidedFullEnv=true 时）`);
        log.info(`[McpProxy] ============================`);

        // 传入完整 mcpEnv，spawnJsFile 会直接使用（不再二次 getAppEnv），与 Tauri env_clear + envs(base) + env(PATH) 行为一致
        const proc = spawnJsFile(entryPath, args, {
          env: mcpEnv,
          stdio: ['ignore', 'pipe', 'pipe'],
        });

        proc.stdout?.on('data', (data) => {
          log.info(`[McpProxy stdout] ${data.toString().trim()}`);
        });

        proc.stderr?.on('data', (data) => {
          log.warn(`[McpProxy stderr] ${data.toString().trim()}`);
        });

        proc.on('error', (error) => {
          log.error(`[McpProxy] 启动错误:`, error);
          this.process = null;
          cleanup();
          if (!startResolved) {
            startResolved = true;
            resolve({ success: false, error: error.message });
          }
        });

        proc.on('exit', (code) => {
          log.info(`[McpProxy] 进程退出, code=${code}`);
          this.process = null;
          // 如果启动还未完成，进程就退出了，返回错误
          if (!startResolved) {
            startResolved = true;
            resolve({ success: false, error: `进程启动后立即退出 (code=${code})` });
          }
          cleanup();
        });

        this.process = proc;
        this.port = port;
        this.host = host;
        this.config = config;

        // 等待进程稳定后返回（与其他服务保持一致的启动延迟）
        setTimeout(() => {
          if (!startResolved) {
            startResolved = true;
            cleanup();
            if (this.process && !this.process.killed) {
              log.info(`[McpProxy] 启动成功, port=${port}`);
              resolve({ success: true });
            } else {
              resolve({ success: false, error: '进程启动后立即退出' });
            }
          }
        }, DEFAULT_STARTUP_DELAY);
      } catch (error) {
        cleanup();
        resolve({ success: false, error: String(error) });
      }
    });

    return this.startPromise;
  }

  /**
   * 停止 MCP Proxy
   */
  async stop(): Promise<{ success: boolean; error?: string }> {
    if (!this.process) {
      return { success: true };
    }

    try {
      this.process.kill();
      this.process = null;
      log.info('[McpProxy] 已停止');
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  /**
   * 重启 MCP Proxy（使用当前配置或新配置）
   */
  async restart(options?: McpProxyStartConfig): Promise<{ success: boolean; error?: string }> {
    await this.stop();
    return this.start(options);
  }

  /**
   * 获取运行状态
   */
  getStatus(): McpProxyStatus {
    const serverNames = Object.keys(this.config.mcpServers || {});
    return {
      running: !!(this.process && !this.process.killed),
      pid: this.process?.pid,
      port: this.port,
      host: this.host,
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
   * 设置 mcpServers 配置（不会自动重启）
   */
  setConfig(config: McpServersConfig): void {
    this.config = config;
  }

  /**
   * 获取端口
   */
  getPort(): number {
    return this.port;
  }

  /**
   * 设置端口（不会自动重启）
   */
  setPort(port: number): void {
    this.port = port;
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
   * 返回 claude-code 的 settings.json 格式:
   * - 如果 MCP Proxy 正在运行，使用 mcp-proxy convert 桥接
   * - 如果未运行，直接返回各 MCP server 的 stdio 配置
   */
  getAgentMcpConfig(): Record<string, { command: string; args: string[]; env?: Record<string, string> }> | null {
    const servers = this.config.mcpServers;
    if (!servers || Object.keys(servers).length === 0) {
      return null;
    }

    // MCP Proxy 运行中：通过 mcp-proxy convert 桥接到统一代理
    if (this.process && !this.process.killed) {
      const proxyUrl = `http://${this.host}:${this.port}`;
      return {
        'mcp-proxy': {
          command: 'mcp-proxy',
          args: ['convert', proxyUrl],
        },
      };
    }

    // MCP Proxy 未运行：回退到直接 stdio 配置（应用路径解析 + env 注入）
    const resolved = resolveServersConfig(servers);
    const result: Record<string, { command: string; args: string[]; env?: Record<string, string> }> = {};
    for (const [id, entry] of Object.entries(resolved)) {
      result[id] = {
        command: entry.command,
        args: entry.args,
        env: entry.env,
      };
    }
    return result;
  }

  /**
   * 清理（退出时调用）
   */
  cleanup(): void {
    if (this.process) {
      this.process.kill();
      this.process = null;
      log.info('[McpProxy] cleanup: 已停止');
    }
  }
}

// ========== Exports ==========

export const mcpProxyManager = new McpProxyManager();

/**
 * 从 mcpServers 中提取「真实」服务：直连项保留；桥接项（command===mcp-proxy）若带 --config 则解析内嵌 mcpServers 并入结果，用于动态加载会话下发的 Time/Fetch 等。
 */
function extractRealServersFromMcpServers(
  mcpServers: Record<string, { command: string; args?: string[]; env?: Record<string, string> }>,
): Record<string, { command: string; args: string[]; env?: Record<string, string> }> {
  const real: Record<string, { command: string; args: string[]; env?: Record<string, string> }> = {};
  for (const [name, entry] of Object.entries(mcpServers)) {
    if (!entry) continue;
    if (entry.command !== 'mcp-proxy') {
      real[name] = { command: entry.command, args: Array.isArray(entry.args) ? entry.args : [], env: entry.env };
      continue;
    }
    const args = entry.args || [];
    const idx = args.indexOf('--config');
    if (idx < 0 || idx + 1 >= args.length) continue;
    const configStr = args[idx + 1];
    if (typeof configStr !== 'string') continue;
    try {
      const parsed = JSON.parse(configStr) as { mcpServers?: Record<string, { command?: string; args?: string[]; env?: Record<string, string> }> };
      const inner = parsed?.mcpServers;
      if (!inner || typeof inner !== 'object') continue;
      for (const [k, v] of Object.entries(inner)) {
        if (!v || typeof v.command !== 'string' || v.command === 'mcp-proxy') continue;
        real[k] = { command: v.command, args: Array.isArray(v.args) ? v.args : [], env: v.env };
      }
    } catch {
      /* ignore parse error */
    }
  }
  return real;
}

/**
 * 将 mcpServers 配置同步到 MCP Proxy 并可选重启（真实服务：直连项 + 从桥接项 --config 解析出的内嵌服务；
 * 单服务时同步，多服务时优先 time 再取第一项）。支持按会话动态加载：每次请求带 context_servers 时调用，proxy 随会话更新。
 */
export async function syncMcpConfigToProxyAndReload(
  mcpServers: Record<string, { command: string; args?: string[]; env?: Record<string, string> }>,
): Promise<void> {
  if (!mcpServers || Object.keys(mcpServers).length === 0) return;
  let realOnly = extractRealServersFromMcpServers(mcpServers);
  if (Object.keys(realOnly).length === 0) {
    log.info('[McpProxy] MCP 配置均为桥接项且无 --config 内嵌真实服务，不同步到 proxy');
    return;
  }
  log.info('[McpProxy] 同步所有真实服务到 proxy 配置:', Object.keys(realOnly).join(', '));
  const config = { mcpServers: realOnly };
  mcpProxyManager.setConfig(config);
  try {
    const { getDb } = await import('../../db');
    const db = getDb();
    if (db) {
      db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('mcp_proxy_config', JSON.stringify(config));
      log.info('[McpProxy] MCP 配置已持久化');
    }
  } catch (e) {
    log.warn('[McpProxy] 持久化 MCP 配置失败:', e);
  }
  const status = mcpProxyManager.getStatus();
  if (status.running) {
    await mcpProxyManager.restart();
    log.info('[McpProxy] 已重启并加载新配置:', Object.keys(realOnly));
  }
}
