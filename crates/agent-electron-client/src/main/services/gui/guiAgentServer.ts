/**
 * GUI Agent HTTP Server
 *
 * 在 127.0.0.1:$GUI_AGENT_PORT 上启动 HTTP 服务器，
 * 提供截图、键鼠操作、权限检测等 API。
 * Agent 通过 bash curl 调用这些端点。
 *
 * 路由:
 * - POST /gui/screenshot    → 截图
 * - POST /gui/input         → 键鼠操作
 * - GET  /gui/displays      → 显示器信息
 * - GET  /gui/cursor         → 鼠标位置
 * - GET  /gui/permissions    → 权限状态
 * - GET  /gui/health         → 健康检查
 */

import * as http from 'http';
import log from 'electron-log';
import { LOCALHOST_IP } from '@shared/constants';
import { takeScreenshot, getDisplaysInfo } from './screenshotService';
import { executeInput, getCursorPosition } from './inputService';
import { checkGuiPermissions } from './permissionService';
import {
  validateToken,
  consumeRateToken,
  logAudit,
  generateToken,
  clearToken,
  initRateLimiter,
  resetRateLimiter,
  getToken,
} from './securityManager';
import type { GuiAgentConfig, GuiAgentStatus, InputAction, ScreenshotRequest } from '@shared/types/guiAgentTypes';
import { DEFAULT_GUI_AGENT_CONFIG } from '@shared/types/guiAgentTypes';

const TAG = '[GuiAgentServer]';
const MAX_BODY_SIZE = 1 * 1024 * 1024; // 1MB

let server: http.Server | null = null;
let lastError: string | null = null;
let currentConfig: GuiAgentConfig = { ...DEFAULT_GUI_AGENT_CONFIG };

// ==================== Helpers ====================

function parseBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let body = '';
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_SIZE) {
        req.destroy();
        reject(new Error('Request body too large'));
        return;
      }
      body += chunk;
    });
    req.on('end', () => {
      try {
        const parsed = body ? JSON.parse(body) : {};
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
          reject(new Error('Request body must be a JSON object'));
          return;
        }
        resolve(parsed as Record<string, unknown>);
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

const VALID_INPUT_TYPES = new Set([
  'mouse_move', 'mouse_click', 'mouse_double_click',
  'mouse_drag', 'mouse_scroll', 'keyboard_type',
  'keyboard_press', 'keyboard_hotkey',
]);

function validateInputAction(body: Record<string, unknown>): InputAction {
  const action = body.action;
  if (!action || typeof action !== 'object' || Array.isArray(action)) {
    throw new Error('Missing or invalid action object');
  }
  const act = action as Record<string, unknown>;
  if (typeof act.type !== 'string' || !VALID_INPUT_TYPES.has(act.type)) {
    throw new Error(`Invalid action type: ${String(act.type)}`);
  }

  // Validate required fields per action type
  switch (act.type) {
    case 'mouse_move':
    case 'mouse_click':
    case 'mouse_double_click':
    case 'mouse_scroll':
      if (typeof act.x !== 'number' || typeof act.y !== 'number') {
        throw new Error(`Action ${act.type} requires numeric x and y`);
      }
      if (act.type === 'mouse_scroll' && typeof act.deltaY !== 'number') {
        throw new Error('mouse_scroll requires numeric deltaY');
      }
      break;
    case 'mouse_drag':
      if (typeof act.startX !== 'number' || typeof act.startY !== 'number' ||
          typeof act.endX !== 'number' || typeof act.endY !== 'number') {
        throw new Error('mouse_drag requires numeric startX, startY, endX, endY');
      }
      break;
    case 'keyboard_type':
      if (typeof act.text !== 'string') {
        throw new Error('keyboard_type requires string text');
      }
      break;
    case 'keyboard_press':
      if (typeof act.key !== 'string') {
        throw new Error('keyboard_press requires string key');
      }
      break;
    case 'keyboard_hotkey':
      if (!Array.isArray(act.keys) || !act.keys.every((k: unknown) => typeof k === 'string')) {
        throw new Error('keyboard_hotkey requires string[] keys');
      }
      break;
  }

  return act as unknown as InputAction;
}

function validateScreenshotRequest(body: Record<string, unknown>): ScreenshotRequest {
  const opts: ScreenshotRequest = {};
  if (body.scale !== undefined) {
    if (typeof body.scale !== 'number') throw new Error('scale must be a number');
    opts.scale = body.scale;
  }
  if (body.format !== undefined) {
    if (body.format !== 'png' && body.format !== 'jpeg') throw new Error('format must be "png" or "jpeg"');
    opts.format = body.format;
  }
  if (body.quality !== undefined) {
    if (typeof body.quality !== 'number') throw new Error('quality must be a number');
    opts.quality = body.quality;
  }
  if (body.displayIndex !== undefined) {
    if (typeof body.displayIndex !== 'number') throw new Error('displayIndex must be a number');
    opts.displayIndex = body.displayIndex;
  }
  if (body.region !== undefined) {
    const r = body.region as Record<string, unknown>;
    if (!r || typeof r !== 'object' ||
        typeof r.x !== 'number' || typeof r.y !== 'number' ||
        typeof r.width !== 'number' || typeof r.height !== 'number') {
      throw new Error('region must have numeric x, y, width, height');
    }
    opts.region = { x: r.x, y: r.y, width: r.width, height: r.height };
  }
  return opts;
}

function sendJson(res: http.ServerResponse, statusCode: number, data: unknown) {
  const json = JSON.stringify(data);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(json),
  });
  res.end(json);
}

