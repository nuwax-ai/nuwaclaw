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

import * as http from "http";
import * as fs from "fs";
import * as path from "path";
import { EventEmitter } from "events";
import log from "electron-log";
import { t } from "./i18n";
import { getPerfLogger } from "../bootstrap/logConfig";
import { agentService } from "./engines/unifiedAgent";
import { firstTokenTrace } from "./engines/perf/firstTokenTrace";
import { checkFileServerHealth } from "./packages/fileServerHealth";
import { LOCALHOST_HOSTNAME } from "./constants";
import { getConfiguredPorts } from "./startupPorts";
import type {
  ComputerChatRequest,
  HttpResult,
  UnifiedSessionMessage,
} from "./engines/unifiedAgent";
import type {
  GuiVisionModelConfig,
  GuiDisplayInfo,
} from "@shared/types/computerTypes";
import { redactForLog, redactStringForLog } from "./utils/logRedact";
import { DEFAULT_SSE_HEARTBEAT_INTERVAL } from "@shared/constants";

let server: http.Server | null = null;
let sseClients: Map<string, http.ServerResponse[]> = new Map();
let lastError: string | null = null;

/** 每个 sessionId 最多缓冲的早期 SSE 事件条数，防止内存泄漏 */
const SSE_EVENT_BUFFER_MAX = 50;
/** 无客户端连接的 buffer 保留时长，超时删除避免 Map 只增不减 */
const SSE_EVENT_BUFFER_TTL_MS = 30000;
/** SSE 事件缓冲：SSE 连接晚于 chat 响应时，先缓冲事件，连接建立后回放 */
const sseEventBuffers = new Map<
  string,
  { events: string[]; createdAt: number }
>();

interface SessionFirstTokenContext {
  requestId?: string;
  projectId?: string;
  engine?: string;
  chatReceivedAt: number;
  createdAt: number;
  isNewSession: boolean;
}

const sessionFirstTokenContexts = new Map<string, SessionFirstTokenContext>();

/**
 * 删除已过 TTL 且仍无客户端连接的 buffer 条目（在 pushSseEvent 无客户端路径中调用）。
 */
function pruneExpiredSseEventBuffers(): void {
  const now = Date.now();
  for (const [sessionId, buf] of sseEventBuffers.entries()) {
    if (
      now - buf.createdAt >= SSE_EVENT_BUFFER_TTL_MS &&
      !sseClients.has(sessionId)
    ) {
      sseEventBuffers.delete(sessionId);
      sessionFirstTokenContexts.delete(sessionId);
    }
  }
}

function pruneExpiredSessionFirstTokenContexts(): void {
  const now = Date.now();
  for (const [sessionId, ctx] of sessionFirstTokenContexts.entries()) {
    if (
      now - ctx.createdAt >= SSE_EVENT_BUFFER_TTL_MS &&
      !sseClients.has(sessionId)
    ) {
      sessionFirstTokenContexts.delete(sessionId);
    }
  }
}

function bindSessionFirstTokenContext(
  sessionId: string,
  context: Omit<SessionFirstTokenContext, "createdAt">,
): void {
  sessionFirstTokenContexts.set(sessionId, {
    ...context,
    createdAt: Date.now(),
  });
}

function clearSessionFirstTokenContext(sessionId: string): void {
  sessionFirstTokenContexts.delete(sessionId);
}

/**
 * 返回某 session 当前缓冲的 SSE 事件条数（仅用于单测，勿在生产逻辑中依赖）。
 */
export function getSseEventBufferSize(sessionId: string): number {
  return sseEventBuffers.get(sessionId)?.events.length ?? 0;
}

/**
 * 返回某 session 的首字追踪上下文是否存在（仅用于单测，勿在生产逻辑中依赖）。
 */
export function hasSessionFirstTokenContext(sessionId: string): boolean {
  return sessionFirstTokenContexts.has(sessionId);
}

/**
 * 设置首字追踪上下文（仅用于单测）。
 */
export function setSessionFirstTokenContextForTest(
  sessionId: string,
  context: Omit<SessionFirstTokenContext, "createdAt">,
): void {
  bindSessionFirstTokenContext(sessionId, context);
}

/**
 * 清除指定 session 的 SSE 事件缓冲（cancel/stop 接口调用，避免取消后重连仍回放旧事件）。
 */
export function clearSseEventBuffer(sessionId: string): void {
  if (!sessionId) return;
  sseEventBuffers.delete(sessionId);
  clearSessionFirstTokenContext(sessionId);
}

/**
 * 清除所有 SSE 事件缓冲（客户端停止/重启所有服务时调用，避免重启后仍回放旧会话事件）。
 */
