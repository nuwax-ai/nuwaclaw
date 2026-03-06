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
import { EventEmitter } from 'events';
import log from 'electron-log';
import { agentService } from './engines/unifiedAgent';
import { LOCALHOST_HOSTNAME } from './constants';
import type {
  ComputerChatRequest,
  HttpResult,
  UnifiedSessionMessage,
} from './engines/unifiedAgent';

let server: http.Server | null = null;
let sseClients: Map<string, http.ServerResponse[]> = new Map();
let lastError: string | null = null;

// ==================== Helpers ====================

/**
 * 解析 POST body (JSON)，限制最大 10MB 防止内存耗尽
 */
const MAX_BODY_SIZE = 10 * 1024 * 1024; // 10MB

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

      // 开发调试：完整打印入参
      log.debug(
        '📨 [HTTP][DEBUG] Computer Chat 请求 body =',
        JSON.stringify(body, null, 2),
      );

      // 业务级别 info 日志：重点字段摘要（单行 / 对象形式）
      log.info('📨 [HTTP] 收到 Computer Chat 请求', {
        user_id: body.user_id,
        project_id: body.project_id,
        session_id: body.session_id,
        request_id: body.request_id,
        model_provider: body.model_provider,
        agent_config: body.agent_config,
        context_servers_json: body.agent_config?.context_servers
          ? JSON.stringify(body.agent_config.context_servers, null, 2)
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
      log.debug(`⏱️ [HTTP][PERF] ensureEngineForRequest 耗时: ${t3 - t2}ms`);

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

      log.info(`⏱️ [HTTP][PERF] /computer/chat 总耗时: ${t4 - t0}ms (parseBody=${t1 - t0}ms, validate=${t2 - t1}ms, ensureEngine=${t3 - t2}ms, chat=${t4 - t3}ms)`);
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

    // POST /computer/agent/stop
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
            await acpEngine.abortSession(session.id);
            log.info(`✅ [HTTP] 取消成功: session_id=${session.id}`);
          } else {
            log.info(`ℹ️ [HTTP] Agent 不存在,幂等返回成功: project_id=${projectId}`);
          }
        }
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
 */
export function pushSseEvent(sessionId: string, eventName: string, data: unknown) {
  const clients = sseClients.get(sessionId);
  log.debug(`[SSE] pushSseEvent: sessionId=${sessionId}, eventName=${eventName}, time=${Date.now()}, clients=${clients?.length || 0}`);

  if (!clients || clients.length === 0) {
    log.warn(`[ComputerServer] ⚠ No SSE clients for sessionId=${sessionId}`);
    return;
  }

  const payload = `event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`;
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
        try { client.end(); } catch { /* ignore */ }
      }
    }
    sseClients.clear();

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
