import { spawn } from 'child_process';
import log from 'electron-log';
import * as path from 'path';
import * as fs from 'fs';
import {
  getAppPaths,
  isInstalledLocally,
  isInstalledGlobally,
  getPackageInfo,
  getLocalPackages,
  spawnLocal,
  PackageInfo,
} from './packageLocator';

// Ensure app paths are initialized
const dirs = getAppPaths();

export interface MCPServer {
  id: string;
  name: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
  enabled: boolean;
  installed?: boolean;
  installedLocally?: boolean;
  installedGlobally?: boolean;
  running?: boolean;
  description?: string;
  version?: string;         // 本地版本
  latestVersion?: string;   // 最新版本
  hasUpdate?: boolean;      // 是否有更新
}

export interface MCPConfig {
  servers: MCPServer[];
  registry?: string;
}

// Default MCP servers
export const defaultMCPServers: MCPServer[] = [
  {
    id: 'filesystem',
    name: 'Filesystem',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-filesystem', '/Users'],
    description: 'Read and write files on the filesystem',
    enabled: false,
  },
  {
    id: 'brave-search',
    name: 'Brave Search',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-brave-search'],
    description: 'Web search using Brave Search API',
    enabled: false,
  },
  {
    id: 'github',
    name: 'GitHub',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-github'],
    description: 'Interact with GitHub API (requires GITHUB_TOKEN)',
    enabled: false,
  },
  {
    id: 'sqlite',
    name: 'SQLite',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-sqlite'],
    description: 'Query SQLite databases',
    enabled: false,
  },
  {
    id: 'puppeteer',
    name: 'Puppeteer',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-puppeteer'],
    description: 'Browser automation',
    enabled: false,
  },
  {
    id: 'fetch',
    name: 'Fetch',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-fetch'],
    description: 'HTTP fetch capabilities',
    enabled: false,
  },
];

// Mirror registries for China
export const npmRegistries = {
  default: 'https://registry.npmjs.org/',
  china: {
    taobao: 'https://registry.npmmirror.com/',
    tencent: 'https://mirrors.cloud.tencent.com/npm/',
    aliyun: 'https://registry.npm.taobao.org/',
  },
};

class MCPManager {
  private servers: MCPServer[] = [];
  private registry: string = npmRegistries.default;
  private processes: Map<string, ReturnType<typeof spawn>> = new Map();

  constructor() {
    this.servers = [...defaultMCPServers];
  }

  setRegistry(registry: string) {
    this.registry = registry;
  }

  getRegistry(): string {
    return this.registry;
  }

  getServers(): MCPServer[] {
    return this.servers;
  }

  getServer(id: string): MCPServer | undefined {
    return this.servers.find((s) => s.id === id);
  }

  // Get package name from args
  private getPackageName(server: MCPServer): string {
    // Extract package name from args (e.g., "-y", "@modelcontextprotocol/server-filesystem" -> "@modelcontextprotocol/server-filesystem")
    return server.args.find((arg) => arg.startsWith('@')) || '';
  }

  // Get local version
  private getLocalVersion(packageName: string): string | null {
    const { getLocalVersion } = require('./packageLocator');
    return getLocalVersion(packageName);
  }

