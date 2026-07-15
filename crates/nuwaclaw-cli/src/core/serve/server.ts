import * as http from "node:http";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import type { EngineKind } from "../env/inheritEnv.js";
import type { PermissionMode } from "../permissions/policy.js";
import { SessionHub } from "./sessionHub.js";
import { writeServeLock, clearServeLock } from "./serveLock.js";
import { ensureDir } from "../../util/paths.js";
import { debugLog } from "../debugLog.js";

export interface ServeOptions {
  port: number;
  host: string;
  engine: EngineKind;
  cwd: string;
  cwdIsProject?: boolean;
  permissionMode: PermissionMode;
  overlay?: { apiKey?: string; baseUrl?: string; model?: string };
  acceptedSecrets?: string[];
  allowUnauthenticatedComputerRoutes?: boolean;
}

async function readJsonBody(
  req: http.IncomingMessage,
  maxBytes = 10 * 1024 * 1024,
): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buffer = chunk as Buffer;
    total += buffer.byteLength;
    if (total > maxBytes) {
      throw new Error(`request body too large (max ${maxBytes} bytes)`);
    }
    chunks.push(buffer);
  }
  const raw = Buffer.concat(chunks).toString("utf-8");
  if (!raw) return {};
  return JSON.parse(raw);
}

function sendJson(
  res: http.ServerResponse,
  status: number,
  body: unknown,
): void {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers":
      "Content-Type, Authorization, X-Nuwax-Internal-Secret",
  });
  res.end(JSON.stringify(body));
}

function httpResult<T>(data: T): {
  code: "0000";
  message: "success";
  data: T;
  success: true;
  tid: null;
} {
  return { code: "0000", message: "success", data, success: true, tid: null };
}

function httpError(
  code: string,
  message: string,
): {
  code: string;
  message: string;
  data: null;
  success: false;
  tid: null;
  error: string;
} {
  return {
    code,
    message,
    data: null,
    success: false,
    tid: null,
    error: message,
  };
}

