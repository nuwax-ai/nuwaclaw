/**
 * Agent Engine Manager - 引擎安装与配置隔离
 * 
 * 支持 claude-code 和 nuwaxcode 的:
 * - 本地安装 (应用目录)
 * - 环境变量隔离
 * - 配置隔离
 */

import * as path from 'path';
import * as fs from 'fs';
import { spawn } from 'child_process';
import log from 'electron-log';

// ==================== Types ====================

export type AgentEngine = 'claude-code' | 'nuwaxcode';

export interface EngineConfig {
  engine: AgentEngine;
  // 安装
  installPath?: string;
  // 运行时隔离
  isolatedHome?: string;
  isolatedConfig?: string;
  // API 配置
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  // 工作目录
  workspaceDir?: string;
}

export interface EngineStatus {
  installed: boolean;
  version?: string;
  running: boolean;
  pid?: number;
  error?: string;
}

// ==================== Paths ====================

function getAppDataDir(): string {
  const home = process.env.HOME || process.env.USERPROFILE || '';
  return path.join(home, '.nuwax-agent');
}

function getEnginesDir(): string {
  return path.join(getAppDataDir(), 'engines');
}

function getEngineDir(engine: AgentEngine): string {
  return path.join(getEnginesDir(), engine);
}

function getIsolatedHomeDir(runId: string): string {
  return path.join('/tmp', `nuwax-agent-${runId}`);
}

// ==================== Engine Detection ====================

/**
 * 检测引擎是否已安装 (本地)
 */
export function isEngineInstalledLocally(engine: AgentEngine): boolean {
  const engineDir = getEngineDir(engine);
  
  if (engine === 'claude-code') {
    // 检查 claude-code 可执行文件
    const binPaths = [
      path.join(engineDir, 'bin', 'claude-code'),
      path.join(engineDir, 'claude-code'),
      path.join(getAppDataDir(), 'node_modules', '.bin', 'claude-code'),
    ];
    
    for (const p of binPaths) {
      if (fs.existsSync(p)) return true;
      if (fs.existsSync(p + '.exe')) return true;
      if (fs.existsSync(p + '.cmd')) return true;
    }
  }
  
  if (engine === 'nuwaxcode') {
    const binPaths = [
      path.join(engineDir, 'bin', 'nuwaxcode'),
      path.join(engineDir, 'nuwaxcode'),
      path.join(getAppDataDir(), 'node_modules', '.bin', 'nuwaxcode'),
    ];
    
    for (const p of binPaths) {
      if (fs.existsSync(p)) return true;
      if (fs.existsSync(p + '.exe')) return true;
      if (fs.existsSync(p + '.cmd')) return true;
    }
  }
  
  return false;
}

/**
 * 检测系统全局安装
 */
export async function isEngineInstalledGlobally(engine: AgentEngine): Promise<boolean> {
  const cmd = engine === 'claude-code' ? 'claude-code' : 'nuwaxcode';
  
  return new Promise((resolve) => {
    const checkCmd = process.platform === 'win32' ? 'where' : 'which';
    const proc = spawn(checkCmd, [cmd], { stdio: ['ignore', 'pipe', 'ignore'] });
    
    proc.on('close', (code) => {
      resolve(code === 0);
    });
    
    proc.on('error', () => resolve(false));
  });
}

/**
 * 获取引擎版本
 */
export async function getEngineVersion(engine: AgentEngine): Promise<string | null> {
  // 先尝试本地
  const localEngine = findEngineBinary(engine);
  
  return new Promise((resolve) => {
    const cmd = localEngine || (engine === 'claude-code' ? 'claude-code' : 'nuwaxcode');
    const args = ['--version'];
    
    const proc = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'ignore'] });
    
    let stdout = '';
    proc.stdout?.on('data', (data) => { stdout += data.toString(); });
    
    proc.on('close', () => {
      const match = stdout.match(/(\d+\.\d+\.\d+)/);
      resolve(match ? match[1] : null);
    });
    
    proc.on('error', () => resolve(null));
  });
}

/**
 * 查找引擎可执行文件路径
 */