  // Get latest version from npm
  private async getLatestVersion(packageName: string): Promise<string | null> {
    return new Promise((resolve) => {
      const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
      const proc = spawn(npmCmd, ['view', packageName, 'version', '--json'], {
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      
      let stdout = '';
      proc.stdout?.on('data', (data) => { stdout += data.toString(); });
      proc.on('close', () => {
        try {
          resolve(JSON.parse(stdout.trim()) || null);
        } catch { resolve(null); }
      });
      proc.on('error', () => resolve(null));
    });
  }

  // Check version and updates
  async checkVersion(id: string): Promise<void> {
    const server = this.servers.find((s) => s.id === id);
    if (!server) return;

    const packageName = this.getPackageName(server);
    const localVersion = this.getLocalVersion(packageName);
    const latestVersion = await this.getLatestVersion(packageName);

    server.version = localVersion || undefined;
    server.latestVersion = latestVersion || undefined;
    server.hasUpdate = !!(
      localVersion && 
      latestVersion && 
      localVersion !== latestVersion
    );
  }

  // Check all versions
  async checkAllVersions(): Promise<void> {
    for (const server of this.servers) {
      await this.checkVersion(server.id);
    }
  }

  // Check installation status - local vs global (also updates version info)
  async checkInstalledStatus(id: string): Promise<boolean> {
    const server = this.servers.find((s) => s.id === id);
    if (!server) return false;

    const packageName = this.getPackageName(server);
    
    // Check local installation first
    const locallyInstalled = isInstalledLocally(packageName);
    const globallyInstalled = await isInstalledGlobally(packageName);
    
    server.installedLocally = locallyInstalled;
    server.installedGlobally = globallyInstalled;
    server.installed = locallyInstalled || globallyInstalled;
    
    log.info(`[MCP] ${packageName}: local=${locallyInstalled}, global=${globallyInstalled}`);
    
    return locallyInstalled || globallyInstalled;
  }

  // Install MCP server locally (not globally)
  async installServer(id: string): Promise<{ success: boolean; error?: string; isLocal?: boolean }> {
    const server = this.servers.find((s) => s.id === id);
    if (!server) {
      return { success: false, error: 'Server not found' };
    }

    const packageName = this.getPackageName(server);
    
    // First check if already installed locally
    if (isInstalledLocally(packageName)) {
      log.info(`[MCP] ${packageName} already installed locally`);
      server.installed = true;
      server.installedLocally = true;
      return { success: true, isLocal: true };
    }

    return new Promise((resolve) => {
      const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
      
      // Install to LOCAL directory, not global
      const args = [
        'install',
        '--save',      // Save to package.json
        '--no-save',   // But don't save exact version
        packageName,
        `--registry=${this.registry}`,
      ];

      log.info(`[MCP] Installing ${packageName} locally in ${dirs.mcpModules}`);

      const proc = spawn(npmCmd, args, {
        cwd: dirs.mcpModules,
        env: {
          ...process.env,
          NPM_CONFIG_PREFIX: dirs.appData, // Use local prefix
        },
        stdio: 'pipe',
      });

      let stdout = '';
      let stderr = '';

      proc.stdout?.on('data', (data) => {
        stdout += data.toString();
      });

      proc.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      proc.on('error', (error) => {
        log.error(`[MCP] Install error:`, error);
        resolve({ success: false, error: error.message });
      });

      proc.on('close', (code) => {
        if (code === 0) {
          log.info(`[MCP] ${packageName} installed locally`);
          server.installed = true;
          server.installedLocally = true;
          resolve({ success: true, isLocal: true });
        } else {
          log.error(`[MCP] Install failed:`, stderr);
          resolve({ success: false, error: stderr || 'Install failed', isLocal: false });
        }
      });
    });
  }

  // Uninstall MCP server (removes from local)
  async uninstallServer(id: string): Promise<{ success: boolean; error?: string }> {
    const server = this.servers.find((s) => s.id === id);
    if (!server) {
      return { success: false, error: 'Server not found' };
    }

    const packageName = this.getPackageName(server);
    
    // Only uninstall if installed locally
    if (!isInstalledLocally(packageName)) {
      server.installed = false;
      server.installedLocally = false;
      return { success: true };
    }

    return new Promise((resolve) => {
      const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
      const args = ['uninstall', packageName];

      log.info(`[MCP] Uninstalling ${packageName} from local`);

      const proc = spawn(npmCmd, args, {
        cwd: dirs.mcpModules,
        stdio: 'pipe',
      });

      let stderr = '';

      proc.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      proc.on('error', (error) => {
        resolve({ success: false, error: error.message });
      });

      proc.on('close', (code) => {
        if (code === 0) {
          server.installed = false;
          server.installedLocally = false;
          server.running = false;
          resolve({ success: true });
        } else {
          resolve({ success: false, error: stderr });
        }
      });
    });
  }

  // Start MCP server using LOCAL executable
  async startServer(id: string): Promise<{ success: boolean; error?: string }> {
    const server = this.servers.find((s) => s.id === id);
    if (!server || !server.enabled) {
      return { success: false, error: 'Server not enabled' };
    }

    if (this.processes.has(id)) {
      return { success: true }; // Already running
    }

    // Check if installed locally
    const packageName = this.getPackageName(server);
    if (!isInstalledLocally(packageName)) {
      return { success: false, error: 'Package not installed locally' };
    }

    try {
      // Use spawnLocal to ensure we use local npx
      const proc = spawnLocal(
        packageName,
        server.args.slice(1), // Skip the package name
        {
          registry: this.registry,
          env: server.env,
        }
      );

      proc.on('error', (error) => {
        log.error(`MCP server ${id} error:`, error);
        this.processes.delete(id);
        server.running = false;
      });

      proc.on('exit', (code) => {
        log.info(`MCP server ${id} exited with code ${code}`);
        this.processes.delete(id);
        server.running = false;
      });

      this.processes.set(id, proc);
      server.running = true;
      
      log.info(`MCP server ${id} started (local)`);
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  // Stop MCP server
  async stopServer(id: string): Promise<{ success: boolean; error?: string }> {
    const server = this.servers.find((s) => s.id === id);
    if (!server) {
      return { success: false, error: 'Server not found' };
    }

    const proc = this.processes.get(id);
    if (proc) {
      proc.kill();
      this.processes.delete(id);
      server.running = false;
      return { success: true };
    }
    return { success: false, error: 'Not running' };
  }

  toggleServer(id: string, enabled: boolean): void {
    const server = this.servers.find((s) => s.id === id);
    if (server) {
      server.enabled = enabled;
      if (!enabled && server.running) {
        this.stopServer(id);
      }
    }
  }

  async stopAll(): Promise<void> {
    for (const server of this.servers) {
      if (server.running) {
        await this.stopServer(server.id);
      }
    }
  }

  async getRunningServers(): Promise<string[]> {
    return Array.from(this.processes.keys());
  }

  async loadConfig(config: MCPConfig): Promise<void> {
    if (config.servers) {
      this.servers = defaultMCPServers.map((defaultServer) => {
        const saved = config.servers.find((s) => s.id === defaultServer.id);
        if (saved) {
          return { ...defaultServer, ...saved };
        }
        return defaultServer;
      });
    }
    if (config.registry) {
      this.registry = config.registry;
    }
    
    // Check installation status for all servers
    for (const server of this.servers) {
      await this.checkInstalledStatus(server.id);
    }
  }

  exportConfig(): MCPConfig {
    return {
      servers: this.servers.map((s) => ({
        id: s.id,
        name: s.name,
        command: s.command,
        args: s.args,
        env: s.env,
        enabled: s.enabled,
      })),
      registry: this.registry,
    };
  }
}

export const mcpManager = new MCPManager();
