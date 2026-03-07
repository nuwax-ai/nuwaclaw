/**
 * Computer HTTP Server (对齐 rcoder /computer/* API)
 *
 * 在 agentPort (默认 60001) 上启动 HTTP 服务器，
 * 将 Java 后端通过 lanproxy 隧道发来的请求路由到 AcpEngine。
 *
 * 所有 HTTP 响应使用 rcoder 的 HttpResult<T> 格式：
 *   { code: "0000", message: "成功", data: {...}, tid: null, success: true }
 *
 * SSE 事件使用 rcoder 的 UnifiedSessionMessage 格式（camelCase 字段名）：
 *   event: <subType>\ndata: <json>\n\n
 *
 * 对应 rcoder 的 HTTP 端点：
 * - POST   /computer/chat
 * - GET    /computer/progress/{session_id}  (SSE)
 * - POST   /computer/agent/status
 * - POST   /computer/agent/stop
 * - POST   /computer/agent/session/cancel
 * - GET    /health
 */

import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import { EventEmitter } from 'events';
import log from 'electron-log';
import { agentService } from './engines/unifiedAgent';
import { LOCALHOST_HOSTNAME } from './constants';
import { getConfiguredPorts } from './startupPorts';
import type {
  ComputerChatRequest,
  HttpResult,
  UnifiedSessionMessage,
} from './engines/unifiedAgent';
import { redactForLog, redactStringForLog } from './utils/logRedact';

let server: http.Server | null = null;
let sseClients: Map<string, http.ServerResponse[]> = new Map();
let lastError: string | null = null;

/** 每个 sessionId 最多缓冲的早期 SSE 事件条数，防止内存泄漏 */
const SSE_EVENT_BUFFER_MAX = 50;
/** 无客户端连接的 buffer 保留时长，超时删除避免 Map 只增不减 */
const SSE_EVENT_BUFFER_TTL_MS = 30000;
/** SSE 事件缓冲：SSE 连接晚于 chat 响应时，先缓冲事件，连接建立后回放 */
const sseEventBuffers = new Map<string, { events: string[]; createdAt: number }>();

/**
 * 删除已过 TTL 且仍无客户端连接的 buffer 条目（在 pushSseEvent 无客户端路径中调用）。
 */
function pruneExpiredSseEventBuffers(): void {
  const now = Date.now();
  for (const [sessionId, buf] of sseEventBuffers.entries()) {
    if (now - buf.createdAt >= SSE_EVENT_BUFFER_TTL_MS && !sseClients.has(sessionId)) {
      sseEventBuffers.delete(sessionId);
    }
  }
}

/**
 * 返回某 session 当前缓冲的 SSE 事件条数（仅用于单测，勿在生产逻辑中依赖）。
 */
export function getSseEventBufferSize(sessionId: string): number {
  return sseEventBuffers.get(sessionId)?.events.length ?? 0;
}

/**
 * 清除指定 session 的 SSE 事件缓冲（cancel/stop 接口调用，避免取消后重连仍回放旧事件）。
 */
export function clearSseEventBuffer(sessionId: string): void {
  if (sessionId) sseEventBuffers.delete(sessionId);
}

/**
 * 清除所有 SSE 事件缓冲（客户端停止/重启所有服务时调用，避免重启后仍回放旧会话事件）。
 */
export function clearAllSseEventBuffers(): void {
  sseEventBuffers.clear();
}

// ==================== Helpers ====================

/**
 * 解析 POST body (JSON)，限制最大 10MB 防止内存耗尽
 */
const MAX_BODY_SIZE = 10 * 1024 * 1024; // 10MB

/**
 * 检测项目工作空间目录是否存在，不存在则通过 file-server 创建空目录结构。
 *
 * 规则：
 * - 目录已存在 → 直接返回，不做任何写入（保护已有 .claude/skills/ 等内容）
 * - 目录不存在 → 调用 file-server create-workspace（不传 zip，仅建目录）
 * - workspaceDir 未配置 → 跳过整个检测，不调用 file-server
 *
 * file-server create-workspace 使用 multer，必须发送 multipart/form-data。
 */