function textField(
  body: Record<string, unknown>,
  ...keys: string[]
): string | undefined {
  for (const key of keys) {
    const value = body[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return undefined;
}

function secretCandidates(req: http.IncomingMessage, url: URL): string[] {
  const candidates: string[] = [];
  const headerSecret = req.headers["x-nuwax-internal-secret"];
  if (typeof headerSecret === "string") candidates.push(headerSecret);

  const authorization = req.headers.authorization;
  if (typeof authorization === "string") {
    const bearer = authorization.match(/^Bearer\s+(.+)$/i);
    candidates.push(bearer ? bearer[1] : authorization);
  }

  for (const key of [
    "apiKey",
    "api_key",
    "token",
    "access_token",
    "x-nuwax-internal-secret",
  ]) {
    const value = url.searchParams.get(key);
    if (value) candidates.push(value);
  }

  return candidates;
}

function chatProjectKey(
  body: Record<string, unknown>,
  ...fallbacks: Array<string | undefined | null>
): string | undefined {
  return (
    textField(body, "project_id", "projectId") ??
    textField(body, "agent_work_dir", "agentWorkDir") ??
    textField(body, "session_id", "sessionId") ??
    fallbacks.find((value) => typeof value === "string" && value.length > 0) ??
    undefined
  );
}

function workspaceSegment(value: string, fallback: string): string {
  const normalized = value.trim();
  if (!normalized) return fallback;
  const segment = normalized
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
  return segment || fallback;
}

function resolveExistingDirectory(
  candidate: string,
): { ok: true; cwd: string } | { ok: false; error: string } {
  const cwd = path.resolve(candidate);
  let stat: fs.Stats;
  try {
    stat = fs.statSync(cwd);
  } catch {
    return {
      ok: false,
      error: `workspace directory does not exist: ${cwd}`,
    };
  }
  if (!stat.isDirectory()) {
    return {
      ok: false,
      error: `workspace path is not a directory: ${cwd}`,
    };
  }
  return { ok: true, cwd };
}

function resolveChatCwd(
  body: Record<string, unknown>,
  defaultCwd: string,
  defaultCwdIsProject: boolean,
):
  | { ok: true; cwd: string; projectKey?: string }
  | { ok: false; error: string } {
  const explicitCwd = textField(body, "cwd", "workspace_dir", "workspaceDir");
  const projectKey = chatProjectKey(body);
  if (explicitCwd) {
    const resolved = resolveExistingDirectory(explicitCwd);
    return resolved.ok ? { ...resolved, projectKey } : resolved;
  }

  if (defaultCwdIsProject) {
    const resolved = resolveExistingDirectory(defaultCwd);
    return resolved.ok ? { ...resolved, projectKey } : resolved;
  }

  if (projectKey) {
    const cwd = path.join(
      path.resolve(defaultCwd),
      workspaceSegment(projectKey, "default"),
    );
    ensureDir(cwd);
    return { ok: true, cwd, projectKey };
  }

  const resolved = resolveExistingDirectory(defaultCwd);
  return resolved.ok ? { ...resolved, projectKey } : resolved;
}

/**
 * Starts the local-only HTTP server. Returns the generated internal secret
 * (never persisted — callers must copy it from the printed startup message
 * or the returned value) and a stop() function.
 */
export function startServeHttp(options: ServeOptions): {
  secret: string;
  server: http.Server;
  addAcceptedSecret: (secret: string | undefined) => void;
  stop: () => Promise<void>;
} {
  const secret = crypto.randomBytes(24).toString("hex");
  const hub = new SessionHub(options.permissionMode, options.overlay);
  const acceptedSecrets = new Set(
    [secret, ...(options.acceptedSecrets ?? [])].filter(Boolean),
  );
  debugLog("serve.http", "starting", {
    host: options.host,
    port: options.port,
    engine: options.engine,
    cwd: options.cwd,
    permissionMode: options.permissionMode,
    acceptedSecretCount: acceptedSecrets.size,
    allowUnauthenticatedComputerRoutes:
      options.allowUnauthenticatedComputerRoutes === true,
  });

  const server = http.createServer((req, res) => {
    let url = new URL(req.url ?? "/", `http://${req.headers.host}`);
    const originalPath = url.pathname;
    if (url.pathname.startsWith("/devcomputer/")) {
      url = new URL(
        url.pathname.replace("/devcomputer/", "/computer/") + url.search,
        `http://${req.headers.host}`,
      );
    }
    const method = req.method?.toUpperCase() ?? "GET";
    debugLog("serve.http", "request", {
      method,
      path: url.pathname,
      originalPath,
      hasInternalSecretHeader:
        typeof req.headers["x-nuwax-internal-secret"] === "string",
      hasAuthorizationHeader: typeof req.headers.authorization === "string",
      queryAuthKeys: ["apiKey", "api_key", "token", "access_token"].filter(
        (key) => url.searchParams.has(key),
      ),
    });

    if (method === "OPTIONS") {
      sendJson(res, 204, {});
      return;
    }

    if (url.pathname === "/health") {
      sendJson(res, 200, {
        status: "ok",
        engine: options.engine,
        timestamp: new Date().toISOString(),
      });
      return;
    }

    const isProgressRoute =
      url.pathname.startsWith("/computer/progress/") && method === "GET";
    const isComputerRoute = url.pathname.startsWith("/computer/");
    const allowElectronCompatibleComputerRoute =
      options.allowUnauthenticatedComputerRoutes === true && isComputerRoute;
    const authorized = secretCandidates(req, url).some((candidate) =>
      acceptedSecrets.has(candidate),
    );
    if (
      !authorized &&
      !isProgressRoute &&
      !allowElectronCompatibleComputerRoute
    ) {
      debugLog("serve.http", "unauthorized", {
        method,
        path: url.pathname,
      });
      sendJson(res, 401, {
        ...httpError("UNAUTHORIZED", "missing or invalid internal secret"),
        error: "missing or invalid internal secret",
      });
      return;
    }

    if (url.pathname === "/computer/chat" && method === "POST") {
      readJsonBody(req)
        .then(async (body) => {
          const prompt = textField(body, "prompt", "message", "content");
          if (!prompt) {
            sendJson(
              res,
              400,
              httpError("VALIDATION_ERROR", "prompt is required"),
            );
            return;
          }
          const existingId = textField(body, "session_id", "sessionId");
          const userId = textField(body, "user_id", "userId");
          const projectId = textField(body, "project_id", "projectId");
          const cwdResult = resolveChatCwd(
            body,
            options.cwd,
            options.cwdIsProject === true,
          );
          if (!cwdResult.ok) {
            debugLog("serve.chat", "cwd resolution failed", {
              userId,
              projectId,
              agentWorkDir: textField(body, "agent_work_dir", "agentWorkDir"),
              error: cwdResult.error,
            });
            sendJson(res, 400, httpError("VALIDATION_ERROR", cwdResult.error));
            return;
          }
          debugLog("serve.chat", "received", {
            userId,
            projectId,
            agentWorkDir: textField(body, "agent_work_dir", "agentWorkDir"),
            existingId,
            projectKey: cwdResult.projectKey,
            cwd: cwdResult.cwd,
            promptLength: prompt.length,
            hasExplicitCwd: Boolean(
              textField(body, "cwd", "workspace_dir", "workspaceDir"),
            ),
          });

          const session = existingId ? hub.getSession(existingId) : undefined;
          if (existingId && !session) {
            debugLog("serve.chat", "session not found", { existingId });
            sendJson(
              res,
              404,
              httpError(
                "ERR_SESSION_NOT_FOUND",
                `session ${existingId} not found`,
              ),
            );
            return;
          }
          const target =
            session ??
            hub.startSession(options.engine, cwdResult.cwd, {
              userId,
              projectId: cwdResult.projectKey ?? projectId,
            });

          // Wait for the engine to actually connect before responding — if
          // resolve()/session/new fails, surface it here instead of handing
          // back a session_id for a session nothing will ever drive forward
          // (the SSE side has no subscriber yet to receive an error event).
          const readiness = await target.ready;
          if (!readiness.ok) {
            await hub.stopSession(target.sessionId);
            debugLog("serve.chat", "engine start failed", {
              sessionId: target.sessionId,
              error: readiness.error,
            });
            sendJson(
              res,
              502,
              httpError("ENGINE_START_FAILED", readiness.error),
            );
            return;
          }

          hub.enqueuePrompt(target.sessionId, prompt);
          debugLog("serve.chat", "accepted", {
            sessionId: target.sessionId,
            isNewSession: !session,
            projectKey: cwdResult.projectKey,
          });
          const payload = {
            session_id: target.sessionId,
            is_new_session: !session,
            request_id: textField(body, "request_id", "requestId"),
            user_id: userId,
            project_id: projectId,
          };
          sendJson(res, 202, {
            ...httpResult(payload),
            session_id: target.sessionId,
          });
        })
        .catch((err) =>
          sendJson(res, 400, httpError("BAD_REQUEST", (err as Error).message)),
        );
      return;
    }

    if (url.pathname.startsWith("/computer/progress/") && method === "GET") {
      const sessionId = url.pathname.replace("/computer/progress/", "");
      debugLog("serve.progress", "connect", {
        sessionId,
        authorized,
      });
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "Access-Control-Allow-Origin": "*",
      });
      res.write("\n");
      if (!hub.subscribeSse(sessionId, res)) {
        debugLog("serve.progress", "session not found; sent idle end", {
          sessionId,
        });
        const message = {
          sessionId,
          messageType: "sessionPromptEnd",
          subType: "end_turn",
          data: {
            reason: "EndTurn",
            description: "Agent has no task in progress",
          },
          timestamp: new Date().toISOString(),
        };
        res.write(`event: end_turn\ndata: ${JSON.stringify(message)}\n\n`);
        res.end();
        return;
      }
      const heartbeat = setInterval(() => {
        const message = {
          sessionId,
          messageType: "heartbeat",
          subType: "ping",
          data: { type: "heartbeat", message: "keep-alive" },
          timestamp: new Date().toISOString(),
        };
        try {
          res.write(`event: ping\ndata: ${JSON.stringify(message)}\n\n`);
        } catch {
          clearInterval(heartbeat);
        }
      }, 15000);
      res.on("close", () => clearInterval(heartbeat));
      return;
    }

    if (url.pathname === "/computer/agent/status" && method === "GET") {
      const sessions = hub.listSessions();
      debugLog("serve.status", "list", { count: sessions.length });
      sendJson(res, 200, { ...httpResult({ sessions }), sessions });
      return;
    }

    if (url.pathname === "/computer/agent/status" && method === "POST") {
      readJsonBody(req)
        .then(async (body) => {
          const projectId = textField(body, "project_id", "projectId");
          const sessionId = textField(body, "session_id", "sessionId");
          const projectKey = chatProjectKey(body, projectId);
          debugLog("serve.status", "query", {
            sessionId,
            projectId,
            agentWorkDir: textField(body, "agent_work_dir", "agentWorkDir"),
            projectKey,
          });
          const session = sessionId
            ? hub.getSession(sessionId)
            : projectKey
              ? hub.findSessionByProjectId(projectKey)
              : undefined;
          sendJson(
            res,
            200,
            httpResult({
              user_id: textField(body, "user_id", "userId"),
              project_id: projectId,
              is_alive: Boolean(session),
              session_id: session?.sessionId ?? null,
              status: session ? "Busy" : null,
              last_activity: null,
              created_at: null,
            }),
          );
        })
        .catch((err) =>
          sendJson(res, 400, httpError("BAD_REQUEST", (err as Error).message)),
        );
      return;
    }

    if (url.pathname === "/computer/agent/stop" && method === "POST") {
      readJsonBody(req)
        .then(async (body) => {
          const sessionId = textField(body, "session_id", "sessionId");
          const projectId = textField(body, "project_id", "projectId");
          const projectKey = chatProjectKey(body, projectId);
          debugLog("serve.stop", "request", {
            sessionId,
            projectId,
            agentWorkDir: textField(body, "agent_work_dir", "agentWorkDir"),
            projectKey,
          });
          const session = sessionId
            ? hub.getSession(sessionId)
            : projectKey
              ? hub.findSessionByProjectId(projectKey)
              : undefined;
          if (!session) {
            debugLog("serve.stop", "session not found", {
              sessionId,
              projectKey,
            });
            sendJson(
              res,
              404,
              httpError(
                "ERR_SESSION_NOT_FOUND",
                sessionId || projectKey
                  ? `session ${sessionId ?? projectKey} not found`
                  : "session_id, agent_work_dir or project_id is required",
              ),
            );
            return;
          }
          await hub.stopSession(session.sessionId);
          sendJson(
            res,
            200,
            httpResult({
              success: true,
              message: "Agent stopped successfully",
              session_id: session.sessionId,
              project_id: projectId,
            }),
          );
        })
        .catch((err) =>
          sendJson(res, 400, httpError("BAD_REQUEST", (err as Error).message)),
        );
      return;
    }

    if (
      url.pathname === "/computer/agent/session/cancel" &&
      method === "POST"
    ) {
      readJsonBody(req)
        .then(async (body) => {
          const sessionId =
            textField(body, "session_id", "sessionId") ??
            url.searchParams.get("session_id") ??
            undefined;
          const projectId =
            textField(body, "project_id", "projectId") ??
            url.searchParams.get("project_id") ??
            undefined;
          const agentWorkDir =
            textField(body, "agent_work_dir", "agentWorkDir") ??
            url.searchParams.get("agent_work_dir") ??
            undefined;
          const projectKey = agentWorkDir ?? projectId;
          const session = sessionId
            ? hub.getSession(sessionId)
            : projectKey
              ? hub.findSessionByProjectId(projectKey)
              : undefined;
          if (session) await hub.stopSession(session.sessionId);
          debugLog("serve.cancel", "request", {
            sessionId,
            projectId,
            agentWorkDir,
            projectKey,
            found: Boolean(session),
          });
          sendJson(
            res,
            200,
            httpResult({
              success: true,
              session_id: session?.sessionId ?? sessionId,
            }),
          );
        })
        .catch((err) =>
          sendJson(res, 400, httpError("BAD_REQUEST", (err as Error).message)),
        );
      return;
    }

    if (url.pathname === "/computer/notify-resolved" && method === "POST") {
      readJsonBody(req)
        .then(() =>
          sendJson(res, 200, httpResult({ success: true, ignored: true })),
        )
        .catch((err) =>
          sendJson(res, 400, httpError("BAD_REQUEST", (err as Error).message)),
        );
      return;
    }

    sendJson(res, 404, httpError("NOT_FOUND", "not found"));
  });

  server.listen(options.port, options.host);

  // Write a pid/port/host lock on listen so `status` can report a running
  // serve without persisting the secret (which stays ephemeral). Cleared in
  // stop(); a crash leaves a stale lock that getServeStatus() auto-cleans.
  server.once("listening", () => {
    const address = server.address();
    const actualPort =
      typeof address === "object" && address ? address.port : options.port;
    debugLog("serve.http", "listening", {
      host: options.host,
      port: actualPort,
    });
    writeServeLock({
      pid: process.pid,
      port: actualPort,
      host: options.host,
      startedAt: new Date().toISOString(),
    });
  });

  return {
    secret,
    server,
    addAcceptedSecret: (value) => {
      if (!value) return;
      acceptedSecrets.add(value);
      debugLog("serve.http", "accepted secret added", {
        acceptedSecretCount: acceptedSecrets.size,
      });
    },
    stop: async () => {
      debugLog("serve.http", "stopping");
      // Tear down every active engine session first so their child processes
      // don't outlive the server, then close the HTTP server.
      // closeAllConnections() is what lets server.close(cb) actually fire —
      // otherwise a lingering SSE stream or keepalive socket keeps cb pending
      // forever and shutdown hangs.
      await hub.stopAll().catch(() => {});
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      clearServeLock();
      debugLog("serve.http", "stopped");
    },
  };
}
