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

import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import * as crypto from "crypto";
import log from "electron-log";
import { app } from "electron";
import {
  getAppEnv,
  getUvBinPath,
  getNodeBinPath,
  getNodeBinPathWithFallback,
} from "../system/dependencies";
import { getAppPaths, isInstalledLocally } from "./packageLocator";
import { resolveNpmPackageEntry } from "../utils/spawnNoWindow";
import { APP_DATA_DIR_NAME } from "../constants";
import { isWindows } from "../system/shellEnv";
import { persistentMcpBridge } from "./persistentMcpBridge";

// ========== Shared Helpers ==========

/**
 * Returns the directory containing the app-internal `uv` binary.
 * Priority: bundled resources/uv/bin → ~/.nuwaclaw/bin
 * Returns empty string if uv not found anywhere.
 */
export function getUvBinDir(): string {
  const p = getUvBinPath();
  if (p && fs.existsSync(p)) return path.dirname(p);
  const appBin = path.join(app.getPath("home"), APP_DATA_DIR_NAME, "bin");
  const uvName = isWindows() ? "uv.exe" : "uv";
  if (fs.existsSync(path.join(appBin, uvName))) return appBin;
  return "";
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
  if (typeof command !== "string") return { command, args };
  const dir = uvBinDir ?? getUvBinDir();
  if (!dir) return { command, args };

  const base = path.basename(command).replace(/\.(exe)?$/i, "");
  if (base === "uvx") {
    // Always use `uv tool run` — the uvx multicall binary is broken in uv >= 0.10
    const uvName = isWindows() ? "uv.exe" : "uv";
    const uvPath = path.join(dir, uvName);
    if (fs.existsSync(uvPath)) {
      return { command: uvPath, args: ["tool", "run", ...args] };
    }
    return { command, args };
  }
  if (base === "uv") {
    const uvName = isWindows() ? "uv.exe" : "uv";
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
  const idx = args.indexOf("--config");
  if (idx < 0 || idx + 1 >= args.length) return { command, args };
  const configStr = args[idx + 1];
  if (typeof configStr !== "string") return { command, args };

  let parsed: {
    mcpServers?: Record<
      string,
      { command?: string; args?: string[]; env?: Record<string, string> }
    >;
  };
  try {
    parsed = JSON.parse(configStr);
  } catch {
    return { command, args };
  }
  const inner = parsed?.mcpServers;
  if (!inner || typeof inner !== "object") return { command, args };

  let changed = false;
  for (const [, srv] of Object.entries(inner)) {
    if (!srv || typeof srv.command !== "string") continue;
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
): Record<string, McpServerEntry> | null {
  // Must be a bridge entry
  if (command !== "mcp-proxy" && path.basename(command) !== "mcp-proxy")
    return null;

  const dir = uvBinDir ?? getUvBinDir();
  const idx = args.indexOf("--config");
  if (idx < 0 || idx + 1 >= args.length) return null;

  const configStr = args[idx + 1];
  if (typeof configStr !== "string") return null;

  let parsed: {
    mcpServers?: Record<
      string,
      {
        command?: string;
        args?: string[];
        env?: Record<string, string>;
        url?: string;
        transport?: string;
        headers?: Record<string, string>;
        authToken?: string;
      }
    >;
  };
  try {
    parsed = JSON.parse(configStr);
  } catch {
    return null;
  }

  const inner = parsed?.mcpServers;
  if (!inner || typeof inner !== "object") return null;

  // 解析 --allow-tools / --deny-tools（从 convert 模式的参数中提取）
  let allowTools: string[] | undefined;
  let denyTools: string[] | undefined;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--allow-tools" && i + 1 < args.length) {
      allowTools = args[i + 1]
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    } else if (args[i] === "--deny-tools" && i + 1 < args.length) {
      denyTools = args[i + 1]
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    }
  }

  // Build base environment variables for child MCP servers
  // Use full getAppEnv() to ensure Windows system variables (SystemRoot, COMSPEC, etc.)
  // and app-internal tool paths (NODE_PATH, NPM_CONFIG_*, UV_*) are available
  const appEnv = getAppEnv();

  const result: Record<string, McpServerEntry> = {};
  for (const [name, srv] of Object.entries(inner)) {
    if (!srv) continue;

    // URL-based entry (SSE / Streamable HTTP) — pass through as RemoteMcpServerEntry
    // Transport detection is handled by the proxy via detectProtocol() at runtime
    if (typeof srv.url === "string") {
      const transport: "sse" | "streamable-http" | undefined =
        srv.transport === "sse"
          ? "sse"
          : srv.transport === "streamable-http"
            ? "streamable-http"
            : undefined;
      result[name] = {
        url: srv.url,
        ...(transport ? { transport } : {}),
        ...(srv.headers ? { headers: srv.headers } : {}),
        ...(srv.authToken ? { authToken: srv.authToken } : {}),
        // 继承 bridge 入口的 allowTools/denyTools 限制
        ...(allowTools ? { allowTools } : {}),
        ...(denyTools ? { denyTools } : {}),
      };
      continue;
    }

    // stdio entry — resolve command/args/env
    if (typeof srv.command !== "string") continue;
    const resolved = resolveUvCommand(srv.command, srv.args || [], dir);
    // Env merge: appEnv as foundation, external env overrides, server-specific env takes precedence
    result[name] = {
      command: resolved.command,
      args: resolved.args,
      env: { ...appEnv, ...env, ...(srv.env || {}) },
      ...(allowTools ? { allowTools } : {}),
      ...(denyTools ? { denyTools } : {}),
    };
  }

  return Object.keys(result).length > 0 ? result : null;
}

