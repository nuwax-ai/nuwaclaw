/**
 * Computer HTTP Server — 请求路由
 *
 * 包含 handleRequest 主路由函数及所有子路由 handler：
 * /computer/chat、/computer/progress/{id}（SSE）、
 * /computer/agent/status|stop|session/cancel、
 * /computer/notify-resolved、/computer/gui-agent/*、/health
 */

import * as http from "http";
import * as fs from "fs";
import * as path from "path";
import log from "electron-log";
import { t } from "../i18n";
import { getPerfLogger } from "../../bootstrap/logConfig";
import { agentService } from "../engines/unifiedAgent";
import { firstTokenTrace } from "../engines/perf/firstTokenTrace";
import { checkFileServerHealth } from "../packages/fileServerHealth";
import { LOCALHOST_HOSTNAME } from "../constants";
import { getConfiguredPorts } from "../startupPorts";
import type {
  ComputerChatRequest,
  HttpResult,
  UnifiedSessionMessage,
} from "../engines/unifiedAgent";
import type {
  GuiVisionModelConfig,
  GuiDisplayInfo,
} from "@shared/types/computerTypes";
import { redactForLog, redactStringForLog } from "../utils/logRedact";
import { DEFAULT_SSE_HEARTBEAT_INTERVAL } from "@shared/constants";
import type {
  NotifyResolvedRequest,
  NotifyResolvedResponse,
  ComputerNotifyResolvedRequest,
} from "@shared/types/intervention";
import {
  verifyInternalCallback,
  validateNotifyResolvedRequest,
  validateComputerPermissionResolveRequest,
  statusFromNotifyResolvedResult,
  isComputerPermissionResolveRequest,
} from "../intervention";
import { serverState } from "./state";
import {
  registerSseClient,
  unregisterSseClient,
  replayBufferedEvents,
  clearSseTimers,
  clearSseEventBuffer,
  bindSessionFirstTokenContext,
  clearSessionFirstTokenContext,
} from "./sseManager";

// ==================== Helpers ====================

const MAX_BODY_SIZE = 10 * 1024 * 1024;

/**
 * 检测项目工作空间目录是否存在，不存在则通过 file-server 创建空目录结构。
 *
 * 规则：
 * - 目录已存在 → 直接返回，不做任何写入（保护已有 .claude/skills/ 等内容）
 * - 目录不存在 → 调用 file-server create-workspace（不传 zip，仅建目录）
 * - workspaceDir 未配置 → 跳过整个检测，不调用 file-server
 */