export function findEngineBinary(engine: AgentEngine): string | null {
  const engineDir = getEngineDir(engine);
  
  if (engine === 'claude-code') {
    const candidates = [
      path.join(engineDir, 'bin', 'claude-code'),
      path.join(engineDir, 'claude-code'),
      path.join(getAppDataDir(), 'node_modules', '.bin', 'claude-code'),
    ];
    
    for (const p of candidates) {
      if (fs.existsSync(p)) return p;
      if (fs.existsSync(p + '.cmd')) return p + '.cmd';
      if (fs.existsSync(p + '.exe')) return p + '.exe';
    }
  }
  
  if (engine === 'nuwaxcode') {
    const candidates = [
      path.join(engineDir, 'bin', 'nuwaxcode'),
      path.join(engineDir, 'nuwaxcode'),
      path.join(getAppDataDir(), 'node_modules', '.bin', 'nuwaxcode'),
    ];
    
    for (const p of candidates) {
      if (fs.existsSync(p)) return p;
      if (fs.existsSync(p + '.cmd')) return p + '.cmd';
      if (fs.existsSync(p + '.exe')) return p + '.exe';
    }
  }
  
  return null;
}

// ==================== Engine Installation ====================

/**
 * 安装引擎到本地目录
 */
export async function installEngine(
  engine: AgentEngine,
  options?: { registry?: string }
): Promise<{ success: boolean; error?: string }> {
  const engineDir = getEngineDir(engine);
  
  // 确保目录存在
  if (!fs.existsSync(engineDir)) {
    fs.mkdirSync(engineDir, { recursive: true });
  }
  
  const packageName = engine === 'claude-code' ? 'claude-code' : 'nuwaxcode';
  
  return new Promise((resolve) => {
    const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    const args = ['install', '--save', packageName];
    
    if (options?.registry) {
      args.push(`--registry=${options.registry}`);
    }
    
    log.info(`[Engine] Installing ${packageName} to ${engineDir}`);
    
    const proc = spawn(npmCmd, args, {
      cwd: engineDir,
      env: {
        ...process.env,
        NPM_CONFIG_PREFIX: getAppDataDir(),
      },
      stdio: 'pipe',
    });
    
    let stderr = '';
    proc.stderr?.on('data', (data) => { stderr += data.toString(); });
    
    proc.on('error', (error) => {
      log.error(`[Engine] Install error:`, error);
      resolve({ success: false, error: error.message });
    });
    
    proc.on('close', (code) => {
      if (code === 0) {
        log.info(`[Engine] ${packageName} installed successfully`);
        resolve({ success: true });
      } else {
        log.error(`[Engine] Install failed:`, stderr);
        resolve({ success: false, error: stderr || 'Install failed' });
      }
    });
  });
}

// ==================== Environment Isolation ====================

/**
 * 生成唯一运行 ID
 */