/**
 * Apply resolveUvCommand + inject full app env for all server entries.
 * Filters out mcp-proxy bridge entries.
 *
 * Uses getAppEnv() to ensure all necessary environment variables are available,
 * including Windows system variables (SystemRoot, COMSPEC, TEMP, etc.)
 * and app-internal tool paths (NODE_PATH, NPM_CONFIG_*, UV_*).
 */
export function resolveServersConfig(
  servers: Record<string, McpServerEntry>,
): Record<string, McpServerEntry> {
  const appEnv = getAppEnv();
  const dir = getUvBinDir();
  const result: Record<string, McpServerEntry> = {};
  for (const [name, entry] of Object.entries(servers)) {
    // 远程类型直接透传，无需 env / uv 解析
    if (isRemoteEntry(entry)) {
      result[name] = entry;
      continue;
    }
    if (entry.command === "mcp-proxy") continue;
    if (typeof entry.command !== "string") continue;
    const resolved = resolveUvCommand(entry.command, entry.args || [], dir);
    result[name] = {
      command: resolved.command,
      args: resolved.args,
      env: { ...appEnv, ...(entry.env || {}) },
      ...(entry.persistent ? { persistent: true } : {}),
      ...(entry.allowTools ? { allowTools: entry.allowTools } : {}),
      ...(entry.denyTools ? { denyTools: entry.denyTools } : {}),
    };
  }
  return result;
}

// ========== Types ==========

/** 默认 mcpServers 配置 */
export const DEFAULT_MCP_PROXY_CONFIG: McpServersConfig = {
  mcpServers: {
    "chrome-devtools": {
      command: "npx",
      args: ["-y", "chrome-devtools-mcp@latest"],
      persistent: true,
    },
  },
};

/**
 * 为 MCP 服务器配置注入完整应用环境变量
 */
function injectBaseEnvToMcpServers(
  servers: Record<string, McpServerEntry>,
): Record<string, McpServerEntry> {
  const appEnv = getAppEnv();

  const result: Record<string, McpServerEntry> = {};
  for (const [name, entry] of Object.entries(servers)) {
    // 远程类型无需 env 注入
    if (isRemoteEntry(entry)) {
      result[name] = entry;
      continue;
    }
    result[name] = {
      ...entry,
      env: { ...appEnv, ...(entry.env || {}) },
    };
  }
  return result;
}