export function clearAllSseEventBuffers(): void {
  sseEventBuffers.clear();
  sessionFirstTokenContexts.clear();
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
    log.debug(
      "[ensureProjectWorkspace] workspaceDir not configured, skipping check",
    );
    return;
  }

  // 本地快速检测：COMPUTER_WORKSPACE_DIR = workspaceDir/computer-project-workspace
  const projectDir = path.join(
    agentConfig.workspaceDir,
    "computer-project-workspace",
    userId,
    projectId,
  );
  if (fs.existsSync(projectDir)) {
    log.debug(
      `[ensureProjectWorkspace] Directory already exists, skipping: ${projectDir}`,
    );
    return;
  }

  // 目录不存在，先检查 file-server 健康状态（带重试，file-server 可能还在启动中）
  const maxRetries = 3;
  let lastHealthError: string | undefined;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const health = await checkFileServerHealth(fileServerPort);
    if (health.healthy) {
      lastHealthError = undefined;
      break;
    }
    lastHealthError = health.error;
    log.warn(
      `[ensureProjectWorkspace] File-server not ready (attempt ${attempt}/${maxRetries}): ${health.error}`,
    );
    if (attempt < maxRetries) {
      await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
    }
  }
  if (lastHealthError) {
    throw new Error(
      `File server is not healthy after ${maxRetries} attempts, cannot create workspace: ${lastHealthError}`,
    );
  }

  // 目录不存在，通知 file-server 创建空目录结构（不传 zip，不写入 skills）
  log.info(
    `[ensureProjectWorkspace] Directory not found, creating: ${projectDir}`,
  );

  // multer 要求 multipart/form-data，手动拼接 boundary
  const boundary = `----FormBoundary${Date.now()}`;
  const formBody = [
    `--${boundary}`,
    `Content-Disposition: form-data; name="userId"`,
    "",
    userId,
    `--${boundary}`,
    `Content-Disposition: form-data; name="cId"`,
    "",
    projectId,
    `--${boundary}--`,
  ].join("\r\n");

  const response = await new Promise<http.IncomingMessage>(
    (resolve, reject) => {
      const req = http.request(
        {
          hostname: LOCALHOST_HOSTNAME,
          port: fileServerPort,
          path: "/api/computer/create-workspace",
          method: "POST",
          headers: {
            "Content-Type": `multipart/form-data; boundary=${boundary}`,
            "Content-Length": Buffer.byteLength(formBody),
          },
          timeout: 30000,
        },
        resolve,
      );
      req.on("error", reject);
      req.on("timeout", () => {
        req.destroy();
        reject(new Error("Request timeout"));
      });
      req.write(formBody);
      req.end();
    },
  );

  let body = "";
  for await (const chunk of response) {
    body += chunk;
  }

  const result = JSON.parse(body);
  if (result.success || result.workspaceRoot) {
    log.info(
      `[ensureProjectWorkspace] ✅ Workspace directory created: ${result.workspaceRoot || projectDir}`,
    );
  } else {
    log.warn(
      `[ensureProjectWorkspace] file-server returned failure:`,
      result.message || result,
    );
  }
}

function parseBody(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let body = "";
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_SIZE) {
        req.destroy();
        reject(new Error("Request body too large"));
        return;
      }
      body += chunk;
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

/**
 * 解析 URL query 参数为对象
 */
function parseQuery(url: URL): Record<string, string> {
  const params: Record<string, string> = {};
  url.searchParams.forEach((v, k) => {
    params[k] = v;
  });
  return params;
}

/**
 * 构建 rcoder HttpResult<T> 成功响应
 */
function httpResult<T>(data: T): HttpResult<T> {
  return { code: "0000", message: "success", data, tid: null, success: true };
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
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  });
  res.end(json);
}

// ==================== Request Router ====================

