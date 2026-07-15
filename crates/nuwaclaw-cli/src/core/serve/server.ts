import * as http from "node:http";
import * as crypto from "node:crypto";
import type { EngineKind } from "../env/inheritEnv.js";
import type { PermissionMode } from "../permissions/policy.js";
import { SessionHub } from "./sessionHub.js";
import { writeServeLock, clearServeLock } from "./serveLock.js";

export interface ServeOptions {
  port: number;
  host: string;
  engine: EngineKind;
  cwd: string;
  permissionMode: PermissionMode;
  overlay?: { apiKey?: string; baseUrl?: string; model?: string };
  acceptedSecrets?: string[];
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
    "Access-Control-Allow-Headers": "Content-Type, X-Nuwax-Internal-Secret",
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
 * Starts the local-only HTTP server. Returns the generated internal secret
 * (never persisted — callers must copy it from the printed startup message
 * or the returned value) and a stop() function.
 */
export function startServeHttp(options: ServeOptions): {
  secret: string;
  server: http.Server;
  stop: () => Promise<void>;
} {
  const secret = crypto.randomBytes(24).toString("hex");
  const hub = new SessionHub(options.permissionMode, options.overlay);
  const acceptedSecrets = new Set(
    [secret, ...(options.acceptedSecrets ?? [])].filter(Boolean),
  );

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
    const method = req.method?.toUpperCase() ?? "GET";

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

    const suppliedSecret = req.headers["x-nuwax-internal-secret"];
    if (
      typeof suppliedSecret !== "string" ||
      !acceptedSecrets.has(suppliedSecret)
    ) {
      sendJson(res, 401, {
        ...httpError(
          "UNAUTHORIZED",
          "missing or invalid X-Nuwax-Internal-Secret",
        ),
        error: "missing or invalid X-Nuwax-Internal-Secret",
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
          const cwd = typeof body.cwd === "string" ? body.cwd : options.cwd;
          const userId = textField(body, "user_id", "userId");
          const projectId = textField(body, "project_id", "projectId");
          const agentWorkDir = textField(body, "agent_work_dir");
          if (agentWorkDir) {
            const validationError = validateAgentWorkDir(agentWorkDir);
            if (validationError) {
              sendJson(
                res,
                400,
                httpError("VALIDATION_ERROR", validationError),
              );
              return;
            }
          }

          const session = existingId ? hub.getSession(existingId) : undefined;
          if (existingId && !session) {
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
            hub.startSession(options.engine, cwd, {
              userId,
              projectId: projectId ?? agentWorkDir,
            });

          // Wait for the engine to actually connect before responding — if
          // resolve()/session/new fails, surface it here instead of handing
          // back a session_id for a session nothing will ever drive forward
          // (the SSE side has no subscriber yet to receive an error event).
          const readiness = await target.ready;
          if (!readiness.ok) {
            await hub.stopSession(target.sessionId);
            sendJson(
              res,
              502,
              httpError("ENGINE_START_FAILED", readiness.error),
            );
            return;
          }

          hub.enqueuePrompt(target.sessionId, prompt);
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
      if (!hub.subscribeSse(sessionId, res)) {
        sendJson(
          res,
          404,
          httpError("ERR_SESSION_NOT_FOUND", `session ${sessionId} not found`),
        );
        return;
      }
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });
      res.write("\n");
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
      sendJson(res, 200, { ...httpResult({ sessions }), sessions });
      return;
    }

    if (url.pathname === "/computer/agent/status" && method === "POST") {
      readJsonBody(req)
        .then(async (body) => {
          const projectId = textField(body, "project_id", "projectId");
          const sessionId = textField(body, "session_id", "sessionId");
          const session = sessionId
            ? hub.getSession(sessionId)
            : projectId
              ? hub.findSessionByProjectId(projectId)
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
          const session = sessionId
            ? hub.getSession(sessionId)
            : projectId
              ? hub.findSessionByProjectId(projectId)
              : undefined;
          if (!session) {
            sendJson(
              res,
              404,
              httpError(
                "ERR_SESSION_NOT_FOUND",
                sessionId || projectId
                  ? `session ${sessionId ?? projectId} not found`
                  : "session_id or project_id is required",
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
          const session = sessionId
            ? hub.getSession(sessionId)
            : projectId
              ? hub.findSessionByProjectId(projectId)
              : undefined;
          if (session) await hub.stopSession(session.sessionId);
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
    stop: async () => {
      // Tear down every active engine session first so their child processes
      // don't outlive the server, then close the HTTP server.
      // closeAllConnections() is what lets server.close(cb) actually fire —
      // otherwise a lingering SSE stream or keepalive socket keeps cb pending
      // forever and shutdown hangs.
      await hub.stopAll().catch(() => {});
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      clearServeLock();
    },
  };
}