/** stdio 类型 MCP Server 配置 */
export interface StdioMcpServerEntry {
  command: string;
  args: string[];
  env?: Record<string, string>;
  /** 标记为持久化 server（生命周期由 PersistentMcpBridge 管理，而非跟随 ACP session） */
  persistent?: boolean;
  /** 工具白名单（只暴露指定工具） */
  allowTools?: string[];
  /** 工具黑名单（排除指定工具） */
  denyTools?: string[];
}

/** 远程类型 MCP Server 配置 (Streamable HTTP / SSE) */
export interface RemoteMcpServerEntry {
  url: string;
  transport?: "streamable-http" | "sse";
  headers?: Record<string, string>;
  authToken?: string;
  /** 工具白名单（只暴露指定工具） */
  allowTools?: string[];
  /** 工具黑名单（排除指定工具） */
  denyTools?: string[];
}

/** 单个 MCP Server 的配置（mcpServers 格式） */
export type McpServerEntry = StdioMcpServerEntry | RemoteMcpServerEntry;

/** 判断是否为远程类型（有 url 字段） */
export function isRemoteEntry(
  entry: McpServerEntry,
): entry is RemoteMcpServerEntry {
  return "url" in entry;
}

/** mcpServers 配置（传给 nuwax-mcp-stdio-proxy 的 JSON） */
export interface McpServersConfig {
  mcpServers: Record<string, McpServerEntry>;
  /** 工具白名单（只允许指定的工具） */
  allowTools?: string[];
  /** 工具黑名单（排除指定的工具） */
  denyTools?: string[];
}

/** MCP Proxy 运行状态（语义变更：running = "binary 可用" 而非 "进程在运行"） */
export interface McpProxyStatus {
  running: boolean;
  serverCount?: number;
  serverNames?: string[];
  error?: string;
}

// ========== MCP Proxy Manager ==========

class McpProxyManager {
  private config: McpServersConfig = JSON.parse(
    JSON.stringify(DEFAULT_MCP_PROXY_CONFIG),
  );
  /** Cached script path — set by start(), avoids fs I/O on every getStatus() poll */
  private cachedScriptPath: string | null = null;
  /** Track whether PersistentMcpBridge has been started (lazy initialization) */
  private bridgeStarted = false;
  private lastError: string | null = null;

  // --- Proxy log tail ---
  private logTailTimer: ReturnType<typeof setInterval> | null = null;
  private logTailOffset = 0;
  private logTailPath: string | null = null;
  /** Base log file path (without date suffix) for computing dated file names */
  private logTailBasePath: string | null = null;

  /**
   * Compute today's dated log file path from base path.
   * e.g. /logs/mcp-proxy.log → /logs/mcp-proxy-2026-03-09.log
   */
  private getDatedLogPath(basePath: string): string {
    const d = new Date();
    const pad2 = (n: number) => String(n).padStart(2, "0");
    const dateStr = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
    const ext = path.extname(basePath);
    const base = basePath.slice(0, basePath.length - ext.length);
    return `${base}-${dateStr}${ext}`;
  }

  /**
   * Switch the watcher to today's dated log file if the date has changed.
   */
  private switchLogTailFile(): void {
    if (!this.logTailBasePath) return;
    const datedPath = this.getDatedLogPath(this.logTailBasePath);
    if (datedPath === this.logTailPath) return;

    // Date changed or first start — switch to new file
    if (this.logTailPath) {
      fs.unwatchFile(this.logTailPath);
    }
    this.logTailPath = datedPath;
    this.logTailOffset = 0;
    // Skip to end of existing file
    try {
      const stat = fs.statSync(datedPath);
      this.logTailOffset = stat.size;
    } catch {
      // File doesn't exist yet
    }
    fs.watchFile(datedPath, { interval: 2000 }, () => {
      this.readLogTailLines();
    });
  }