function generateRunId(): string {
  return `run-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
}

/**
 * 创建隔离环境
 */
export function createIsolatedEnvironment(config: EngineConfig): {
  env: Record<string, string>;
  runId: string;
  cleanup: () => void;
} {
  const runId = generateRunId();
  const isolatedHome = getIsolatedHomeDir(runId);
  
  // 创建隔离目录
  if (!fs.existsSync(isolatedHome)) {
    fs.mkdirSync(isolatedHome, { recursive: true });
    
    // 创建必要子目录
    fs.mkdirSync(path.join(isolatedHome, '.claude'), { recursive: true });
    fs.mkdirSync(path.join(isolatedHome, '.nuwaxcode'), { recursive: true });
  }
  
  // 构建隔离环境变量
  const env: Record<string, string> = {
    ...process.env,
    
    // 隔离 HOME 目录 - 避免读取全局配置
    HOME: isolatedHome,
    
    // 隔离 XDG 配置
    XDG_CONFIG_HOME: path.join(isolatedHome, '.config'),
    XDG_DATA_HOME: path.join(isolatedHome, '.local', 'share'),
    XDG_CACHE_HOME: path.join(isolatedHome, '.cache'),
    
    // 显式配置路径
    CLAUDE_CONFIG_DIR: path.join(isolatedHome, '.claude'),
    NUWAXCODE_CONFIG_DIR: path.join(isolatedHome, '.nuwaxcode'),
  };
  
  // API 配置 (优先使用注入的值)
  if (config.apiKey) {
    env.ANTHROPIC_API_KEY = config.apiKey;
  }
  
  if (config.baseUrl) {
    env.ANTHROPIC_BASE_URL = config.baseUrl;
    env.ANTHROPIC_API_BASE_URL = config.baseUrl;
  }
  
  if (config.model) {
    env.ANTHROPIC_MODEL = config.model;
  }
  
  // 清理函数
  const cleanup = () => {
    try {
      // 可选: 清理临时目录
      // fs.rmSync(isolatedHome, { recursive: true, force: true });
      log.info(`[Engine] Run ${runId} cleanup (kept temp dir for debugging)`);
    } catch (error) {
      log.error(`[Engine] Cleanup error:`, error);
    }
  };
  
  log.info(`[Engine] Created isolated environment: ${isolatedHome}`);
  
  return { env, runId, cleanup };
}

// ==================== Engine Runner ====================

interface RunningEngine {
  process: ReturnType<typeof spawn>;
  config: EngineConfig;
  runId: string;
  cleanup: () => void;
}

const runningEngines: Map<string, RunningEngine> = new Map();

/**
 * 启动引擎
 */
export async function startEngine(
  config: EngineConfig
): Promise<{ success: boolean; error?: string; engineId?: string }> {
  // 查找引擎可执行文件
  const engineBinary = findEngineBinary(config.engine);
  
  if (!engineBinary) {
    return { success: false, error: `${config.engine} not installed` };
  }
  
  // 创建隔离环境
  const { env, runId, cleanup } = createIsolatedEnvironment(config);
  
  // 构建启动参数
  let args: string[] = [];
  
  switch (config.engine) {
    case 'claude-code':
      args = ['--sACP'];
      break;
    case 'nuwaxcode':
      args = ['serve', '--stdio'];
      break;
  }
  
  // 可选: 添加配置文件路径
  if (config.engine === 'claude-code') {
    const configPath = path.join(getIsolatedHomeDir(runId), 'config.yaml');
    // 如果有自定义配置
    //config', configPath args.push('--);
  }
  
  log.info(`[Engine] Starting ${config.engine}: ${engineBinary} ${args.join(' ')}`);
  
  return new Promise((resolve) => {
    const proc = spawn(engineBinary, args, {
      env,
      cwd: config.workspaceDir || getAppDataDir(),
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    
    proc.on('error', (error) => {
      log.error(`[Engine] Start error:`, error);
      cleanup();
      resolve({ success: false, error: error.message });
    });
    
    proc.on('exit', (code) => {
      log.info(`[Engine] ${config.engine} exited with code ${code}`);
      cleanup();
      runningEngines.delete(runId);
    });
    
    // 等待进程启动
    setTimeout(() => {
      if (proc.pid) {
        const engineId = runId;
        runningEngines.set(runId, {
          process: proc,
          config,
          runId,
          cleanup,
        });
        
        log.info(`[Engine] ${config.engine} started with PID ${proc.pid}`);
        resolve({ success: true, engineId });
      } else {
        cleanup();
        resolve({ success: false, error: 'Failed to start process' });
      }
    }, 1000);
  });
}

/**
 * 停止引擎
 */
export async function stopEngine(engineId: string): Promise<{ success: boolean; error?: string }> {
  const engine = runningEngines.get(engineId);
  
  if (!engine) {
    return { success: false, error: 'Engine not running' };
  }
  
  try {
    engine.process.kill();
    engine.cleanup();
    runningEngines.delete(engineId);
    
    return { success: true };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

/**
 * 获取引擎状态
 */
export function getEngineStatus(engineId?: string): EngineStatus | Record<string, EngineStatus> {
  if (engineId) {
    const engine = runningEngines.get(engineId);
    if (engine) {
      return {
        installed: true,
        running: true,
        pid: engine.process.pid,
      };
    }
    return { installed: false, running: false };
  }
  
  // 返回所有运行中的引擎
  const statuses: Record<string, EngineStatus> = {};
  for (const [id, engine] of runningEngines) {
    statuses[id] = {
      installed: true,
      running: true,
      pid: engine.process.pid,
    };
  }
  return statuses;
}

/**
 * 发送消息到引擎 (通过 stdin)
 */
export async function sendToEngine(engineId: string, message: string): Promise<{ success: boolean; error?: string }> {
  const engine = runningEngines.get(engineId);
  
  if (!engine || !engine.process.stdin) {
    return { success: false, error: 'Engine not running' };
  }
  
  return new Promise((resolve) => {
    engine.process.stdin!.write(message + '\n', (error) => {
      if (error) {
        resolve({ success: false, error: error.message });
      } else {
        resolve({ success: true });
      }
    });
  });
}

/**
 * 停止所有引擎
 */
export async function stopAllEngines(): Promise<void> {
  for (const [id, engine] of runningEngines) {
    try {
      engine.process.kill();
      engine.cleanup();
    } catch (error) {
      log.error(`[Engine] Error stopping ${id}:`, error);
    }
  }
  runningEngines.clear();
}

export default {
  // Detection
  isEngineInstalledLocally,
  isEngineInstalledGlobally,
  getEngineVersion,
  findEngineBinary,
  
  // Installation
  installEngine,
  
  // Isolation
  createIsolatedEnvironment,
  
  // Runtime
  startEngine,
  stopEngine,
  getEngineStatus,
  sendToEngine,
  stopAllEngines,
};
