/**
 * Computer HTTP Server (对齐 rcoder /computer/* API)
 *
 * 在 agentPort (默认 60001) 上启动 HTTP 服务器，
 * 将 Java 后端通过 lanproxy 隧道发来的请求路由到 AcpEngine。
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
import log from 'electron-log';
import { agentService } from './unifiedAgent';
import type { ComputerChatRequest } from './unifiedAgent';

let server: http.Server | null = null;
let sseClients: Map<string, http.ServerResponse[]> = new Map();

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

/**
 * 请求路由
 */
async function handleRequest(req: http.IncomingMessage, res: http.ServerResponse) {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
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
      const body = await parseBody(req) as ComputerChatRequest;
      const acpEngine = agentService.getAcpEngine();
      if (!acpEngine) {
        sendJson(res, 503, { success: false, error: 'Agent not initialized' });
        return;
      }
      const result = await acpEngine.chat(body);
      sendJson(res, 200, result);
      return;
    }

    // GET /computer/progress/{session_id} — SSE
    if (pathname.startsWith('/computer/progress/') && method === 'GET') {
      const sessionId = pathname.replace('/computer/progress/', '');
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
      });
      res.write('\n');

      // 注册 SSE 客户端
      if (!sseClients.has(sessionId)) {
        sseClients.set(sessionId, []);
      }
      sseClients.get(sessionId)!.push(res);

      // 心跳
      const heartbeat = setInterval(() => {
        try { res.write(':heartbeat\n\n'); } catch { /* client disconnected */ }
      }, 15000);

      req.on('close', () => {
        clearInterval(heartbeat);
        const clients = sseClients.get(sessionId);
        if (clients) {
          const idx = clients.indexOf(res);
          if (idx >= 0) clients.splice(idx, 1);
          if (clients.length === 0) sseClients.delete(sessionId);
        }
      });
      return;
    }

    // POST /computer/agent/status
    if (pathname === '/computer/agent/status' && method === 'POST') {
      const body = await parseBody(req);
      const acpEngine = agentService.getAcpEngine();
      if (!acpEngine) {
        sendJson(res, 200, { success: false, status: 'offline' });
        return;
      }
      const session = acpEngine.findSessionByProjectId(body.project_id || '');
      sendJson(res, 200, {
        success: true,
        status: session?.status === 'active' ? 'Busy' : 'Idle',
        session_id: session?.id,
        project_id: body.project_id,
      });
      return;
    }

    // POST /computer/agent/stop
    if (pathname === '/computer/agent/stop' && method === 'POST') {
      const body = await parseBody(req);
      const acpEngine = agentService.getAcpEngine();
      if (!acpEngine) {
        sendJson(res, 200, { success: true, message: 'Not running' });
        return;
      }
      if (body.project_id) {
        const session = acpEngine.findSessionByProjectId(body.project_id);
        if (session) await acpEngine.abortSession(session.id);
      } else {
        await acpEngine.abortSession();
      }
      sendJson(res, 200, { success: true, message: 'Stopped' });
      return;
    }

    // POST /computer/agent/session/cancel
    if (pathname === '/computer/agent/session/cancel' && method === 'POST') {
      const body = await parseBody(req);
      const acpEngine = agentService.getAcpEngine();
      if (!acpEngine) {
        sendJson(res, 503, { success: false, error: 'Agent not initialized' });
        return;
      }
      if (body.session_id) {
        await acpEngine.abortSession(body.session_id);
      }
      sendJson(res, 200, { success: true, session_id: body.session_id });
      return;
    }

    // 404
    sendJson(res, 404, { error: 'Not found', path: pathname });
  } catch (error: any) {
    log.error('[ComputerServer] Request error:', error);
    sendJson(res, 500, { error: error.message || 'Internal server error' });
  }
}

/**
 * 向 SSE 客户端推送事件（对齐 rcoder 格式：data-only SSE，无 event: 前缀）
 */
export function pushSseEvent(sessionId: string, _event: string, data: unknown) {
  const clients = sseClients.get(sessionId);
  if (!clients || clients.length === 0) return;

  const payload = `data: ${JSON.stringify(data)}\n\n`;
  for (const client of clients) {
    try {
      client.write(payload);
    } catch {
      // client disconnected, will be cleaned up on 'close'
    }
  }
}

/**
 * 启动 Computer HTTP Server
 */
export function startComputerServer(port: number): Promise<{ success: boolean; error?: string }> {
  return new Promise((resolve) => {
    if (server) {
      resolve({ success: true });
      return;
    }

    server = http.createServer(handleRequest);

    server.on('error', (err: NodeJS.ErrnoException) => {
      log.error('[ComputerServer] Server error:', err);
      if (err.code === 'EADDRINUSE') {
        resolve({ success: false, error: `Port ${port} already in use` });
      } else {
        resolve({ success: false, error: err.message });
      }
      server = null;
    });

    // 监听 0.0.0.0：与 Tauri rcoder 行为一致，lanproxy 隧道需要从外部访问此端口
    server.listen(port, '0.0.0.0', () => {
      log.info(`[ComputerServer] Listening on port ${port} (对齐 rcoder /computer/* API)`);
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
      resolve();
    });
  });
}

/**
 * 获取 Computer Server 状态
 */
export function getComputerServerStatus(): { running: boolean; port?: number } {
  if (!server || !server.listening) return { running: false };
  const addr = server.address();
  return {
    running: true,
    port: typeof addr === 'object' && addr ? addr.port : undefined,
  };
}
