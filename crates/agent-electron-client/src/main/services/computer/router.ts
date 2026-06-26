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
  closeSseClientsForSession,
  logSseWirePayloadForDebug,
} from "./sseManager";
import {
  resolveAgentServerPaths,
  resolveAgentEnvPaths,
  resolveComputerProjectWorkspaceDir,
} from "../workspacePaths";
import { getAppDataDir } from "../system/appPaths";
import { parseHttpJsonBody } from "./parseHttpJsonBody";
import {
  shouldAutoReload,
  reloadEngineForRequest,
  attachReloadedToChatResult,
  buildChatErrorWithReload,
} from "./devcomputerAutoReload";
import { ensureSessionIdFromRegistry } from "./ensureChatSessionId";
import { resolveChatProjectRegistryKey } from "./chatEngineKey";
import { rememberProjectSession } from "./projectSessionRegistry";
import { closeStaleSseBeforeChat } from "./closeStaleSseForChat";

// ==================== Helpers ====================

const MAX_BODY_SIZE = 10 * 1024 * 1024;

/**
 * 校验 agent_work_dir 格式：仅允许 [a-zA-Z0-9_-]，长度 1-64。
 * 返回 null 表示合法，返回 string 表示错误信息。
 */
function validateAgentWorkDir(value: string): string | null {
  if (value.length === 0 || value.length > 64) {
    return "agent_work_dir must be 1-64 characters";
  }
  if (!/^[a-zA-Z0-9_-]+$/.test(value)) {
    return "agent_work_dir may only contain [a-zA-Z0-9_-]";
  }
  return null;
}

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
  agentWorkDir: string,
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
    agentWorkDir,
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
    agentWorkDir,
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

  const responseChunks: Buffer[] = [];
  for await (const chunk of response) {
    responseChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const body = Buffer.concat(responseChunks).toString("utf-8");

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
  return parseHttpJsonBody(req, { maxBodySize: MAX_BODY_SIZE }) as Promise<any>;
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

// ==================== Chat Handler (reusable) ====================

/**
 * 处理 Computer Chat 请求的核心逻辑
 *
 * 提取自 handleRequest，供 /computer/chat 和 /devcomputer/chat 共用。
 * @param req - HTTP 请求（用于日志，不读取 body）
 * @param res - HTTP 响应
 * @param preParsedBody - 预解析的请求体（devcomputer 注入 auto_reload 后传入）
 * @param source - 请求来源，用于 {PREFIX_WORKSPACE_DIR} 替换逻辑
 */
export async function handleComputerChat(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  preParsedBody?: ComputerChatRequest,
  source?: "computer" | "devcomputer",
): Promise<void> {
  const t0 = Date.now();
  let t1: number, t2: number, t3: number, t4: number;

  const body = preParsedBody || ((await parseBody(req)) as ComputerChatRequest);
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
    system_prompt_length: body.system_prompt ? body.system_prompt.length : 0,
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

  // 校验 agent_work_dir 格式（如果提供）
  if (body.agent_work_dir) {
    const validationError = validateAgentWorkDir(body.agent_work_dir);
    if (validationError) {
      sendJson(res, 400, httpError("VALIDATION_ERROR", validationError));
      return;
    }
  }

  // 兼容处理：未传 agent_work_dir 时，用 project_id 赋值
  if (!body.agent_work_dir && body.project_id) {
    body.agent_work_dir = body.project_id;
  }

  t2 = Date.now();
  firstTokenTrace.trace(
    "chat.validated",
    {
      requestId: body.request_id,
      projectId: body.project_id,
      agentWorkDir: body.agent_work_dir,
      sessionId: body.session_id,
    },
    { validateMs: t2 - t1 },
  );
  getPerfLogger().info(`[PERF] /chat.validate: ${t2 - t1}ms`);

  if (body.agent_work_dir) {
    try {
      const { fileServer: fileServerPort } = getConfiguredPorts();
      await ensureProjectWorkspace(
        body.user_id,
        body.agent_work_dir,
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
      agentWorkDir: body.agent_work_dir,
      sessionId: body.session_id,
    },
    { workspaceMs: t2_5 - t2 },
  );
  getPerfLogger().info(`[PERF] /chat.ensureWorkspace: ${t2_5 - t2}ms`);

  // 路径变量替换：{PREFIX_WORKSPACE_DIR} → 实际路径
  // command/args 和 env 的替换路径不同：
  //   /devcomputer/chat: 两者都用 baseWorkspaceDir/computer-project-workspace/{user_id}
  //   /computer/chat:    command/args 用 acp-agent/，env 用 logs/agent_logs/
  if (body.agent_config?.agent_server) {
    const server = body.agent_config.agent_server;
    const hasCmdPlaceholder =
      server.command?.includes("{PREFIX_WORKSPACE_DIR}") ||
      server.args?.some((a) => a.includes("{PREFIX_WORKSPACE_DIR}"));
    const hasEnvPlaceholder = server.env
      ? Object.values(server.env).some((v) =>
          v.includes("{PREFIX_WORKSPACE_DIR}"),
        )
      : false;

    if (hasCmdPlaceholder || hasEnvPlaceholder) {
      // command/args 的替换路径
      let cmdPrefix: string;
      // env 的替换路径（与 command/args 可能不同）
      let envPrefix: string;

      if (source === "devcomputer") {
        // 调试场景：替换为项目工作目录
        const baseConfig = agentService.getAgentConfig();
        const baseWorkspaceDir =
          baseConfig?.workspaceDir || path.join(getAppDataDir(), "workspace");
        cmdPrefix = resolveComputerProjectWorkspaceDir(
          baseWorkspaceDir,
          body.user_id,
          "",
        );
        envPrefix = cmdPrefix; // devcomputer: env 和 command/args 一致
      } else {
        // 正式使用：command/args 用应用数据目录（args 中已包含 acp-agent/），env 用 logs 目录
        cmdPrefix = getAppDataDir();
        envPrefix = path.join(getAppDataDir(), "logs", "agent_logs");
      }

      // 替换 command/args
      if (hasCmdPlaceholder) {
        const resolved = resolveAgentServerPaths(
          server.command,
          server.args,
          cmdPrefix,
        );
        if (resolved.command !== undefined) server.command = resolved.command;
        if (resolved.args !== undefined) server.args = resolved.args;
      }

      // 替换 env
      if (hasEnvPlaceholder) {
        server.env = resolveAgentEnvPaths(server.env, envPrefix);
      }

      log.info(
        `[HTTP] Resolved {PREFIX_WORKSPACE_DIR} → cmd=${cmdPrefix}, env=${envPrefix} (source=${source || "computer"})`,
      );
    }
  }

  // 自动安装检查：如果 agent_server.platforms 存在
  if (body.agent_config?.agent_server?.platforms) {
    const { agent_id, command, version, platforms } =
      body.agent_config.agent_server;
    if (agent_id && command && version) {
      try {
        const { installFromUrl, isBuiltinAgent } =
          await import("../agentInstaller");
        if (!isBuiltinAgent(agent_id)) {
          log.info(`[HTTP] Auto-installing agent: ${agent_id}@${version}`);
          await installFromUrl({
            agent: {
              agent_id,
              command,
              args: body.agent_config.agent_server.args,
              version,
            },
            platforms,
          });
        }
      } catch (installErr) {
        log.error(`[HTTP] Auto-install failed: ${installErr}`);
        sendJson(
          res,
          200,
          httpError(
            "ERR_AGENT_AUTO_INSTALL_FAILED",
            `Agent auto-install failed: ${installErr}`,
          ),
        );
        return;
      }
    }
  }

  // reload 前补全 session_id，便于按 session 定位引擎并走 session/load
  ensureSessionIdFromRegistry(body);

  const engineReloaded = shouldAutoReload(body, source)
    ? await reloadEngineForRequest(body)
    : false;

  let acpEngine;
  try {
    acpEngine = await agentService.ensureEngineForRequest(body);
  } catch (err: any) {
    log.error(
      `❌ [HTTP] Engine switch failed (reloaded=${engineReloaded}):`,
      err,
    );
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
      buildChatErrorWithReload(
        body,
        "5000",
        err.message || "Engine switch failed",
        engineReloaded,
      ),
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
    log.error(`❌ [HTTP] Agent not initialized, reloaded=${engineReloaded}`);
    sendJson(
      res,
      200,
      buildChatErrorWithReload(
        body,
        "5000",
        "Agent not initialized",
        engineReloaded,
      ),
    );
    return;
  }

  closeStaleSseBeforeChat(body, acpEngine);

  const result = await acpEngine.chat(body);
  attachReloadedToChatResult(result, body, engineReloaded);
  if (result.success && result.data?.session_id) {
    const projectKey = resolveChatProjectRegistryKey(body);
    if (projectKey) {
      rememberProjectSession(projectKey, result.data.session_id);
    }
  }
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
      `✅ [HTTP] Computer Chat response: session_id=${result.data?.session_id}, reloaded=${result.data?.reloaded === true}`,
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
    log.error(
      `❌ [HTTP] Computer Chat failed: ${result.message}, reloaded=${result.data?.reloaded === true}`,
    );
  }

  getPerfLogger().info(
    `[PERF] /chat: ${t4 - t0}ms  rid=${body.request_id?.slice(0, 8)}  (parseBody=${t1 - t0}ms validate=${t2 - t1}ms workspace=${t2_5 - t2}ms engine=${t3 - t2_5}ms chat=${t4 - t3}ms)`,
  );
  sendJson(res, 200, result);
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
      await handleComputerChat(req, res, undefined, "computer");
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
        const idleEndPayload = `event: end_turn\ndata: ${JSON.stringify(endEvent)}\n\n`;
        logSseWirePayloadForDebug(idleEndPayload);
        res.write(idleEndPayload);
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
          log.debug(
            `[SSE] Sending heartbeat: session_id=${sessionId}, time=${new Date().toISOString()}`,
          );
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
      if (acpEngine && projectId) {
        closeStaleSseBeforeChat(
          {
            user_id: userId,
            project_id: projectId,
            session_id: cancelledSessionId || sessionId || undefined,
            prompt: "",
          },
          acpEngine,
        );
      } else if (cancelledSessionId) {
        clearSseEventBuffer(cancelledSessionId);
        closeSseClientsForSession(cancelledSessionId);
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