async function handleRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
) {
  const url = new URL(
    req.url || "/",
    `http://${req.headers.host || LOCALHOST_HOSTNAME}`,
  );
  const pathname = url.pathname;
  const method = req.method?.toUpperCase() || "GET";

  // CORS preflight
  if (method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    });
    res.end();
    return;
  }

  // Admin Server 接口（与 Computer Server 共用 60006 端口）
  if (pathname.startsWith("/admin/")) {
    return handleAdminRequest(req, res);
  }

  // 竞态条件防护：Computer HTTP Server 在 startup.ts 中异步启动，
  // 但 agentService.init() 要等到 Setup Wizard 完成后才调用。
  // 如果请求在 agent 未就绪时到达，返回 503 让客户端重试。
  if (pathname.startsWith("/computer/") && !agentService.isReady) {
    log.warn(
      `[HTTP] Agent not ready, rejecting request: ${method} ${pathname}`,
    );
    sendJson(
      res,
      503,
      httpError("SERVICE_NOT_READY", "Agent service is not initialized yet"),
    );
    return;
  }

  try {
    // GET /health
    if (pathname === "/health" && method === "GET") {
      sendJson(res, 200, {
        status: agentService.isReady ? "healthy" : "offline",
        engineType: agentService.getEngineType(),
        timestamp: new Date().toISOString(),
      });
      return;
    }

    // POST /computer/chat
    if (pathname === "/computer/chat" && method === "POST") {
      const t0 = Date.now();
      let t1: number, t2: number, t3: number, t4: number;

      const body = (await parseBody(req)) as ComputerChatRequest;
      t1 = Date.now();
      firstTokenTrace.trace(
        "chat.received",
        {
          requestId: body.request_id,
          projectId: body.project_id,
          sessionId: body.session_id,
        },
        { parseBodyMs: t1 - t0, userId: body.user_id },
      );
      // 记录 Electron 侧收到请求的时间（Java 后端经 lanproxy 转发过来），含 parseBody
      getPerfLogger().info(
        `[PERF] /chat received: parseBody=${t1 - t0}ms  rid=${body.request_id?.slice(0, 8)}  project=${body.project_id}`,
      );

      // 开发调试：完整打印入参（脱敏后，避免 api_key / agent_config.env / URL 中 ak= 写入日志）
      log.debug(
        "📨 [HTTP][DEBUG] Computer Chat request body =",
        redactStringForLog(JSON.stringify(redactForLog(body), null, 2)),
      );

      // 业务级别 info 日志：重点字段摘要（脱敏 model_provider / agent_config，避免 api_key 泄露）
      log.info("📨 [HTTP] Computer Chat request received", {
        user_id: body.user_id,
        project_id: body.project_id,
        session_id: body.session_id,
        request_id: body.request_id,
        model_provider: redactForLog(body.model_provider),
        agent_config: redactForLog(body.agent_config),
        // 先 redactForLog 脱敏键值，再 redactStringForLog 脱敏字符串内 URL 的 ak= / ts=
        context_servers_json: body.agent_config?.context_servers
          ? redactStringForLog(
              JSON.stringify(redactForLog(body.agent_config.context_servers)),
            )
          : undefined,
        system_prompt_length: body.system_prompt
          ? body.system_prompt.length
          : 0,
        prompt_length: body.prompt ? body.prompt.length : 0,
      });

      // 验证必填字段
      if (!body.user_id) {
        log.error("❌ [HTTP] user_id is required for ComputerAgentRunner");
        firstTokenTrace.trace(
          "chat.failed",
          {
            requestId: body.request_id,
            projectId: body.project_id,
            sessionId: body.session_id,
          },
          { reason: "missing_user_id" },
        );
        sendJson(
          res,
          400,
          httpError(
            "VALIDATION_ERROR",
            "user_id is required for ComputerAgentRunner",
          ),
        );
        return;
      }
      t2 = Date.now();
      firstTokenTrace.trace(
        "chat.validated",
        {
          requestId: body.request_id,
          projectId: body.project_id,
          sessionId: body.session_id,
        },
        { validateMs: t2 - t1 },
      );
      getPerfLogger().info(`[PERF] /chat.validate: ${t2 - t1}ms`);

      // 确保项目工作空间存在（客户端快速重新登录后工作空间可能被清空）
      if (body.project_id) {
        try {
          const { fileServer: fileServerPort } = getConfiguredPorts();
          await ensureProjectWorkspace(
            body.user_id,
            body.project_id,
            fileServerPort,
          );
        } catch (wsErr: any) {
          log.warn(
            "[HTTP] ensureProjectWorkspace failed (non-blocking):",
            wsErr.message,
          );
          // 不阻断请求，继续执行
        }
      }
      const t2_5 = Date.now();
      firstTokenTrace.trace(
        "chat.workspace.ready",
        {
          requestId: body.request_id,
          projectId: body.project_id,
          sessionId: body.session_id,
        },
        { workspaceMs: t2_5 - t2 },
      );
      getPerfLogger().info(`[PERF] /chat.ensureWorkspace: ${t2_5 - t2}ms`);

      // 确保正确的引擎已启动（按 project_id 路由到对应 AcpEngine）
      let acpEngine;
      try {
        acpEngine = await agentService.ensureEngineForRequest(body);
      } catch (err: any) {
        log.error("❌ [HTTP] Engine switch failed:", err);
        firstTokenTrace.trace(
          "chat.failed",
          {
            requestId: body.request_id,
            projectId: body.project_id,
            sessionId: body.session_id,
          },
          {
            reason: "ensure_engine_failed",
            error: err?.message || String(err),
          },
        );
        sendJson(
          res,
          200,
          httpError("5000", err.message || "Engine switch failed"),
        );
        return;
      }
      t3 = Date.now();
      firstTokenTrace.trace(
        "chat.engine.ready",
        {
          requestId: body.request_id,
          projectId: body.project_id,
          sessionId: body.session_id,
          engine: acpEngine?.engineName,
        },
        { ensureEngineMs: t3 - t2_5 },
      );
      getPerfLogger().info(`[PERF] /chat.ensureEngine: ${t3 - t2_5}ms`);

      if (!acpEngine) {
        log.error("❌ [HTTP] Agent not initialized");
        sendJson(res, 200, httpError("5000", "Agent not initialized"));
        return;
      }

      // chat() 已返回 HttpResult<ComputerChatResponse> 格式
      const result = await acpEngine.chat(body);
      t4 = Date.now();
      firstTokenTrace.trace(
        result.success ? "chat.response.sent" : "chat.failed",
        {
          requestId: body.request_id,
          projectId: body.project_id,
          sessionId: result.data?.session_id || body.session_id,
          engine: acpEngine.engineName,
        },
        {
          acpChatMs: t4 - t3,
          totalMs: t4 - t0,
          success: result.success,
          code: result.code,
          message: result.success ? "ok" : result.message,
        },
      );
      getPerfLogger().info(`[PERF] /chat.acpChat: ${t4 - t3}ms`);

      if (result.success) {
        log.info(
          `✅ [HTTP] Computer Chat response: session_id=${result.data?.session_id}`,
        );
        if (result.data?.session_id) {
          bindSessionFirstTokenContext(result.data.session_id, {
            requestId: body.request_id || result.data.request_id,
            projectId: body.project_id || result.data.project_id,
            engine: acpEngine.engineName,
            // TTFT 口径：/computer/chat 收到请求（handler 入口）到首个真实 token。
            chatReceivedAt: t0,
            isNewSession: result.data.is_new_session === true,
          });
        }
      } else {
        log.error(`❌ [HTTP] Computer Chat failed: ${result.message}`);
      }

      getPerfLogger().info(
        `[PERF] /chat: ${t4 - t0}ms  rid=${body.request_id?.slice(0, 8)}  (parseBody=${t1 - t0}ms validate=${t2 - t1}ms workspace=${t2_5 - t2}ms engine=${t3 - t2_5}ms chat=${t4 - t3}ms)`,
      );
      sendJson(res, 200, result);
      return;
    }

    // GET /computer/progress/{session_id} — SSE
    if (pathname.startsWith("/computer/progress/") && method === "GET") {
      const sseStartTime = Date.now();
      const sessionId = pathname.replace("/computer/progress/", "");
      firstTokenTrace.trace("sse.connect", { sessionId });
      getPerfLogger().info(`[PERF] sse.connect  session=${sessionId}`);
      log.info(
        `📡 [HTTP] SSE connect request: session_id=${sessionId}, time=${new Date().toISOString()}`,
      );

      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "Access-Control-Allow-Origin": "*",
      });
      res.write("\n");

      // 检查 Agent 是否 idle — 如果是，发送立即结束事件（对齐 rcoder is_agent_idle 逻辑）
      const acpEngine = agentService.getAcpEngine();
      if (!acpEngine || !agentService.hasRunningEngines) {
        log.info(
          `💤 [HTTP] Agent idle, sending SessionPromptEnd: session_id=${sessionId}`,
        );
        const endEvent: UnifiedSessionMessage = {
          sessionId,
          messageType: "sessionPromptEnd",
          subType: "end_turn",
          data: {
            reason: "EndTurn",
            description: "Agent has no task in progress",
          },
          timestamp: new Date().toISOString(),
        };
        res.write(`event: end_turn\ndata: ${JSON.stringify(endEvent)}\n\n`);
        clearSessionFirstTokenContext(sessionId);
        res.end();
        return;
      }

      // 注册 SSE 客户端
      if (!sseClients.has(sessionId)) {
        sseClients.set(sessionId, []);
      }
      sseClients.get(sessionId)!.push(res);
      getPerfLogger().info(
        `[PERF] sse.register: ${Date.now() - sseStartTime}ms  session=${sessionId}`,
      );

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
          log.info(
            `[SSE] Replayed ${replayed} buffered events: session_id=${sessionId}`,
          );
        }
      }

      // 心跳：发送符合 UnifiedSessionMessage 格式的心跳消息（对齐 rcoder heartbeat）
      const heartbeat = setInterval(() => {
        try {
          const hb: UnifiedSessionMessage = {
            sessionId,
            messageType: "heartbeat",
            subType: "ping",
            data: {
              type: "heartbeat",
              message: "keep-alive",
              timestamp: new Date().toISOString(),
            },
            timestamp: new Date().toISOString(),
          };
          res.write(`event: ping\ndata: ${JSON.stringify(hb)}\n\n`);
        } catch {
          /* client disconnected */
        }
      }, DEFAULT_SSE_HEARTBEAT_INTERVAL);

      req.on("close", () => {
        clearInterval(heartbeat);
        log.debug(
          `[HTTP] Client disconnected: session_id=${sessionId}, durationMs=${Date.now() - sseStartTime}`,
        );
        const clients = sseClients.get(sessionId);
        if (clients) {
          const idx = clients.indexOf(res);
          if (idx >= 0) clients.splice(idx, 1);
          if (clients.length === 0) sseClients.delete(sessionId);
        }
        // 清理 perf 首事件状态，防止连接中断（无 end_turn）时 Map 泄漏
        sseFirstEventSent.delete(sessionId);
        sseFirstTokenSent.delete(sessionId);
        clearSessionFirstTokenContext(sessionId);
      });

      res.on("error", () => {
        clearInterval(heartbeat);
      });

      log.info(
        `✅ [HTTP] SSE stream established: session_id=${sessionId}, setupMs=${Date.now() - sseStartTime}`,
      );
      return;
    }

    // POST /computer/agent/status
    if (pathname === "/computer/agent/status" && method === "POST") {
      // t0Handler 计时从请求到达开始，包含 parseBody 在内的全程 handler 耗时
      const t0Handler = Date.now();
      const body = await parseBody(req);
      log.info(
        `🔍 [HTTP] Computer Agent status query: user_id=${body.user_id}, project_id=${body.project_id}`,
      );

      if (!body.user_id) {
        sendJson(
          res,
          400,
          httpError("VALIDATION_ERROR", "user_id is required"),
        );
        return;
      }
      if (!body.project_id) {
        sendJson(
          res,
          400,
          httpError("VALIDATION_ERROR", "project_id is required"),
        );
        return;
      }

      const projectEngine = agentService.getEngineForProject(body.project_id);
      const acpEngine = projectEngine || agentService.getAcpEngine();
      const session =
        acpEngine?.findSessionByProjectId(body.project_id) ?? null;

      if (session) {
        log.info(
          `✅ [HTTP] Agent status: project_id=${body.project_id}, is_alive=true, session_id=${session.id}`,
        );
      } else {
        log.warn(`⚠️ [HTTP] Agent not found: project_id=${body.project_id}`);
      }
      getPerfLogger().info(
        `[PERF] /agent/status: ${Date.now() - t0Handler}ms  project=${body.project_id} alive=${!!projectEngine}`,
      );

      sendJson(
        res,
        200,
        httpResult({
          user_id: body.user_id,
          project_id: body.project_id,
          is_alive: !!projectEngine,
          session_id: session?.id ?? null,
          status: session
            ? session.status === "active"
              ? "Busy"
              : "Idle"
            : null,
          last_activity: session?.lastActivity
            ? new Date(session.lastActivity).toISOString()
            : null,
          created_at: session
            ? new Date(session.createdAt).toISOString()
            : null,
        }),
      );
      return;
    }

    // POST /computer/agent/stop（停止该 project 的引擎，下次 chat 会冷启动）
    if (pathname === "/computer/agent/stop" && method === "POST") {
      const body = await parseBody(req);
      log.info(
        `🛑 [HTTP] Computer Agent stop request: user_id=${body.user_id}, project_id=${body.project_id}`,
      );

      if (!body.user_id) {
        sendJson(
          res,
          400,
          httpError("VALIDATION_ERROR", "user_id is required"),
        );
        return;
      }
      if (!body.project_id) {
        sendJson(
          res,
          400,
          httpError("VALIDATION_ERROR", "project_id is required"),
        );
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
        log.info(`✅ [HTTP] Agent stopped: project_id=${body.project_id}`);
      } else {
        log.info(
          `ℹ️ [HTTP] Agent not found, idempotent success: project_id=${body.project_id}`,
        );
      }

      sendJson(
        res,
        200,
        httpResult({
          success: true,
          message: "Agent stopped successfully",
          user_id: body.user_id,
          project_id: body.project_id,
        }),
      );
      return;
    }

    // POST /computer/agent/session/cancel
    // rcoder 使用 Query 参数，兼容 body 和 query 两种方式
    if (pathname === "/computer/agent/session/cancel" && method === "POST") {
      const query = parseQuery(url);
      const body = await parseBody(req).catch(() => ({}));
      const userId = query.user_id || body.user_id || "";
      const projectId = query.project_id || body.project_id || "";
      const sessionId = query.session_id || body.session_id || "";

      log.info(
        `🚫 [HTTP] Computer Agent cancel request: user_id=${userId}, project_id=${projectId}, session_id=${sessionId}`,
      );

      if (!userId) {
        sendJson(
          res,
          400,
          httpError("VALIDATION_ERROR", "user_id is required"),
        );
        return;
      }
      if (!projectId) {
        sendJson(
          res,
          400,
          httpError("VALIDATION_ERROR", "project_id is required"),
        );
        return;
      }

      let cancelledSessionId = sessionId;
      const acpEngine =
        agentService.getEngineForProject(projectId) ||
        agentService.getAcpEngine();
      if (acpEngine) {
        if (sessionId) {
          const ok = await acpEngine.abortSession(sessionId);
          if (ok) {
            log.info(`✅ [HTTP] Cancel succeeded: session_id=${sessionId}`);
          } else {
            log.warn(
              `⚠️ [HTTP] Cancel failed (session not found): session_id=${sessionId}`,
            );
          }
        } else {
          const session = acpEngine.findSessionByProjectId(projectId);
          if (session) {
            cancelledSessionId = session.id;
            await acpEngine.abortSession(session.id);
            log.info(`✅ [HTTP] Cancel succeeded: session_id=${session.id}`);
          } else {
            log.info(
              `ℹ️ [HTTP] Agent not found, idempotent success: project_id=${projectId}`,
            );
          }
        }
      }
      // 取消后清除该 session 的 SSE 事件缓冲，避免后续 GET /computer/progress 仍回放已取消会话的旧事件
      if (cancelledSessionId) {
        clearSseEventBuffer(cancelledSessionId);
      }

      sendJson(
        res,
        200,
        httpResult({
          success: true,
          session_id: sessionId,
        }),
      );
      return;
    }

    // POST /computer/gui-agent/vision-model — 保存 GUI Agent 视觉模型配置
    if (pathname === "/computer/gui-agent/vision-model" && method === "POST") {
      const body = await parseBody(req);
      log.info("[HTTP] Saving GUI Agent vision model config");
      const { writeSetting } = await import("../db");
      writeSetting("gui_agent_vision_model", body);
      sendJson(res, 200, httpResult({ success: true }));
      return;
    }

    // GET /computer/gui-agent/vision-model — 获取 GUI Agent 视觉模型配置
    if (pathname === "/computer/gui-agent/vision-model" && method === "GET") {
      const { readSetting } = await import("../db");
      const config = readSetting(
        "gui_agent_vision_model",
      ) as GuiVisionModelConfig | null;
      sendJson(
        res,
        200,
        httpResult(
          config || {
            provider: "anthropic",
            apiProtocol: "anthropic",
            model: "claude-sonnet-4-20250514",
            displayIndex: 0,
            coordinateMode: "auto",
            maxSteps: 50,
            stepDelayMs: 1500,
            jpegQuality: 75,
          },
        ),
      );
      return;
    }

    // GET /computer/gui-agent/displays — 获取可用显示器列表
    if (pathname === "/computer/gui-agent/displays" && method === "GET") {
      try {
        const { screen } = await import("electron");
        const displays = screen.getAllDisplays();
        const result: GuiDisplayInfo[] = displays.map((d, idx) => ({
          index: idx,
          label:
            idx === 0
              ? `${t("Claw.GUIAgent.display.primary")} (${d.size.width}x${d.size.height})`
              : `${t("Claw.GUIAgent.display.secondary")} ${idx + 1} (${d.size.width}x${d.size.height})`,
          width: d.size.width,
          height: d.size.height,
          scaleFactor: d.scaleFactor,
          isPrimary: d.bounds.x === 0 && d.bounds.y === 0,
        }));
        sendJson(res, 200, httpResult(result));
      } catch (err: any) {
        log.error("[HTTP] Failed to get display list:", err);
        sendJson(
          res,
          200,
          httpError("5000", err.message || "Failed to get displays"),
        );
      }
      return;
    }

    // POST /computer/gui-agent/display — 设置目标显示器
    if (pathname === "/computer/gui-agent/display" && method === "POST") {
      const body = await parseBody(req);
      const displayIndex = body.displayIndex as number;
      log.info(`[HTTP] Setting GUI Agent target display: ${displayIndex}`);
      const { readSetting, writeSetting } = await import("../db");
      const existing = (readSetting("gui_agent_vision_model") || {}) as Record<
        string,
        unknown
      >;
      writeSetting("gui_agent_vision_model", { ...existing, displayIndex });
      sendJson(res, 200, httpResult({ success: true, displayIndex }));
      return;
    }

    // 404
    sendJson(res, 404, httpError("NOT_FOUND", `Path not found: ${pathname}`));
  } catch (error: any) {
    log.error(`❌ [HTTP] Request handling error: ${pathname}`, error);
    firstTokenTrace.trace(
      "chat.failed",
      {},
      {
        reason: "request_handler_exception",
        path: pathname,
        error: error?.message || String(error),
      },
    );
    sendJson(
      res,
      500,
      httpError("5000", error.message || "Internal server error"),
    );
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
// 跟踪每个 session 的首事件时间戳（用于计算流式总耗时）
const sseFirstEventSent = new Map<string, number>();
// 跟踪每个 session 的首个真实文本 token 时间戳（排除 heartbeat 等非文本事件）
const sseFirstTokenSent = new Map<string, number>();

let _chunkStructureLogged = false;

function extractAgentChunkText(data: unknown): string {
  const text = (data as { data?: { content?: { text?: unknown } } })?.data
    ?.content?.text;
  if (!_chunkStructureLogged) {
    _chunkStructureLogged = true;
    log.debug(
      `[PERF] sse.firstChunk structure sample: ${JSON.stringify(data).slice(0, 200)}`,
    );
  }
  return typeof text === "string" ? text : "";
}

export function pushSseEvent(
  sessionId: string,
  eventName: string,
  data: unknown,
) {
  const clients = sseClients.get(sessionId);
  const payload = `event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`;
  const now = Date.now();

  // 记录首事件和结束事件
  const isAgentChunk = eventName === "agent_message_chunk";
  const isFirstMessage = isAgentChunk && !sseFirstEventSent.has(sessionId);
  const chunkText = isAgentChunk ? extractAgentChunkText(data) : "";
  const isFirstToken =
    isAgentChunk && !!chunkText.trim() && !sseFirstTokenSent.has(sessionId);
  const isEndTurn = eventName === "end_turn";

  if (isFirstMessage) {
    sseFirstEventSent.set(sessionId, now);
    firstTokenTrace.trace("sse.first_chunk", { sessionId });
    getPerfLogger().info(`[PERF] sse.firstChunk  session=${sessionId}`);
  }
  if (isFirstToken) {
    sseFirstTokenSent.set(sessionId, now);
    firstTokenTrace.trace("sse.first_token", { sessionId });
    getPerfLogger().info(`[PERF] sse.firstToken  session=${sessionId}`);
    const firstTokenCtx = sessionFirstTokenContexts.get(sessionId);
    if (firstTokenCtx) {
      const ttftMs = Math.max(0, now - firstTokenCtx.chatReceivedAt);
      const rid = firstTokenCtx.requestId?.slice(0, 8) || "(none)";
      const project = firstTokenCtx.projectId || "(none)";
      getPerfLogger().info(
        `[PERF] /chat.firstToken: ${ttftMs}ms  rid=${rid}  session=${sessionId}  project=${project}  isNewSession=${firstTokenCtx.isNewSession}`,
      );
      if (firstTokenCtx.isNewSession) {
        getPerfLogger().info(
          `[PERF] /chat.newSession.firstToken: ${ttftMs}ms  rid=${rid}  session=${sessionId}  project=${project}`,
        );
      }
      firstTokenTrace.trace(
        "chat.first_token.returned",
        {
          requestId: firstTokenCtx.requestId,
          sessionId,
          projectId: firstTokenCtx.projectId,
          engine: firstTokenCtx.engine,
        },
        {
          ttftMs,
          isNewSession: firstTokenCtx.isNewSession,
        },
      );
    }
  }
  if (isEndTurn) {
    firstTokenTrace.trace("sse.end_turn", { sessionId });
    const firstChunkTime = sseFirstEventSent.get(sessionId);
    const firstTokenTime = sseFirstTokenSent.get(sessionId);
    sseFirstEventSent.delete(sessionId);
    sseFirstTokenSent.delete(sessionId);
    clearSessionFirstTokenContext(sessionId);

    const streamingMs =
      firstChunkTime !== undefined ? now - firstChunkTime : -1;
    const firstTokenMs =
      firstTokenTime !== undefined ? now - firstTokenTime : -1;

    getPerfLogger().info(
      `[PERF] sse.end${streamingMs >= 0 ? `: ${streamingMs}ms streaming` : ""}  session=${sessionId}`,
    );
    if (firstTokenMs >= 0) {
      getPerfLogger().info(
        `[PERF] sse.end.fromFirstToken: ${firstTokenMs}ms  session=${sessionId}`,
      );
    }
  }

  log.debug(
    `[SSE] pushSseEvent: sessionId=${sessionId}, eventName=${eventName}, time=${now}, clients=${clients?.length || 0}`,
  );

  if (!clients || clients.length === 0) {
    pruneExpiredSseEventBuffers();
    pruneExpiredSessionFirstTokenContexts();
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
        log.warn(
          `[ComputerServer] ⚠ SSE write returned false (buffer full): sessionId=${sessionId}`,
        );
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
export function startComputerServer(
  port: number,
): Promise<{ success: boolean; error?: string }> {
  return new Promise((resolve) => {
    if (server) {
      lastError = null;
      resolve({ success: true });
      return;
    }

    server = http.createServer(handleRequest);

    server.on("error", (err: NodeJS.ErrnoException) => {
      log.error("❌ [ComputerServer] Server error:", err);
      const errorMsg =
        err.code === "EADDRINUSE" ? `Port ${port} already in use` : err.message;
      lastError = errorMsg;
      server = null;
      resolve({ success: false, error: errorMsg });
    });

    // 监听 0.0.0.0：与 Tauri rcoder 行为一致，lanproxy 隧道需要从外部访问此端口
    server.listen(port, "0.0.0.0", () => {
      log.info(
        `✅ [ComputerServer] Listening on 0.0.0.0:${port} (aligned with rcoder /computer/* API)`,
      );
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
    sseFirstEventSent.clear();
    sseFirstTokenSent.clear();
    sessionFirstTokenContexts.clear();

    server.close(() => {
      log.info("[ComputerServer] Stopped");
      server = null;
      lastError = null;
      resolve();
    });
  });
}

/**
 * 获取 Computer Server 状态
 */
export function getComputerServerStatus(): {
  running: boolean;
  port?: number;
  error?: string;
} {
  if (!server || !server.listening) {
    return { running: false, error: lastError || undefined };
  }
  const addr = server.address();
  return {
    running: true,
    port: typeof addr === "object" && addr ? addr.port : undefined,
  };
}

// ==================== Admin Server (管理接口) ====================

import { BrowserWindow } from "electron";
import { DEFAULT_ADMIN_SERVER_PORT } from "@shared/constants";
import { checkLanproxyHealth } from "./packages/lanproxyHealth";

/** 执行完整重启流程（供延迟调用） */
async function doRestartAllServicesIncludingComputerServer(): Promise<
  Record<string, { success: boolean; error?: string }>
> {
  const { getServiceManager } = await import("../ipc/processHandlers");
  const serviceManager = getServiceManager();
  if (!serviceManager) {
    throw new Error("ServiceManager not initialized");
  }

  // 1. 重启除 Lanproxy 外的所有服务
  const base = await serviceManager.restartAllServicesExceptLanproxy();

  // 2. 停止 Computer Server
  await stopComputerServer();

  // 3. 重新启动 Computer Server
  const { getConfiguredPorts } = await import("./startupPorts");
  const { agent: agentPort } = getConfiguredPorts();
  let csResult: { success: boolean; error?: string };
  try {
    await startComputerServer(agentPort);
    csResult = { success: true };
  } catch (e) {
    csResult = { success: false, error: String(e) };
  }

  const results: Record<string, { success: boolean; error?: string }> = {
    ...base.results,
    computerServer: csResult,
  };

  notifyServicesRestarted(results);
  return results;
}

/** 获取主窗口 */
const getMainWindow = () => BrowserWindow.getAllWindows()[0];

/** 通知渲染进程服务正在重启 */
const notifyServicesRestarting = () => {
  getMainWindow()?.webContents.send("admin:servicesRestarting");
};

/** 通知渲染进程服务重启完成 */
const notifyServicesRestarted = (
  results: Record<string, { success: boolean; error?: string }>,
) => {
  const hasFailure = Object.values(results).some((r) => !r.success);
  getMainWindow()?.webContents.send("admin:servicesRestarted", {
    success: !hasFailure,
    results,
  });
};

/**
 * Admin Server 请求处理
 */
async function handleAdminRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<void> {
  const url = new URL(
    req.url || "/",
    `http://localhost:${DEFAULT_ADMIN_SERVER_PORT}`,
  );
  const pathname = url.pathname;
  const method = req.method || "GET";

  const sendJson = (status: number, data: unknown) => {
    res.writeHead(status, {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    });
    res.end(JSON.stringify(data));
  };

  try {
    // GET /admin/health — Admin Server 自身健康检查
    if (pathname === "/admin/health" && method === "GET") {
      sendJson(200, { status: "ok", timestamp: Date.now() });
      return;
    }

    // GET /admin/health/lanproxy — 检查代理服务通道健康状态
    if (pathname === "/admin/health/lanproxy" && method === "GET") {
      const { readSetting } = await import("../db");
      const savedKey = readSetting("auth.saved_key") as string | null;
      if (!savedKey) {
        sendJson(200, { healthy: false, error: "savedKey not configured" });
        return;
      }
      const health = await checkLanproxyHealth(savedKey);
      sendJson(200, health);
      return;
    }

    // POST /admin/services/restart — 重启除 Lanproxy 外的所有服务
    if (pathname === "/admin/services/restart" && method === "POST") {
      log.info("[AdminServer] /admin/services/restart called");

      // 立即返回，避免 Computer Server 自己被重启导致响应无法写回
      sendJson(200, {
        code: "0000",
        message: "Restart scheduled; will run in 2 seconds",
        data: null,
      });

      // 通知渲染进程服务正在重启
      notifyServicesRestarting();

      // 延迟 2 秒后执行实际重启（不等完成，异步进行）
      setTimeout(async () => {
        try {
          const results = await doRestartAllServicesIncludingComputerServer();
          const failedServices = Object.entries(results)
            .filter(([, v]) => !v.success)
            .map(([k, v]) => `${k}: ${v.error}`)
            .join("; ");
          if (failedServices) {
            log.warn(
              `[AdminServer] Some services failed to start: ${failedServices}`,
            );
          } else {
            log.info("[AdminServer] Delayed restart complete");
          }
        } catch (e) {
          log.error("[AdminServer] Delayed restart error:", e);
        }
      }, 2000);
      return;
    }

    // 404
    sendJson(404, { code: "404", message: `Path not found: ${pathname}` });
  } catch (error: any) {
    log.error(`[AdminServer] Request handling error: ${pathname}`, error);
    sendJson(500, {
      code: "1003",
      message: error.message || "Internal error",
      data: null,
    });
  }
}