  /**
   * Read new lines from the current log file and forward to electron-log.
   */
  private readLogTailLines(): void {
    if (!this.logTailPath) return;
    try {
      const stat = fs.statSync(this.logTailPath);
      if (stat.size <= this.logTailOffset) return;
      const fd = fs.openSync(this.logTailPath, "r");
      try {
        const buf = Buffer.alloc(stat.size - this.logTailOffset);
        fs.readSync(fd, buf, 0, buf.length, this.logTailOffset);
        this.logTailOffset = stat.size;
        const text = buf.toString("utf-8");
        for (const line of text.split("\n")) {
          if (line.trim()) {
            log.info(line);
          }
        }
      } finally {
        fs.closeSync(fd);
      }
    } catch {
      // File may not exist yet or was rotated — ignore
    }
  }

  /**
   * Start tailing the proxy log file and forwarding new lines to electron-log.
   * Handles date-based log rotation via a periodic check (every 60s).
   */
  private startLogTail(logBasePath: string): void {
    this.stopLogTail();
    this.logTailBasePath = logBasePath;
    this.logTailOffset = 0;

    // Watch today's file immediately
    this.switchLogTailFile();

    // Periodically check for date rollover (every 60s)
    this.logTailTimer = setInterval(() => {
      this.switchLogTailFile();
    }, 60_000);
  }

  /**
   * Stop tailing the proxy log file.
   */
  private stopLogTail(): void {
    if (this.logTailTimer) {
      clearInterval(this.logTailTimer);
      this.logTailTimer = null;
    }
    if (this.logTailPath) {
      fs.unwatchFile(this.logTailPath);
      this.logTailPath = null;
    }
    this.logTailBasePath = null;
    this.logTailOffset = 0;
  }