async function ensureProjectWorkspace(
  userId: string,
  projectId: string,
  fileServerPort: number,
): Promise<void> {
  // workspaceDir 未配置时跳过，避免在无法确认目录状态时误调用 file-server
  const agentConfig = agentService.getAgentConfig();
  if (!agentConfig?.workspaceDir) {
    log.debug('[ensureProjectWorkspace] workspaceDir 未配置，跳过检测');
    return;
  }

  // 本地快速检测：COMPUTER_WORKSPACE_DIR = workspaceDir/computer-project-workspace
  const projectDir = path.join(
    agentConfig.workspaceDir,
    'computer-project-workspace',
    userId,
    projectId,
  );
  if (fs.existsSync(projectDir)) {
    log.debug(`[ensureProjectWorkspace] 目录已存在，跳过: ${projectDir}`);
    return;
  }

  // 目录不存在，通知 file-server 创建空目录结构（不传 zip，不写入 skills）
  log.info(`[ensureProjectWorkspace] 目录不存在，创建: ${projectDir}`);

  // multer 要求 multipart/form-data，手动拼接 boundary
  const boundary = `----FormBoundary${Date.now()}`;
  const formBody = [
    `--${boundary}`,
    `Content-Disposition: form-data; name="userId"`,
    '',
    userId,
    `--${boundary}`,
    `Content-Disposition: form-data; name="cId"`,
    '',
    projectId,
    `--${boundary}--`,
  ].join('\r\n');

  const response = await new Promise<http.IncomingMessage>((resolve, reject) => {
    const req = http.request(
      {
        hostname: LOCALHOST_HOSTNAME,
        port: fileServerPort,
        path: '/api/computer/create-workspace',
        method: 'POST',
        headers: {
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
          'Content-Length': Buffer.byteLength(formBody),
        },
        timeout: 30000,
      },
      resolve,
    );
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });
    req.write(formBody);
    req.end();
  });

  let body = '';
  for await (const chunk of response) {
    body += chunk;
  }

  const result = JSON.parse(body);
  if (result.success || result.workspaceRoot) {
    log.info(`[ensureProjectWorkspace] ✅ 目录创建成功: ${result.workspaceRoot || projectDir}`);
  } else {
    log.warn(`[ensureProjectWorkspace] file-server 返回失败:`, result.message || result);
  }
}

