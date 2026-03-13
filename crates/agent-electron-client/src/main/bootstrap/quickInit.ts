/**
 * Quick Init — Main 进程读取快捷初始化配置
 *
 * 配置优先级（per-field）: nuwaclaw.json (quickInit scope) → 环境变量 → 客户端默认值
 *
 * 环境变量:
 *   NUWAX_SERVER_HOST      → serverHost       (必填)
 *   NUWAX_SAVED_KEY        → savedKey          (必填)
 *   NUWAX_AGENT_PORT       → agentPort         (可选, 默认 60006)
 *   NUWAX_FILE_SERVER_PORT → fileServerPort    (可选, 默认 60005)
 *   NUWAX_WORKSPACE_DIR    → workspaceDir      (可选, 默认 ~/.nuwaclaw/workspace)
 *   NUWAX_USER_NAME        → username          (可选, 默认 '')
 *
 * 最低必填: serverHost + savedKey（来自任意源），其余用客户端默认值
 *   agentPort      → DEFAULT_AGENT_RUNNER_PORT (60006)
 *   fileServerPort → DEFAULT_FILE_SERVER_PORT  (60005)
 *   workspaceDir   → ~/.nuwaclaw/workspace
 *   username       → ''
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import log from 'electron-log';
import { APP_DATA_DIR_NAME } from '../services/constants';
import {
  DEFAULT_AGENT_RUNNER_PORT,
  DEFAULT_FILE_SERVER_PORT,
} from '@shared/constants';
import { type QuickInitConfig } from '@shared/types/quickInit';

let cachedConfig: QuickInitConfig | null | undefined;

/** 读取环境变量，返回各字段（未设置的为 undefined） */
function readEnvVars() {
  const port = parseInt(process.env.NUWAX_AGENT_PORT || '', 10);
  const fsPort = parseInt(process.env.NUWAX_FILE_SERVER_PORT || '', 10);
  return {
    serverHost: process.env.NUWAX_SERVER_HOST || undefined,
    savedKey: process.env.NUWAX_SAVED_KEY || undefined,
    username: process.env.NUWAX_USER_NAME || undefined,
    agentPort: port > 0 ? port : undefined,
    fileServerPort: fsPort > 0 ? fsPort : undefined,
    workspaceDir: process.env.NUWAX_WORKSPACE_DIR || undefined,
  };
}

/** 取第一个有效的 string 值 */
function pickStr(...values: (unknown)[]): string {
  for (const v of values) {
    if (typeof v === 'string' && v.length > 0) return v;
  }
  return '';
}

/** 取第一个有效的正整数值 */
function pickPort(...values: (unknown)[]): number {
  for (const v of values) {
    if (typeof v === 'number' && v > 0) return v;
  }
  return 0;
}

/**
 * 读取快捷初始化配置
 *
 * 优先级（per-field）: nuwaclaw.json → 环境变量 → 默认值
 * 结果缓存，每次启动只读一次
 */
export function readQuickInitConfig(): QuickInitConfig | null {
  if (cachedConfig !== undefined) return cachedConfig;

  const appDataDir = path.join(os.homedir(), APP_DATA_DIR_NAME);
  const defaultWorkspace = path.join(appDataDir, 'workspace');
  const filePath = path.join(appDataDir, 'nuwaclaw.json');

  // --- 读取 nuwaclaw.json (quickInit scope) ---
  let json: Record<string, unknown> | null = null;
  try {
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, 'utf-8');
      const parsed = JSON.parse(raw);
      const scope = parsed?.quickInit;

      if (scope && typeof scope === 'object') {
        if (scope.enabled === false) {
          log.info('[QuickInit] 配置已禁用 (enabled: false)');
          cachedConfig = null;
          return null;
        }
        json = scope;
      }
    }
  } catch (error) {
    log.warn('[QuickInit] 读取 JSON 配置失败:', error);
  }

  // --- 读取环境变量 ---
  const env = readEnvVars();

  // --- 合并: JSON > env > default ---
  const serverHost = pickStr(json?.serverHost, env.serverHost);
  const savedKey = pickStr(json?.savedKey, env.savedKey);

  if (!serverHost || !savedKey) {
    log.info('[QuickInit] 未检测到快捷配置 (缺少 serverHost 或 savedKey)');
    cachedConfig = null;
    return null;
  }

  cachedConfig = {
    serverHost,
    savedKey,
    username: pickStr(json?.username, env.username),
    agentPort: pickPort(json?.agentPort, env.agentPort) || DEFAULT_AGENT_RUNNER_PORT,
    fileServerPort: pickPort(json?.fileServerPort, env.fileServerPort) || DEFAULT_FILE_SERVER_PORT,
    workspaceDir: pickStr(json?.workspaceDir, env.workspaceDir) || defaultWorkspace,
  };

  const source = json ? (env.serverHost || env.savedKey ? 'JSON + env' : 'JSON') : 'env';
  log.info(`[QuickInit] 配置已加载 (${source}):`, {
    serverHost: cachedConfig.serverHost,
    username: cachedConfig.username || '(empty)',
    agentPort: cachedConfig.agentPort,
    fileServerPort: cachedConfig.fileServerPort,
    workspaceDir: cachedConfig.workspaceDir,
  });

  return cachedConfig;
}