  /**
   * 解析 nuwax-mcp-stdio-proxy 脚本路径（disk lookup，不使用缓存）
   *
   * nuwax-mcp-stdio-proxy 不再随包集成，仅从 ~/.nuwaclaw/node_modules 安装并解析。
   */
  private resolveProxyScriptPath(): string | null {
    const pkgName = "nuwax-mcp-stdio-proxy";
    const dirs = getAppPaths();
    const packageDir = path.join(dirs.nodeModules, pkgName);
    if (!fs.existsSync(packageDir)) {
      log.warn(
        `[McpProxy] 🔍 resolveProxyScriptPath: 未找到 ${pkgName}（请先在依赖管理中安装）`,
      );
      return null;
    }
    const entry = resolveNpmPackageEntry(packageDir, pkgName);
    if (entry) {
      log.info(
        `[McpProxy] 🔍 resolveProxyScriptPath: 使用 ~/.nuwaclaw 路径: ${entry}`,
      );
      return entry;
    }
    return null;
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
  getPersistentServers(): Record<string, StdioMcpServerEntry> {
    const result: Record<string, StdioMcpServerEntry> = {};
    for (const [name, entry] of Object.entries(this.config.mcpServers)) {
      if (!isRemoteEntry(entry) && entry.persistent) result[name] = entry;
    }
    return result;
  }

  /**
   * 从当前配置中提取所有 stdio 类型 servers（包括 persistent 和临时）
   */
  getAllStdioServers(): Record<string, StdioMcpServerEntry> {
    const result: Record<string, StdioMcpServerEntry> = {};
    for (const [name, entry] of Object.entries(this.config.mcpServers)) {
      if (!isRemoteEntry(entry)) result[name] = entry;
    }
    return result;
  }

  /**
   * start() → 验证 binary 可用性并刷新缓存 + 启动 PersistentMcpBridge（持久化 servers）
   * proxy 进程的生命周期由 Agent 引擎管理（通过 getAgentMcpConfig 注入）
   */
  async start(): Promise<{ success: boolean; error?: string }> {
    // 优先从应用 node_modules（npm 依赖）或 ~/.nuwaclaw/node_modules 解析
    this.cachedScriptPath = this.resolveProxyScriptPath();
    if (!this.cachedScriptPath) {
      this.cachedScriptPath = null;
      if (!isInstalledLocally("nuwax-mcp-stdio-proxy")) {
        const err = "nuwax-mcp-stdio-proxy 未安装，请先在依赖管理中安装或确保已 npm install";
        this.lastError = err;
        return { success: false, error: err };
      }
      const err = "nuwax-mcp-stdio-proxy 入口文件未找到";
      this.lastError = err;
      return { success: false, error: err };
    }
    log.info("[McpProxy] nuwax-mcp-stdio-proxy 就绪:", this.cachedScriptPath);

    // Start tailing proxy log file so its output appears in main.log
    const proxyLogFile = path.join(
      app.getPath("home"),
      APP_DATA_DIR_NAME,
      "logs",
      "mcp-proxy.log",
    );
    this.startLogTail(proxyLogFile);

    // 验证内置 Node.js 资源存在
    const nodeBinPath = getNodeBinPath();
    if (!nodeBinPath) {
      log.warn("[McpProxy] ⚠️ 内置 Node.js 资源未找到");
      log.warn("[McpProxy] 请运行以下命令下载 Node.js 资源:");
      log.warn("[McpProxy]   npm run prepare:node");
      log.warn("[McpProxy] 或运行完整准备:");
      log.warn("[McpProxy]   npm run prepare:all");
      }

    this.lastError = null;
    return { success: true };
  }

  /**
   * stop() → 清除缓存状态 + 停止 PersistentMcpBridge
   */
  async stop(): Promise<{ success: boolean }> {
    this.stopLogTail();
    this.cachedScriptPath = null;
    this.bridgeStarted = false;
    this.lastError = null;
    try {
      await persistentMcpBridge.stop();
      // 重置 bridge 配置缓存，确保下次启动会重新加载
      lastBridgeConfig = null;
    } catch (e) {
      log.warn("[McpProxy] PersistentMcpBridge 停止出错:", e);
    }
    return { success: true };
  }

  /**
   * markBridgeStarted() → 外部调用方（如 syncMcpConfigToProxyAndReload）直接启动了 bridge 后，
   * 通过此方法同步 bridgeStarted 标志，防止 ensureBridgeStarted() 在同一请求内再次重启 bridge。
   */
  markBridgeStarted(): void {
    this.bridgeStarted = true;
  }

  /**
   * ensureBridgeStarted() → 启动 PersistentMcpBridge（已启动则直接命中缓存返回）
   *
   * 设计原则：bridge 只管理 persistent 服务（如 chrome-devtools），动态 MCP 不进 bridge，
   * 由 mcp-proxy 按需 spawn（getAgentMcpConfig 对无 bridge URL 的 server 降级为 stdio）。
   *
   * 缓存逻辑：bridgeStarted 标志为 true 时，直接 return，不重复启动。
   */
  async ensureBridgeStarted(): Promise<void> {
    if (this.bridgeStarted) {
      // 缓存命中：bridge 已在运行，无需重复启动
      log.debug("[McpProxy] ✅ PersistentMcpBridge 缓存命中，跳过重复启动");
      return;
    }
    // 只将 persistent 标记的 server 纳入 bridge（如 chrome-devtools）
    // 动态 MCP 不进 bridge，走 mcp-proxy stdio 按需 spawn
    const persistentServers = this.getPersistentServers();
    if (Object.keys(persistentServers).length > 0) {
      try {
        const resolvedServers = resolveServersConfig(
          persistentServers,
        ) as Record<string, StdioMcpServerEntry>;
        await persistentMcpBridge.start(resolvedServers);
        this.bridgeStarted = true;
        log.info("[McpProxy] PersistentMcpBridge 已启动（persistent servers）:", Object.keys(resolvedServers).join(", "));
      } catch (e) {
        log.error("[McpProxy] PersistentMcpBridge 启动失败:", e);
        throw e;
      }
    } else {
      this.bridgeStarted = true;
    }
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
      error: !this.cachedScriptPath && this.lastError ? this.lastError : undefined,
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
   * 所有 server 统一通过 nuwax-mcp-stdio-proxy 聚合：
   * - persistent server（如 chrome-devtools）→ { url }（bridge URL，长连接 PersistentMcpBridge）
   * - 动态 MCP server → { command, args, env }（stdio，mcp-proxy 按需 spawn）
   * - 远程 server（url 类型）→ 直接透传
   *
   * 所有平台统一使用 process.execPath (Electron Node.js) + ELECTRON_RUN_AS_NODE=1，
   * 避免依赖系统 PATH 中的 node。
   */
  getAgentMcpConfig(): Record<
    string,
    { command: string; args: string[]; env?: Record<string, string> }
  > | null {
    const servers = this.config.mcpServers;
    if (!servers || Object.keys(servers).length === 0) {
      return null;
    }

    const scriptPath = this.getProxyScriptPath();

    // 构建统一的 proxy 配置（混合 stdio、bridge 和远程类型）
    const proxyServers: Record<
      string,
      {
        command?: string;
        args?: string[];
        env?: Record<string, string>;
        url?: string;
        transport?: string;
        headers?: Record<string, string>;
        authToken?: string;
        allowTools?: string[];
        denyTools?: string[];
      }
    > = {};

    // 1. 远程 server → 直接透传（url/transport/headers/authToken）
    // 2. stdio server：
    //    - persistent server（如 chrome-devtools）→ 优先使用 bridge URL（已在 PersistentMcpBridge 中运行）
    //    - 动态 MCP server → bridge 中没有注册，降级到 stdio 配置（由 mcp-proxy 按需 spawn）
    for (const [name, entry] of Object.entries(servers)) {
      if (isRemoteEntry(entry)) {
        proxyServers[name] = entry;
        continue;
      }
      // 尝试获取 bridge URL（persistent server 有，动态 MCP 没有 → 降级 stdio）
      if (persistentMcpBridge.isRunning()) {
        const url = persistentMcpBridge.getBridgeUrl(name);
        if (url) {
          proxyServers[name] = {
            url,
            ...(entry.allowTools ? { allowTools: entry.allowTools } : {}),
            ...(entry.denyTools ? { denyTools: entry.denyTools } : {}),
          };
          continue;
        }
      }
      // 降级：stdio 配置（bridge 未运行或 server 未就绪）
      const resolved = resolveServersConfig({ [name]: entry });
      if (resolved[name]) {
        proxyServers[name] = resolved[name] as (typeof proxyServers)[string];
      }
    }

    if (Object.keys(proxyServers).length === 0) {
      return null;
    }

    // 有 proxy 脚本 → 聚合为单个 proxy 入口
    if (scriptPath) {
      // 使用临时文件传递配置，避免 Windows 命令行长度限制 (32,767 字符)。
      // 文件名使用配置内容的 MD5 哈希（前 16 位），相同配置复用同一文件，
      // 避免每次调用生成新路径，从而防止 detectConfigChange 因文件名变化误判配置变更。
      const configData = { mcpServers: proxyServers };
      const configJson = JSON.stringify(configData);
      const configHash = crypto.createHash("md5").update(configJson).digest("hex").slice(0, 16);
      const configDir = path.join(os.tmpdir(), "nuwax-mcp-configs");
      if (!fs.existsSync(configDir)) {
        fs.mkdirSync(configDir, { recursive: true });
      }
      const configFileName = `mcp-config-${configHash}.json`;
      const configFilePath = path.join(configDir, configFileName);
      // 写入配置（覆盖写入保证内容最新，哈希文件名保证相同内容使用相同路径）
      fs.writeFileSync(configFilePath, configJson, "utf-8");
      log.info(`[McpProxy] MCP 配置已写入临时文件: ${configFilePath}`);

      // 使用应用内置的 Node.js（resources/node/<platform-arch>/bin/node）
      // 开发环境下可回退到系统 node（仅 macOS/Linux）
      const nodeBinPath = getNodeBinPathWithFallback();
      if (!nodeBinPath) {
        log.error("[McpProxy] Node.js 未找到，MCP proxy 无法启动");
        log.error('[McpProxy] 请运行 "npm run prepare:node" 下载 Node.js 资源');
        // 清理临时文件
        try {
          fs.unlinkSync(configFilePath);
        } catch {
          /* ignore */
        }
        return null;
      }

      // 构建精简环境变量，避免 Windows 环境变量长度限制 (32,767)
      // mcp-proxy 只需要应用内集成的工具（node, npm, npx, uv, uvx, git）
      // 不需要用户的系统 PATH，这样可以显著减少环境变量长度
      const proxyEnv = getAppEnv({ includeSystemPath: false });

      // Tell proxy to write logs to a file that we tail into main.log
      proxyEnv.MCP_PROXY_LOG_FILE = path.join(
        app.getPath("home"),
        APP_DATA_DIR_NAME,
        "logs",
        "mcp-proxy.log",
      );

      // 构建 proxy 启动参数，使用 --config-file 避免命令行长度限制
      const proxyArgs = [scriptPath, "--config-file", configFilePath];
      if (this.config.allowTools && this.config.allowTools.length > 0) {
        proxyArgs.push("--allow-tools", this.config.allowTools.join(","));
      } else if (this.config.denyTools && this.config.denyTools.length > 0) {
        proxyArgs.push("--deny-tools", this.config.denyTools.join(","));
      }

      return {
        "mcp-proxy": {
          command: nodeBinPath,
          args: proxyArgs,
          env: proxyEnv,
        },
      };
    }

    // fallback: 无 proxy 脚本时直接返回各 server 的 stdio 配置（仅临时 server）
    const result: Record<
      string,
      { command: string; args: string[]; env?: Record<string, string> }
    > = {};
    for (const [name, entry] of Object.entries(proxyServers)) {
      if (entry.command) {
        result[name] = {
          command: entry.command,
          args: entry.args || [],
          env: entry.env,
        };
      }
    }
    return Object.keys(result).length > 0 ? result : null;
  }

  /**
   * 清理（退出时调用）— 停止 PersistentMcpBridge + kill 子进程
   */
  async cleanup(): Promise<void> {
    this.stopLogTail();
    try {
      await persistentMcpBridge.stop();
    } catch (e) {
      log.warn("[McpProxy] PersistentMcpBridge cleanup error:", e);
    }
  }
}

// ========== Exports ==========

export const mcpProxyManager = new McpProxyManager();

/** 上次用于启动 PersistentMcpBridge 的配置（用于避免不必要的重启） */
let lastBridgeConfig: Record<string, StdioMcpServerEntry> | null = null;

/** 比较两个 stdio 配置是否相等（忽略 env 中的临时变量） */
function configsEqual(
  a: Record<string, StdioMcpServerEntry>,
  b: Record<string, StdioMcpServerEntry> | null,
): boolean {
  if (!b) return false;
  const aKeys = Object.keys(a).sort();
  const bKeys = Object.keys(b).sort();
  if (aKeys.length !== bKeys.length) return false;
  if (aKeys.join(",") !== bKeys.join(",")) return false;

  for (const key of aKeys) {
    const entryA = a[key];
    const entryB = b[key];
    if (entryA.command !== entryB.command) return false;
    if (JSON.stringify(entryA.args) !== JSON.stringify(entryB.args)) return false;
    // persistent 标志必须一致
    if (entryA.persistent !== entryB.persistent) return false;
  }
  return true;
}

/**
 * 将 mcpServers 配置同步到 MCP Proxy 配置并持久化，同时动态重启 PersistentMcpBridge。
 *
 * 设计原则：
 * - chrome-devtools 等默认服务（DEFAULT_MCP_PROXY_CONFIG）始终保留，必须运行
 * - 动态 MCP server 根据传入的 mcpServers 增删：传入为空时仅保留默认服务
 * - 配置未变化时（configsEqual）跳过 bridge 重启，避免无谓抖动
 *
 * 调用时机：每次 ACP 下发 context_servers 时（包括空列表，代表"清空动态 MCP"）
 */
export async function syncMcpConfigToProxyAndReload(
  mcpServers: Record<string, McpServerEntry>,
): Promise<void> {
  // 注意：mcpServers 可以为空（用户删除了所有动态 MCP），此时应重置为仅默认服务，
  // 不在这里提前返回，让后续逻辑重置 bridge 到仅含 chrome-devtools 的状态。

  // 提取真实服务（过滤旧桥接项 command==='mcp-proxy'）
  const realOnly: Record<string, McpServerEntry> = {};
  for (const [name, entry] of Object.entries(mcpServers || {})) {
    if (!entry) continue;
    if (isRemoteEntry(entry)) {
      // 远程类型直接透传
      realOnly[name] = entry;
    } else {
      if (entry.command === "mcp-proxy") continue;
      if (typeof entry.command !== "string") continue;
      realOnly[name] = {
        command: entry.command,
        args: Array.isArray(entry.args) ? entry.args : [],
        env: entry.env,
        ...(entry.allowTools ? { allowTools: entry.allowTools } : {}),
        ...(entry.denyTools ? { denyTools: entry.denyTools } : {}),
      };
    }
  }
  // realOnly 为空时（用户删除了所有动态 MCP）不提前返回，
  // 继续执行以确保 bridge 仅运行默认服务（chrome-devtools）

  // 始终以默认服务为基础，再叠加动态 MCP：
  //   - 用户删除所有动态 MCP → merged 仅含 chrome-devtools
  //   - 用户删除部分动态 MCP → merged 含 chrome-devtools + 剩余动态 MCP
  //   - 用户新增动态 MCP    → merged 含 chrome-devtools + 所有动态 MCP
  const merged: Record<string, McpServerEntry> = {
    ...DEFAULT_MCP_PROXY_CONFIG.mcpServers,
    ...realOnly,
  };

  // 为所有 MCP 服务器注入基础环境变量（包括 PATH）
  const mergedWithEnv = injectBaseEnvToMcpServers(merged);

  // Bridge 只管理 persistent 服务（如 chrome-devtools），动态 MCP 不进 bridge。
  // 变更检测和重启均只针对 persistent servers，避免动态 MCP 变化时重启 chrome-devtools。
  const persistentOnly = Object.fromEntries(
    Object.entries(mergedWithEnv).filter(([, e]) => !isRemoteEntry(e) && (e as StdioMcpServerEntry).persistent),
  ) as Record<string, StdioMcpServerEntry>;
  const resolvedPersistent = resolveServersConfig(
    persistentOnly,
  ) as Record<string, StdioMcpServerEntry>;

  // 更新内存配置（动态 MCP + 默认服务一并写入，供 getAgentMcpConfig 使用）
  const existing = mcpProxyManager.getConfig();
  mcpProxyManager.setConfig({
    mcpServers: mergedWithEnv,
    allowTools: existing.allowTools,
    denyTools: existing.denyTools,
  });

  // Persistent servers 未变化 → 跳过 DB 写入和 bridge 重启（动态 MCP 变化不影响 bridge）
  if (configsEqual(resolvedPersistent, lastBridgeConfig)) {
    log.info("[McpProxy] ✅ Persistent bridge 配置未变化，跳过重启（动态 MCP 走 stdio）");
    mcpProxyManager.markBridgeStarted();
    return;
  }

  // Persistent servers 有变化（如 chrome-devtools 配置变更）→ 持久化并重启 bridge
  log.info("[McpProxy] 同步 MCP 配置 — 全量:", Object.keys(mergedWithEnv).join(", "));
  try {
    const { getDb } = await import("../../db");
    const db = getDb();
    if (db) {
      db.prepare(
        "INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)",
      ).run("mcp_proxy_config", JSON.stringify(mcpProxyManager.getConfig()));
      log.info("[McpProxy] MCP 配置已持久化");
    }
  } catch (e) {
    log.warn("[McpProxy] 持久化 MCP 配置失败:", e);
  }

  // 只重启 persistent servers（chrome-devtools），动态 MCP 不进 bridge，走 mcp-proxy stdio
  try {
    log.info(
      "[McpProxy] 🔄 Persistent bridge 配置变化，重启:",
      Object.keys(resolvedPersistent).join(", "),
    );
    await persistentMcpBridge.start(resolvedPersistent);
    lastBridgeConfig = resolvedPersistent;
    mcpProxyManager.markBridgeStarted();
    log.info("[McpProxy] PersistentMcpBridge 已使用更新配置重启");
  } catch (e) {
    lastBridgeConfig = null;
    log.warn("[McpProxy] PersistentMcpBridge 同步后重启失败:", e);
  }
}