function parseBody(req: http.IncomingMessage): Promise<any> {
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
        resolve(body ? JSON.parse(body) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

/**
 * 解析 URL query 参数为对象
 */
function parseQuery(url: URL): Record<string, string> {
  const params: Record<string, string> = {};
  url.searchParams.forEach((v, k) => { params[k] = v; });
  return params;
}

/**
 * 构建 rcoder HttpResult<T> 成功响应
 */
function httpResult<T>(data: T): HttpResult<T> {
  return { code: '0000', message: '成功', data, tid: null, success: true };
}

/**
 * 构建 rcoder HttpResult<T> 错误响应
 */
function httpError(code: string, message: string): HttpResult<null> {
  return { code, message, data: null, tid: null, success: false };
}

/**
 * 发送 JSON 响应
 */
function sendJson(res: http.ServerResponse, statusCode: number, data: unknown) {
  const json = JSON.stringify(data);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end(json);
}

// ==================== Request Router ====================

async function handleRequest(req: http.IncomingMessage, res: http.ServerResponse) {
  const url = new URL(req.url || '/', `http://${req.headers.host || LOCALHOST_HOSTNAME}`);
  const pathname = url.pathname;
  const method = req.method?.toUpperCase() || 'GET';

  // CORS preflight
  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    res.end();
    return;
  }

  try {
    // GET /health
    if (pathname === '/health' && method === 'GET') {
      sendJson(res, 200, {
        status: agentService.isReady ? 'healthy' : 'offline',
        engineType: agentService.getEngineType(),
        timestamp: new Date().toISOString(),
      });
      return;
    }

    // POST /computer/chat
    if (pathname === '/computer/chat' && method === 'POST') {
      const t0 = Date.now();
      let t1: number, t2: number, t3: number, t4: number;

      const body = await parseBody(req) as ComputerChatRequest;
      t1 = Date.now();
      log.debug(`⏱️ [HTTP][PERF] parseBody 耗时: ${t1 - t0}ms`);

      // 开发调试：完整打印入参（脱敏后，避免 api_key / agent_config.env / URL 中 ak= 写入日志）
      log.debug(
        '📨 [HTTP][DEBUG] Computer Chat 请求 body =',
        redactStringForLog(JSON.stringify(redactForLog(body), null, 2)),
      );

      // 业务级别 info 日志：重点字段摘要（脱敏 model_provider / agent_config，避免 api_key 泄露）
      log.info('📨 [HTTP] 收到 Computer Chat 请求', {
        user_id: body.user_id,
        project_id: body.project_id,
        session_id: body.session_id,
        request_id: body.request_id,
        model_provider: redactForLog(body.model_provider),
        agent_config: redactForLog(body.agent_config),
        // 先 redactForLog 脱敏键值，再 redactStringForLog 脱敏字符串内 URL 的 ak= / ts=
        context_servers_json: body.agent_config?.context_servers
          ? redactStringForLog(JSON.stringify(redactForLog(body.agent_config.context_servers)))
          : undefined,
        system_prompt_length: body.system_prompt ? body.system_prompt.length : 0,
        prompt_length: body.prompt ? body.prompt.length : 0,
      });

      // 验证必填字段
      if (!body.user_id) {
        log.error('❌ [HTTP] user_id is required for ComputerAgentRunner');
        sendJson(res, 400, httpError('VALIDATION_ERROR', 'user_id is required for ComputerAgentRunner'));
        return;
      }
      t2 = Date.now();
      log.debug(`⏱️ [HTTP][PERF] 验证字段 耗时: ${t2 - t1}ms`);

      // 确保项目工作空间存在（客户端快速重新登录后工作空间可能被清空）
      if (body.project_id) {
        try {
          const { fileServer: fileServerPort } = getConfiguredPorts();
          await ensureProjectWorkspace(body.user_id, body.project_id, fileServerPort);
        } catch (wsErr: any) {
          log.warn('[HTTP] ensureProjectWorkspace failed (non-blocking):', wsErr.message);
          // 不阻断请求，继续执行
        }
      }
      const t2_5 = Date.now();
      log.debug(`⏱️ [HTTP][PERF] ensureProjectWorkspace 耗时: ${t2_5 - t2}ms`);

      // 确保正确的引擎已启动（按 project_id 路由到对应 AcpEngine）
      let acpEngine;
      try {
        acpEngine = await agentService.ensureEngineForRequest(body);
      } catch (err: any) {
        log.error('❌ [HTTP] Engine switch failed:', err);
        sendJson(res, 200, httpError('5000', err.message || 'Engine switch failed'));
        return;
      }
      t3 = Date.now();
      log.debug(`⏱️ [HTTP][PERF] ensureEngineForRequest 耗时: ${t3 - t2_5}ms`);

      if (!acpEngine) {
        log.error('❌ [HTTP] Agent not initialized');
        sendJson(res, 200, httpError('5000', 'Agent not initialized'));
        return;
      }

      // chat() 已返回 HttpResult<ComputerChatResponse> 格式
      const result = await acpEngine.chat(body);
      t4 = Date.now();
      log.debug(`⏱️ [HTTP][PERF] acpEngine.chat 耗时: ${t4 - t3}ms`);

      if (result.success) {
        log.info(`✅ [HTTP] Computer Chat 响应: session_id=${result.data?.session_id}`);
      } else {
        log.error(`❌ [HTTP] Computer Chat 失败: ${result.message}`);
      }

      log.info(`⏱️ [HTTP][PERF] /computer/chat 总耗时: ${t4 - t0}ms (parseBody=${t1 - t0}ms, validate=${t2 - t1}ms, ensureWorkspace=${t2_5 - t2}ms, ensureEngine=${t3 - t2_5}ms, chat=${t4 - t3}ms)`);
      sendJson(res, 200, result);
      return;
    }

    // GET /computer/progress/{session_id} — SSE
    if (pathname.startsWith('/computer/progress/') && method === 'GET') {
      const sseStartTime = Date.now();
      const sessionId = pathname.replace('/computer/progress/', '');
      log.info(`📡 [HTTP] SSE 连接请求: session_id=${sessionId}, time=${new Date().toISOString()}`);

      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
      });
      res.write('\n');

      // 检查 Agent 是否 idle — 如果是，发送立即结束事件（对齐 rcoder is_agent_idle 逻辑）
      const acpEngine = agentService.getAcpEngine();
      if (!acpEngine || !agentService.hasRunningEngines) {
        log.info(`💤 [HTTP] Agent 处于 idle 状态，发送 SessionPromptEnd: session_id=${sessionId}`);
        const endEvent: UnifiedSessionMessage = {
          sessionId,
          messageType: 'sessionPromptEnd',
          subType: 'end_turn',
          data: { reason: 'EndTurn', description: 'Agent 当前无在执行任务' },
          timestamp: new Date().toISOString(),
        };
        res.write(`event: end_turn\ndata: ${JSON.stringify(endEvent)}\n\n`);
        res.end();
        return;
      }

      // 注册 SSE 客户端
      if (!sseClients.has(sessionId)) {
        sseClients.set(sessionId, []);
      }
      sseClients.get(sessionId)!.push(res);
      log.debug(`⏱️ [SSE][PERF] SSE 客户端注册完成: session_id=${sessionId}, 耗时=${Date.now() - sseStartTime}ms`);

      // 回放缓冲的早期事件（chat 响应先于 SSE 连接时 pushSseEvent 已写入缓冲）
      const buffered = sseEventBuffers.get(sessionId);
      if (buffered) {
        sseEventBuffers.delete(sessionId);
        let replayed = 0;
        for (const eventPayload of buffered.events) {
          try {
            res.write(eventPayload);
            replayed++;
          } catch {
            /* 客户端已断开，停止回放 */
            break;
          }
        }
        if (replayed > 0) {
          log.info(`[SSE] 回放缓冲事件 ${replayed} 条: session_id=${sessionId}`);
        }
      }

      // 心跳：发送符合 UnifiedSessionMessage 格式的心跳消息（对齐 rcoder heartbeat）
      const heartbeat = setInterval(() => {
        try {
          const hb: UnifiedSessionMessage = {
            sessionId,
            messageType: 'heartbeat',
            subType: 'ping',
            data: {
              type: 'heartbeat',
              message: 'keep-alive',
              timestamp: new Date().toISOString(),
            },
            timestamp: new Date().toISOString(),
          };
          res.write(`event: ping\ndata: ${JSON.stringify(hb)}\n\n`);
        } catch { /* client disconnected */ }
      }, 15000);

      req.on('close', () => {
        clearInterval(heartbeat);
        log.debug(`[HTTP] 客户端已断开连接: session_id=${sessionId}, 存活时间=${Date.now() - sseStartTime}ms`);
        const clients = sseClients.get(sessionId);
        if (clients) {
          const idx = clients.indexOf(res);
          if (idx >= 0) clients.splice(idx, 1);
          if (clients.length === 0) sseClients.delete(sessionId);
        }
      });

      log.info(`✅ [HTTP] SSE 流已建立: session_id=${sessionId}, 建立耗时=${Date.now() - sseStartTime}ms`);
      return;
    }

    // POST /computer/agent/status
    if (pathname === '/computer/agent/status' && method === 'POST') {
      const body = await parseBody(req);
      log.info(`🔍 [HTTP] Computer Agent 状态查询: user_id=${body.user_id}, project_id=${body.project_id}`);

      if (!body.user_id) {
        sendJson(res, 400, httpError('VALIDATION_ERROR', 'user_id is required'));
        return;
      }
      if (!body.project_id) {
        sendJson(res, 400, httpError('VALIDATION_ERROR', 'project_id is required'));
        return;
      }

      const projectEngine = agentService.getEngineForProject(body.project_id);
      const acpEngine = projectEngine || agentService.getAcpEngine();
      const session = acpEngine?.findSessionByProjectId(body.project_id) ?? null;

      if (session) {
        log.info(`✅ [HTTP] Agent 状态: project_id=${body.project_id}, is_alive=true, session_id=${session.id}`);
      } else {
        log.warn(`⚠️ [HTTP] Agent 不存在: project_id=${body.project_id}`);
      }

      sendJson(res, 200, httpResult({
        user_id: body.user_id,
        project_id: body.project_id,
        is_alive: !!projectEngine,
        session_id: session?.id ?? null,
        status: session ? (session.status === 'active' ? 'Busy' : 'Idle') : null,
        last_activity: session?.lastActivity ? new Date(session.lastActivity).toISOString() : null,
        created_at: session ? new Date(session.createdAt).toISOString() : null,
      }));
      return;
    }

    // POST /computer/agent/stop（停止该 project 的引擎，下次 chat 会冷启动）
    if (pathname === '/computer/agent/stop' && method === 'POST') {
      const body = await parseBody(req);
      log.info(`🛑 [HTTP] Computer Agent 停止请求: user_id=${body.user_id}, project_id=${body.project_id}`);

      if (!body.user_id) {
        sendJson(res, 400, httpError('VALIDATION_ERROR', 'user_id is required'));
        return;
      }
      if (!body.project_id) {
        sendJson(res, 400, httpError('VALIDATION_ERROR', 'project_id is required'));
        return;
      }

      const acpEngine = agentService.getEngineForProject(body.project_id);
      if (acpEngine) {
        // 停止前清除该引擎下所有 session 的 SSE 缓冲，避免重连仍回放旧事件
        try {
          const sessions = await acpEngine.listSessions();
          for (const s of sessions) {
            clearSseEventBuffer(s.id);
          }
        } catch {
          /* 忽略 listSessions 失败，继续执行 stop */
        }
        await agentService.stopEngine(body.project_id);
        log.info(`✅ [HTTP] Agent 已停止: project_id=${body.project_id}`);
      } else {
        log.info(`ℹ️ [HTTP] Agent 不存在,幂等返回成功: project_id=${body.project_id}`);
      }

      sendJson(res, 200, httpResult({
        success: true,
        message: 'Agent stopped successfully',
        user_id: body.user_id,
        project_id: body.project_id,
      }));
      return;
    }

    // POST /computer/agent/session/cancel
    // rcoder 使用 Query 参数，兼容 body 和 query 两种方式
    if (pathname === '/computer/agent/session/cancel' && method === 'POST') {
      const query = parseQuery(url);
      const body = await parseBody(req).catch(() => ({}));
      const userId = query.user_id || body.user_id || '';
      const projectId = query.project_id || body.project_id || '';
      const sessionId = query.session_id || body.session_id || '';

      log.info(`🚫 [HTTP] Computer Agent 取消请求: user_id=${userId}, project_id=${projectId}, session_id=${sessionId}`);

      if (!userId) {
        sendJson(res, 400, httpError('VALIDATION_ERROR', 'user_id is required'));
        return;
      }
      if (!projectId) {
        sendJson(res, 400, httpError('VALIDATION_ERROR', 'project_id is required'));
        return;
      }

      let cancelledSessionId = sessionId;
      const acpEngine = agentService.getEngineForProject(projectId) || agentService.getAcpEngine();
      if (acpEngine) {
        if (sessionId) {
          const ok = await acpEngine.abortSession(sessionId);
          if (ok) {
            log.info(`✅ [HTTP] 取消成功: session_id=${sessionId}`);
          } else {
            log.warn(`⚠️ [HTTP] 取消失败(session 不存在): session_id=${sessionId}`);
          }
        } else {
          const session = acpEngine.findSessionByProjectId(projectId);
          if (session) {
            cancelledSessionId = session.id;
            await acpEngine.abortSession(session.id);
            log.info(`✅ [HTTP] 取消成功: session_id=${session.id}`);
          } else {
            log.info(`ℹ️ [HTTP] Agent 不存在,幂等返回成功: project_id=${projectId}`);
          }
        }
      }
      // 取消后清除该 session 的 SSE 事件缓冲，避免后续 GET /computer/progress 仍回放已取消会话的旧事件
      if (cancelledSessionId) {
        clearSseEventBuffer(cancelledSessionId);
      }

      sendJson(res, 200, httpResult({
        success: true,
        session_id: sessionId,
      }));
      return;
    }

    // 404
    sendJson(res, 404, httpError('NOT_FOUND', `Path not found: ${pathname}`));
  } catch (error: any) {
    log.error(`❌ [HTTP] 请求处理异常: ${pathname}`, error);
    sendJson(res, 500, httpError('5000', error.message || 'Internal server error'));
  }
}