function sendSuccess(res: http.ServerResponse, data: unknown) {
  sendJson(res, 200, { success: true, data });
}

function sendError(res: http.ServerResponse, statusCode: number, message: string) {
  sendJson(res, statusCode, { success: false, error: message });
}

// ==================== Request Router ====================

async function handleRequest(req: http.IncomingMessage, res: http.ServerResponse) {
  const url = new URL(req.url || '/', `http://${req.headers.host || LOCALHOST_IP}`);
  const pathname = url.pathname;
  const method = req.method?.toUpperCase() || 'GET';
  const t0 = Date.now();

  // Auth check (all endpoints require Bearer token)
  if (!validateToken(req.headers.authorization)) {
    logAudit({ path: pathname, action: 'auth_failed', success: false, error: 'Invalid or missing token' });
    sendError(res, 401, 'Unauthorized: Invalid or missing Bearer token');
    return;
  }

  // Rate limit check
  if (!consumeRateToken()) {
    logAudit({ path: pathname, action: 'rate_limited', success: false, error: 'Rate limit exceeded' });
    sendError(res, 429, 'Rate limit exceeded');
    return;
  }

  try {
    // GET /gui/health
    if (pathname === '/gui/health' && method === 'GET') {
      sendSuccess(res, { status: 'ok', platform: process.platform, timestamp: new Date().toISOString() });
      logAudit({ path: pathname, action: 'health', success: true, elapsed: Date.now() - t0 });
      return;
    }

    // POST /gui/screenshot
    if (pathname === '/gui/screenshot' && method === 'POST') {
      const body = await parseBody(req);
      const opts = validateScreenshotRequest(body);
      const result = await takeScreenshot(
        opts,
        currentConfig.screenshotScale,
        currentConfig.screenshotFormat,
        currentConfig.screenshotQuality,
      );
      sendSuccess(res, result);
      logAudit({ path: pathname, action: 'screenshot', success: true, elapsed: Date.now() - t0 });
      return;
    }

    // POST /gui/input
    if (pathname === '/gui/input' && method === 'POST') {
      const body = await parseBody(req);
      const action = validateInputAction(body);
      const delayMs = typeof body.delay === 'number' ? body.delay : undefined;
      const result = await executeInput(action, delayMs);
      sendSuccess(res, result);
      logAudit({ path: pathname, action: `input:${action.type}`, success: true, elapsed: Date.now() - t0 });
      return;
    }

    // GET /gui/displays
    if (pathname === '/gui/displays' && method === 'GET') {
      const displays = getDisplaysInfo();
      sendSuccess(res, { displays });
      logAudit({ path: pathname, action: 'displays', success: true, elapsed: Date.now() - t0 });
      return;
    }

    // GET /gui/cursor
    if (pathname === '/gui/cursor' && method === 'GET') {
      const position = await getCursorPosition();
      sendSuccess(res, position);
      logAudit({ path: pathname, action: 'cursor', success: true, elapsed: Date.now() - t0 });
      return;
    }

    // GET /gui/permissions
    if (pathname === '/gui/permissions' && method === 'GET') {
      const permissions = checkGuiPermissions();
      sendSuccess(res, permissions);
      logAudit({ path: pathname, action: 'permissions', success: true, elapsed: Date.now() - t0 });
      return;
    }

    // 404
    sendError(res, 404, `Not found: ${pathname}`);
    logAudit({ path: pathname, action: 'not_found', success: false, error: '404' });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    log.error(`${TAG} Request error: ${pathname}`, msg);
    sendError(res, 500, msg);
    logAudit({ path: pathname, action: 'error', success: false, error: msg, elapsed: Date.now() - t0 });
  }
}

