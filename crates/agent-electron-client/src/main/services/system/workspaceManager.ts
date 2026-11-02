/**
 * Workspace Manager - Session 与 Workspace 映射
 * 
 * 每个会话对应一个独立的工作目录
 * 与 Tauri 客户端保持一致
 */

import * as path from 'path';
import * as fs from 'fs';
import log from 'electron-log';
import { APP_DATA_DIR_NAME } from '../constants';

// ==================== Paths ====================

/**
 * 获取应用数据目录
 */
export function getAppDataDir(): string {
  const home = process.env.HOME || process.env.USERPROFILE || '';
  return path.join(home, APP_DATA_DIR_NAME);
}

/**
 * 获取工作空间根目录
 */
export function getWorkspacesDir(): string {
  return path.join(getAppDataDir(), 'workspaces');
}

/**
 * 获取默认工作目录 (Setup 中配置)
 */
export function getDefaultWorkspace(): string {
  // 从设置中读取
  // TODO: 从 SQLite 读取
  return path.join(getAppDataDir(), 'default-workspace');
}

// ==================== Session Workspace ====================

/**
 * 获取会话的工作目录
 * 
 * 规则:
 * - 用户指定的工作目录 → 使用用户指定的目录
 * - 无指定 → 无工作目录
 * 
 * 注意: 工作目录由用户在创建会话时指定，不自动生成
 */
export function getSessionWorkspace(sessionId: string, userSpecifiedDir?: string): string {
  // 用户指定的工作目录优先
  if (userSpecifiedDir) {
    return userSpecifiedDir;
  }
  
  // 没有指定则返回空或默认目录
  return '';
}

/**
 * 验证工作目录是否存在
 */
export function validateWorkspaceDir(dir: string): {
  valid: boolean;
  error?: string;
} {
  if (!dir) {
    return { valid: false, error: 'No workspace directory specified' };
  }
  
  if (!fs.existsSync(dir)) {
    return { valid: false, error: 'Directory does not exist' };
  }
  
  if (!fs.statSync(dir).isDirectory()) {
    return { valid: false, error: 'Path is not a directory' };
  }
  
  // 检查读写权限
  try {
    fs.accessSync(dir, fs.constants.R_OK | fs.constants.W_OK);
  } catch {
    return { valid: false, error: 'No read/write permission' };
  }
  
  return { valid: true };
}

/**
 * 确保工作目录有效 (可选创建子目录)
 */
export async function ensureWorkspaceReady(workspaceDir: string, createSubDirs: boolean = false): Promise<{
  ready: boolean;
  error?: string;
}> {
  const validation = validateWorkspaceDir(workspaceDir);
  if (!validation.valid) {
    return { ready: false, error: validation.error };
  }
  
  // 可选创建子目录
  if (createSubDirs) {
    const subDirs = ['files', 'logs', 'temp'];
    for (const subDir of subDirs) {
      const dir = path.join(workspaceDir, subDir);
      if (!fs.existsSync(dir)) {
        try {
          fs.mkdirSync(dir, { recursive: true });
        } catch (error) {
          return { ready: false, error: `Failed to create ${subDir}: ${error}` };
        }
      }
    }
  }
  
  return { ready: true };
}

/**
 * 删除会话工作目录
 */
export async function deleteSessionWorkspace(sessionId: string): Promise<void> {
  const workspace = path.join(getWorkspacesDir(), sessionId);
  
  if (fs.existsSync(workspace)) {
    fs.rmSync(workspace, { recursive: true, force: true });
    log.info(`[Workspace] Deleted session workspace: ${workspace}`);
  }
}

/**
 * 获取会话工作目录中的文件
 */
export function getSessionFiles(sessionId: string): string[] {
  const workspace = path.join(getWorkspacesDir(), sessionId, 'files');
  
  if (!fs.existsSync(workspace)) {
    return [];
  }
  
  try {
    return fs.readdirSync(workspace);
  } catch {
    return [];
  }
}

// ==================== Workspace Config ====================

export interface WorkspaceConfig {
  sessionId: string;
  projectDir?: string;  // 自定义项目目录
  engine?: string;      // 使用的引擎
  model?: string;      // 使用的模型
  createdAt: number;
  updatedAt: number;
}

/**
 * 保存会话工作空间配置
 */
export function saveWorkspaceConfig(sessionId: string, config: Partial<WorkspaceConfig>): void {
  const configPath = path.join(getWorkspacesDir(), sessionId, 'config.json');
  const workspace = path.join(getWorkspacesDir(), sessionId);
  
  if (!fs.existsSync(workspace)) {
    fs.mkdirSync(workspace, { recursive: true });
  }
  
  let existingConfig: WorkspaceConfig = {
    sessionId,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  
  if (fs.existsSync(configPath)) {
    try {
      existingConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    } catch {}
  }
  
  const newConfig: WorkspaceConfig = {
    ...existingConfig,
    ...config,
    updatedAt: Date.now(),
  };
  
  fs.writeFileSync(configPath, JSON.stringify(newConfig, null, 2));
}

/**
 * 读取会话工作空间配置
 */
export function getWorkspaceConfig(sessionId: string): WorkspaceConfig | null {
  const configPath = path.join(getWorkspacesDir(), sessionId, 'config.json');
  
  if (!fs.existsSync(configPath)) {
    return null;
  }
  
  try {
    return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  } catch {
    return null;
  }
}

// ==================== List Workspaces ====================

/**
 * 列出所有会话工作空间
 */
export function listWorkspaces(): Array<{
  sessionId: string;
  path: string;
  hasProject: boolean;
  lastUsed: number;
}> {
  const workspacesDir = getWorkspacesDir();
  
  if (!fs.existsSync(workspacesDir)) {
    return [];
  }
  
  const workspaces: Array<{
    sessionId: string;
    path: string;
    hasProject: boolean;
    lastUsed: number;
  }> = [];
  
  try {
    const entries = fs.readdirSync(workspacesDir, { withFileTypes: true });
    
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const sessionId = entry.name;
        const workspacePath = path.join(workspacesDir, sessionId);
        const config = getWorkspaceConfig(sessionId);
        
        workspaces.push({
          sessionId,
          path: workspacePath,
          hasProject: !!config?.projectDir,
          lastUsed: config?.updatedAt || 0,
        });
      }
    }
  } catch (error) {
    log.error('[Workspace] Failed to list workspaces:', error);
  }
  
  // 按最后使用时间排序
  workspaces.sort((a, b) => b.lastUsed - a.lastUsed);
  
  return workspaces;
}

// ==================== Cleanup ====================

/**
 * 清理过期的工作空间
 */
export function cleanupOldWorkspaces(maxAgeDays: number = 30): number {
  const workspaces = listWorkspaces();
  const now = Date.now();
  const maxAge = maxAgeDays * 24 * 60 * 60 * 1000;
  
  let deleted = 0;
  
  for (const workspace of workspaces) {
    if (now - workspace.lastUsed > maxAge) {
      try {
        fs.rmSync(workspace.path, { recursive: true, force: true });
        deleted++;
        log.info(`[Workspace] Deleted old workspace: ${workspace.sessionId}`);
      } catch (error) {
        log.error(`[Workspace] Failed to delete workspace:`, error);
      }
    }
  }
  
  return deleted;
}

export default {
  getAppDataDir,
  getWorkspacesDir,
  getDefaultWorkspace,
  getSessionWorkspace,
  deleteSessionWorkspace,
  getSessionFiles,
  saveWorkspaceConfig,
  getWorkspaceConfig,
  listWorkspaces,
  cleanupOldWorkspaces,
};