async function ensureProjectWorkspace(
  userId: string,
  projectId: string,
  fileServerPort: number,
): Promise<void> {
  const agentConfig = agentService.getAgentConfig();
  if (!agentConfig?.workspaceDir) {
    log.debug(
      "[ensureProjectWorkspace] workspaceDir not configured, skipping check",
    );
    return;
  }

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

  log.info(
    `[ensureProjectWorkspace] Directory not found, creating: ${projectDir}`,
  );

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

export function parseBody(req: http.IncomingMessage): Promise<any> {
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

function parseQuery(url: URL): Record<string, string> {
  const params: Record<string, string> = {};
  url.searchParams.forEach((v, k) => {
    params[k] = v;
  });
  return params;
}

function httpResult<T>(data: T): HttpResult<T> {
  return { code: "0000", message: "success", data, tid: null, success: true };
}

function httpError(code: string, message: string): HttpResult<null> {
  return { code, message, data: null, tid: null, success: false };
}

function sendJson(res: http.ServerResponse, statusCode: number, data: unknown) {
  const json = JSON.stringify(data);
  res.writeHead(statusCode, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Nuwax-Internal-Secret",
  });
  res.end(json);
}

// ==================== Request Router ====================

export async function handleRequest(
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

  // 竞态条件防护：Computer HTTP Server 在 startup.ts 中异步启动，
  // 但 agentService.init() 要等到 Setup Wizard 完成后才调用。
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
      getPerfLogger().info(
        `[PERF] /chat received: parseBody=${t1 - t0}ms  rid=${body.request_id?.slice(0, 8)}  project=${body.project_id}`,
      );

      log.debug(
        "📨 [HTTP][DEBUG] Computer Chat request body =",
        redactStringForLog(JSON.stringify(redactForLog(body), null, 2)),
      );

      log.info("📨 [HTTP] Computer Chat request received", {
        user_id: body.user_id,
        project_id: body.project_id,
        session_id: body.session_id,
        request_id: body.request_id,
        model_provider: redactForLog(body.model_provider),
        agent_config: redactForLog(body.agent_config),
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

      registerSseClient(sessionId, res);
      getPerfLogger().info(
        `[PERF] sse.register: ${Date.now() - sseStartTime}ms  session=${sessionId}`,
      );

      const replayed = replayBufferedEvents(sessionId, res);
      if (replayed > 0) {
        log.info(
          `[SSE] Replayed ${replayed} buffered events: session_id=${sessionId}`,
        );
      }

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
        unregisterSseClient(sessionId, res);
        clearSseTimers(sessionId);
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

    // POST /computer/agent/stop
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

    // POST /computer/notify-resolved
    if (pathname === "/computer/notify-resolved" && method === "POST") {
      const body = (await parseBody(req)) as
        | NotifyResolvedRequest
        | ComputerNotifyResolvedRequest;
      const isComputerPermissionResolve =
        isComputerPermissionResolveRequest(body);
      const hasInternalSecretHeader =
        typeof req.headers["x-nuwax-internal-secret"] === "string";

      if (!serverState.interventionSecret && !isComputerPermissionResolve) {
        sendJson(res, 500, {
          ok: false,
          error: {
            code: "internal_error",
            message: "intervention secret not initialized",
          },
        });
        return;
      }

      const auth = serverState.interventionSecret
        ? verifyInternalCallback(req, serverState.interventionSecret)
        : { ok: false };
      if (!auth.ok) {
        const { readSetting: _readSetting } = await import("../../db");
        const configKey = _readSetting("auth.config_key") as string | null;
        if (
          configKey &&
          typeof req.headers["x-nuwax-internal-secret"] === "string" &&
          req.headers["x-nuwax-internal-secret"] === configKey
        ) {
          log.info("[HTTP] Accepted notify-resolved with configKey auth");
        } else if (!isComputerPermissionResolve || hasInternalSecretHeader) {
          const payload = isComputerPermissionResolve
            ? httpError("ERR_VALIDATION", "invalid internal secret")
            : {
                ok: false,
                error: {
                  code: "unauthorized",
                  message: "invalid internal secret",
                },
              };
          sendJson(res, 401, payload);
          return;
        }
        log.warn(
          "[HTTP] Accepting computer permission resolve without internal secret; enable X-Nuwax-Internal-Secret once backend supports it",
        );
      }

      const validation = isComputerPermissionResolve
        ? validateComputerPermissionResolveRequest(body)
        : validateNotifyResolvedRequest(body);
      if (!validation.ok) {
        if (isComputerPermissionResolve) {
          sendJson(res, 400, httpError("ERR_VALIDATION", validation.message));
        } else {
          sendJson(res, 400, {
            ok: false,
            error: {
              code: "invalid_acp_response",
              message: validation.message,
            },
          });
        }
        return;
      }

      const projectId = isComputerPermissionResolve
        ? body.project_id
        : undefined;
      const acpEngine =
        (projectId ? agentService.getEngineForProject(projectId) : null) ||
        agentService.getAcpEngine();
      if (!acpEngine) {
        if (isComputerPermissionResolve) {
          sendJson(
            res,
            404,
            httpError("ERR_SESSION_NOT_FOUND", "ACP engine not running"),
          );
        } else {
          sendJson(res, 404, {
            ok: false,
            hostStatus: "gone",
            error: { code: "not_found", message: "ACP engine not running" },
          });
        }
        return;
      }

      const result: NotifyResolvedResponse = (
        acpEngine as any
      ).resolvePermissionIntervention(body);
      const status = statusFromNotifyResolvedResult(result);
      if (isComputerPermissionResolve) {
        if (result.ok) {
          sendJson(res, status, httpResult(result));
        } else {
          sendJson(
            res,
            status,
            httpError(
              result.error?.code ?? "ERR_PERMISSION_RESOLVE_FAILED",
              result.error?.message ?? "permission resolve failed",
            ),
          );
        }
      } else {
        sendJson(res, status, result);
      }
      return;
    }

    // POST /computer/gui-agent/vision-model
    if (pathname === "/computer/gui-agent/vision-model" && method === "POST") {
      const body = await parseBody(req);
      log.info("[HTTP] Saving GUI Agent vision model config");
      const { writeSetting } = await import("../../db");
      writeSetting("gui_agent_vision_model", body);
      sendJson(res, 200, httpResult({ success: true }));
      return;
    }

    // GET /computer/gui-agent/vision-model
    if (pathname === "/computer/gui-agent/vision-model" && method === "GET") {
      const { readSetting } = await import("../../db");
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

    // GET /computer/gui-agent/displays
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

    // POST /computer/gui-agent/display
    if (pathname === "/computer/gui-agent/display" && method === "POST") {
      const body = await parseBody(req);
      const displayIndex = body.displayIndex as number;
      log.info(`[HTTP] Setting GUI Agent target display: ${displayIndex}`);
      const { readSetting, writeSetting } = await import("../../db");
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