// ==================== SSE Push ====================

/**
 * 向 SSE 客户端推送事件
 *
 * 对齐 rcoder SSE 格式：使用 subType 作为 SSE event name
 *   event: <eventName>\n
 *   data: <json>\n\n
 *
 * 若当前无客户端连接（chat 响应先于 SSE 连接建立），则先写入缓冲，
 * 等 GET /computer/progress/{session_id} 连接时回放，避免丢失 prompt_start 等早期事件。
 */
export function pushSseEvent(sessionId: string, eventName: string, data: unknown) {
  const clients = sseClients.get(sessionId);
  const payload = `event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`;
  log.debug(
    `[SSE] pushSseEvent: sessionId=${sessionId}, eventName=${eventName}, time=${Date.now()}, clients=${clients?.length || 0}`,
  );

  if (!clients || clients.length === 0) {
    pruneExpiredSseEventBuffers();
    if (!sseEventBuffers.has(sessionId)) {
      sseEventBuffers.set(sessionId, { events: [], createdAt: Date.now() });
    }
    const buf = sseEventBuffers.get(sessionId)!;
    if (buf.events.length < SSE_EVENT_BUFFER_MAX) {
      buf.events.push(payload);
    }
    return;
  }

  for (const client of clients) {
    try {
      const written = client.write(payload);
      if (!written) {
        log.warn(`[ComputerServer] ⚠ SSE write returned false (buffer full): sessionId=${sessionId}`);
      }
    } catch (e) {
      log.warn(`[ComputerServer] ⚠ SSE write failed:`, e);
    }
  }
}

