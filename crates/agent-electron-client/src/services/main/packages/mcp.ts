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
import { getAppEnv } from '../system/dependencies';
import { getAppPaths, isInstalledLocally } from './packageLocator';
import { DEFAULT_MCP_PROXY_PORT, DEFAULT_MCP_PROXY_HOST, APP_DATA_DIR_NAME } from '../constants';

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
   * 获取 mcp-proxy 可执行文件路径
   */
  private getMcpProxyBinPath(): string | null {
    const dirs = getAppPaths();
    const binName = process.platform === 'win32' ? 'mcp-proxy.cmd' : 'mcp-proxy';

    // 检查应用内安装
    const localBinPath = path.join(dirs.nodeModules, '.bin', binName);
    if (fs.existsSync(localBinPath)) {
      return localBinPath;
    }

    // 未找到
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

    const binPath = this.getMcpProxyBinPath();
    if (!binPath) {
      return { success: false, error: 'mcp-proxy 可执行文件未找到' };
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

    const configJson = JSON.stringify(config);

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

    log.info(`[McpProxy] 启动: ${binPath} ${args.join(' ')}`);

    // 创建启动 Promise 并存储，防止并发调用
    this.startPromise = new Promise((resolve) => {
      try {
        // MCP Proxy 需要访问系统 npm 以运行 chrome-devtools-mcp 等工具
        // 因此不能完全隔离，只注入必要的应用内路径
        const appEnv = getAppEnv();

        // 构建 mcp-proxy 专用环境
        // 不继承 process.env，避免传递用户的 npm 配置
        // 只保留必要的环境变量
        const platform = process.platform;
        const mcpEnv: Record<string, string> = {
          // PATH：应用内优先
          PATH: appEnv.PATH,
          // Node.js 相关
          NODE_PATH: appEnv.NODE_PATH,
          NODE_ENV: process.env.NODE_ENV || 'production',
          // Python/uv 相关
          UV_TOOL_DIR: appEnv.UV_TOOL_DIR,
          UV_CACHE_DIR: appEnv.UV_CACHE_DIR,
          UV_INDEX_URL: appEnv.UV_INDEX_URL,
          // 用户目录（保持系统默认，不隔离）
          HOME: process.env.HOME || process.env.USERPROFILE || '',
          USER: process.env.USER || process.env.USERNAME || '',
          USERNAME: process.env.USERNAME || process.env.USER || '',
          // 语言环境
          LANG: process.env.LANG || 'en_US.UTF-8',
          TZ: process.env.TZ || '',
        };

        const proc = spawn(binPath, args, {
          env: mcpEnv,
          stdio: ['ignore', 'pipe', 'pipe'],
          windowsHide: true,
        });

        let startResolved = false;

        const cleanup = () => {
          this.startPromise = null;
        };

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

        // 等待进程稳定后返回
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
        }, 500);
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
  getAgentMcpConfig(): Record<string, { command: string; args: string[] }> | null {
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

    // MCP Proxy 未运行：回退到直接 stdio 配置
    const result: Record<string, { command: string; args: string[] }> = {};
    for (const [id, entry] of Object.entries(servers)) {
      result[id] = {
        command: entry.command,
        args: entry.args,
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