// ==================== Lifecycle ====================

/**
 * 启动 GUI Agent HTTP Server
 */
export function startGuiAgentServer(config?: Partial<GuiAgentConfig>): Promise<{ success: boolean; token?: string; error?: string }> {
  return new Promise((resolve) => {
    if (server) {
      resolve({ success: true, token: getToken() || undefined });
      return;
    }

    // Merge config
    if (config) {
      currentConfig = { ...currentConfig, ...config };
    }

    const port = currentConfig.port;

    // Initialize security
    const token = generateToken();
    initRateLimiter(currentConfig.rateLimit);

    server = http.createServer(handleRequest);

    server.on('error', (err: NodeJS.ErrnoException) => {
      log.error(`${TAG} Server error:`, err);
      const errorMsg = err.code === 'EADDRINUSE'
        ? `Port ${port} already in use`
        : err.message;
      lastError = errorMsg;
      server = null;
      clearToken();
      resetRateLimiter();
      resolve({ success: false, error: errorMsg });
    });

    // Bind to 127.0.0.1 only (security: local access only)
    server.listen(port, LOCALHOST_IP, () => {
      log.info(`${TAG} Listening on ${LOCALHOST_IP}:${port}`);
      lastError = null;
      resolve({ success: true, token });
    });
  });
}

/**
 * 停止 GUI Agent HTTP Server
 */
export function stopGuiAgentServer(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!server) {
      resolve();
      return;
    }

    const s = server;
    server = null;
    lastError = null;
    clearToken();
    resetRateLimiter();

    s.close((err) => {
      if (err) {
        log.error(`${TAG} Stop error:`, err);
        reject(err);
      } else {
        log.info(`${TAG} Stopped`);
        resolve();
      }
    });
  });
}

/**
 * 获取 GUI Agent Server 状态
 */
export function getGuiAgentStatus(): GuiAgentStatus {
  if (!server || !server.listening) {
    return { running: false, error: lastError || undefined };
  }
  const addr = server.address();
  return {
    running: true,
    port: typeof addr === 'object' && addr ? addr.port : undefined,
    token: getToken() || undefined,
  };
}

/**
 * 获取当前配置
 */
export function getGuiAgentConfig(): GuiAgentConfig {
  return { ...currentConfig };
}

/**
 * 更新配置（需要重启服务才生效）
 */
export function setGuiAgentConfig(config: Partial<GuiAgentConfig>): void {
  currentConfig = { ...currentConfig, ...config };
}