// ==================== Lifecycle ====================

/**
 * 启动 Computer HTTP Server
 */
export function startComputerServer(port: number): Promise<{ success: boolean; error?: string }> {
  return new Promise((resolve) => {
    if (server) {
      lastError = null;
      resolve({ success: true });
      return;
    }

    server = http.createServer(handleRequest);

    server.on('error', (err: NodeJS.ErrnoException) => {
      log.error('❌ [ComputerServer] Server error:', err);
      const errorMsg = err.code === 'EADDRINUSE'
        ? `Port ${port} already in use`
        : err.message;
      lastError = errorMsg;
      server = null;
      resolve({ success: false, error: errorMsg });
    });

    // 监听 0.0.0.0：与 Tauri rcoder 行为一致，lanproxy 隧道需要从外部访问此端口
    server.listen(port, '0.0.0.0', () => {
      log.info(`✅ [ComputerServer] Listening on 0.0.0.0:${port} (对齐 rcoder /computer/* API)`);
      lastError = null;
      resolve({ success: true });
    });
  });
}

/**
 * 停止 Computer HTTP Server
 */
export function stopComputerServer(): Promise<void> {
  return new Promise((resolve) => {
    if (!server) {
      lastError = null;
      resolve();
      return;
    }
    // 关闭所有 SSE 连接
    for (const [, clients] of sseClients) {
      for (const client of clients) {
        try {
          client.end();
        } catch {
          /* ignore */
        }
      }
    }
    sseClients.clear();
    sseEventBuffers.clear();

    server.close(() => {
      log.info('[ComputerServer] Stopped');
      server = null;
      lastError = null;
      resolve();
    });
  });
}

/**
 * 获取 Computer Server 状态
 */
export function getComputerServerStatus(): { running: boolean; port?: number; error?: string } {
  if (!server || !server.listening) {
    return { running: false, error: lastError || undefined };
  }
  const addr = server.address();
  return {
    running: true,
    port: typeof addr === 'object' && addr ? addr.port : undefined,
  };
}
