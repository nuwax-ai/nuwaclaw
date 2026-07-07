import * as http from "node:http";
import * as crypto from "node:crypto";
import type { EngineKind } from "../env/inheritEnv.js";
import type { PermissionMode } from "../permissions/policy.js";
import { SessionHub } from "./sessionHub.js";

export interface ServeOptions {
  port: number;
  host: string;
  engine: EngineKind;
  cwd: string;
  permissionMode: PermissionMode;
  overlay?: { apiKey?: string; baseUrl?: string; model?: string };
}

async function readJsonBody(
  req: http.IncomingMessage,
): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const raw = Buffer.concat(chunks).toString("utf-8");
  if (!raw) return {};
  return JSON.parse(raw);
}

function sendJson(
  res: http.ServerResponse,
  status: number,
  body: unknown,
): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
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

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host}`);

    if (url.pathname === "/health") {
      sendJson(res, 200, { status: "ok" });
      return;
    }

    if (req.headers["x-nuwax-internal-secret"] !== secret) {
      sendJson(res, 401, {
        error: "missing or invalid X-Nuwax-Internal-Secret",
      });
      return;
    }

    if (url.pathname === "/computer/chat" && req.method === "POST") {
      readJsonBody(req)
        .then(async (body) => {
          const prompt =
            typeof body.prompt === "string" ? body.prompt : undefined;
          if (!prompt) {
            sendJson(res, 400, { error: "prompt is required" });
            return;
          }
          const existingId =
            typeof body.session_id === "string" ? body.session_id : undefined;
          const cwd = typeof body.cwd === "string" ? body.cwd : options.cwd;

          const session = existingId ? hub.getSession(existingId) : undefined;
          if (existingId && !session) {
            sendJson(res, 404, { error: `session ${existingId} not found` });
            return;
          }
          const target = session ?? hub.startSession(options.engine, cwd);

          // Wait for the engine to actually connect before responding — if
          // resolve()/session/new fails, surface it here instead of handing
          // back a session_id for a session nothing will ever drive forward
          // (the SSE side has no subscriber yet to receive an error event).
          const readiness = await target.ready;
          if (!readiness.ok) {
            await hub.stopSession(target.sessionId);
            sendJson(res, 502, { error: readiness.error });
            return;
          }

          hub.enqueuePrompt(target.sessionId, prompt);
          sendJson(res, 202, { session_id: target.sessionId });
        })
        .catch((err) => sendJson(res, 400, { error: (err as Error).message }));
      return;
    }

    if (
      url.pathname.startsWith("/computer/progress/") &&
      req.method === "GET"
    ) {
      const sessionId = url.pathname.replace("/computer/progress/", "");
      if (!hub.subscribeSse(sessionId, res)) {
        sendJson(res, 404, { error: `session ${sessionId} not found` });
        return;
      }
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });
      res.write("\n");
      return;
    }

    if (url.pathname === "/computer/agent/status" && req.method === "GET") {
      sendJson(res, 200, { sessions: hub.listSessions() });
      return;
    }

    if (url.pathname === "/computer/agent/stop" && req.method === "POST") {
      readJsonBody(req)
        .then(async (body) => {
          const sessionId =
            typeof body.session_id === "string" ? body.session_id : undefined;
          if (!sessionId) {
            sendJson(res, 400, { error: "session_id is required" });
            return;
          }
          const stopped = await hub.stopSession(sessionId);
          sendJson(res, stopped ? 200 : 404, { success: stopped });
        })
        .catch((err) => sendJson(res, 400, { error: (err as Error).message }));
      return;
    }

    sendJson(res, 404, { error: "not found" });
  });

  server.listen(options.port, options.host);

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
    },
  };
}
