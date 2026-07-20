import * as http from "http";
import * as net from "net";
import * as path from "path";
import { randomBytes } from "crypto";
import type { Duplex } from "stream";
import { app } from "electron";
import log from "electron-log";
import { APP_DATA_DIR_NAME } from "@shared/constants";
import { readSetting } from "../../db";
import { LOCALHOST_IP } from "../constants";
import { agentService } from "../engines/unifiedAgent";
import { resolveComputerProjectWorkspaceDir } from "../workspacePaths";

type GatewayStartOptions = {
  listenPort: number;
  targetPort: number;
};

type ParsedTtydRoute = {
  userId: string;
  projectId: string;
  targetPath: string;
  cwd: string;
};

let server: http.Server | null = null;
let listenPort: number | null = null;
let targetPort: number | null = null;
let lastError: string | null = null;
const activeSockets = new Set<net.Socket | Duplex>();

function sendPlain(
  res: http.ServerResponse,
  statusCode: number,
  message: string,
) {
  res.writeHead(statusCode, {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-cache",
  });
  res.end(message);
}

function decodeSafePathSegment(value: string): string | null {
  try {
    const decoded = decodeURIComponent(value);
    if (
      !decoded ||
      decoded === "." ||
      decoded === ".." ||
      decoded.includes("/") ||
      decoded.includes("\\") ||
      decoded.includes(path.sep)
    ) {
      return null;
    }
    return decoded;
  } catch {
    return null;
  }
}

function getBaseWorkspaceDir(): string {
  const step1 = readSetting("step1_config") as { workspaceDir?: string } | null;
  if (step1?.workspaceDir) return step1.workspaceDir;

  const agentConfig = agentService.getAgentConfig();
  if (agentConfig?.workspaceDir) return agentConfig.workspaceDir;

  return path.join(app.getPath("home"), APP_DATA_DIR_NAME, "workspace");
}

function hasExplicitCwdArg(params: URLSearchParams): boolean {
  return params.getAll("arg").includes("--cwd");
}

function parseTtydRoute(rawUrl: string | undefined): ParsedTtydRoute | null {
  const url = new URL(rawUrl || "/", `http://${LOCALHOST_IP}`);
  const segments = url.pathname.split("/").filter(Boolean);
  if (
    segments.length < 5 ||
    segments[0] !== "computer" ||
    segments[1] !== "ttyd"
  ) {
    return null;
  }

  const userId = decodeSafePathSegment(segments[2]);
  const projectId = decodeSafePathSegment(segments[3]);
  if (!userId || !projectId) return null;

  const rest = segments.slice(4).join("/");
  const targetPathname = `/${rest || ""}`;
  const params = url.searchParams;
  const cwd = resolveComputerProjectWorkspaceDir(
    getBaseWorkspaceDir(),
    userId,
    projectId,
  );

  if (targetPathname === "/ws" && !hasExplicitCwdArg(params)) {
    params.append("arg", "--cwd");
    params.append("arg", cwd);
  }

  const query = params.toString();
  return {
    userId,
    projectId,
    targetPath: query ? `${targetPathname}?${query}` : targetPathname,
    cwd,
  };
}

function buildProxyHeaders(
  headers: http.IncomingHttpHeaders,
  port: number,
): http.OutgoingHttpHeaders {
  const proxyHeaders: http.OutgoingHttpHeaders = { ...headers };
  proxyHeaders.host = `${LOCALHOST_IP}:${port}`;
  return proxyHeaders;
}

function formatResponseHeaders(headers: http.IncomingHttpHeaders): string {
  const lines: string[] = [];
  for (const [key, value] of Object.entries(headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const item of value) lines.push(`${key}: ${item}`);
    } else {
      lines.push(`${key}: ${value}`);
    }
  }
  return lines.join("\r\n");
}

function proxyHttpRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  route: ParsedTtydRoute,
  port: number,
) {
  const proxyReq = http.request(
    {
      hostname: LOCALHOST_IP,
      port,
      path: route.targetPath,
      method: req.method,
      headers: buildProxyHeaders(req.headers, port),
    },
    (proxyRes) => {
      res.writeHead(proxyRes.statusCode || 502, proxyRes.headers);
      proxyRes.pipe(res);
    },
  );

  proxyReq.on("error", (error) => {
    log.warn("[ttydGateway] HTTP proxy failed:", error);
    if (!res.headersSent) {
      sendPlain(res, 502, "ttyd gateway proxy failed");
    } else {
      res.destroy(error);
    }
  });

  req.pipe(proxyReq);
}

function proxyWebSocketUpgrade(
  req: http.IncomingMessage,
  clientSocket: Duplex,
  head: Buffer,
  route: ParsedTtydRoute,
  port: number,
) {
  const proxyReq = http.request({
    hostname: LOCALHOST_IP,
    port,
    path: route.targetPath,
    method: req.method,
    headers: buildProxyHeaders(req.headers, port),
  });

  proxyReq.on("upgrade", (proxyRes, proxySocket, proxyHead) => {
    activeSockets.add(proxySocket);
    proxySocket.on("close", () => activeSockets.delete(proxySocket));
    proxySocket.on("error", () => activeSockets.delete(proxySocket));

    const statusLine = `HTTP/1.1 ${proxyRes.statusCode || 101} ${
      proxyRes.statusMessage || "Switching Protocols"
    }`;
    const headerText = formatResponseHeaders(proxyRes.headers);
    clientSocket.write(`${statusLine}\r\n${headerText}\r\n\r\n`);

    if (proxyHead.length) clientSocket.write(proxyHead);
    if (head.length) proxySocket.write(head);

    proxySocket.pipe(clientSocket);
    clientSocket.pipe(proxySocket);
  });

  proxyReq.on("response", (proxyRes) => {
    log.warn(
      `[ttydGateway] Unexpected non-upgrade response: ${proxyRes.statusCode}`,
    );
    clientSocket.write(
      `HTTP/1.1 ${proxyRes.statusCode || 502} Bad Gateway\r\nConnection: close\r\n\r\n`,
    );
    proxyRes.resume();
    clientSocket.destroy();
  });

  proxyReq.on("error", (error) => {
    log.warn("[ttydGateway] WebSocket proxy failed:", error);
    if (!clientSocket.destroyed) {
      clientSocket.write(
        "HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n",
      );
      clientSocket.destroy();
    }
  });

  proxyReq.end();
}

export function getTtydGatewayStatus(): {
  running: boolean;
  port?: number;
  targetPort?: number;
  error?: string;
} {
  if (!server || !server.listening) {
    return { running: false, error: lastError || undefined };
  }
  return {
    running: true,
    port: listenPort || undefined,
    targetPort: targetPort || undefined,
  };
}

export async function checkTtydGatewayHealth(options: {
  port: number;
  timeoutMs?: number;
}): Promise<{ healthy: boolean; error?: string }> {
  const timeoutMs = options.timeoutMs ?? 1000;
  const healthPath = "/computer/ttyd/health/health/ws";

  return new Promise((resolve) => {
    let settled = false;
    let timeoutHandle: ReturnType<typeof setTimeout> | null = null;

    const finish = (result: { healthy: boolean; error?: string }) => {
      if (settled) return;
      settled = true;
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
        timeoutHandle = null;
      }
      resolve(result);
    };

    const req = http.request({
      hostname: LOCALHOST_IP,
      port: options.port,
      path: healthPath,
      method: "GET",
      headers: {
        Host: `${LOCALHOST_IP}:${options.port}`,
        Connection: "Upgrade",
        Upgrade: "websocket",
        "Sec-WebSocket-Version": "13",
        "Sec-WebSocket-Key": randomBytes(16).toString("base64"),
        "Sec-WebSocket-Protocol": "tty",
      },
    });

    timeoutHandle = setTimeout(() => {
      finish({
        healthy: false,
        error: `WebSocket health check timed out after ${timeoutMs}ms`,
      });
      req.destroy();
    }, timeoutMs);

    req.on("upgrade", (res, socket) => {
      socket.destroy();
      const protocol = res.headers["sec-websocket-protocol"];
      const acceptedProtocol = Array.isArray(protocol)
        ? protocol.includes("tty")
        : protocol === "tty";
      if (res.statusCode === 101 && acceptedProtocol) {
        finish({ healthy: true });
      } else {
        finish({
          healthy: false,
          error: `Unexpected WebSocket upgrade response: status=${res.statusCode}, protocol=${protocol || "<none>"}`,
        });
      }
    });

    req.on("response", (res) => {
      res.resume();
      finish({
        healthy: false,
        error: `Expected WebSocket upgrade, got HTTP ${res.statusCode}`,
      });
    });

    req.on("error", (error) => {
      finish({ healthy: false, error: error.message });
    });

    req.end();
  });
}

export async function allocateInternalTtydPort(
  avoidPort?: number,
): Promise<number> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const port = await new Promise<number>((resolve, reject) => {
      const probe = http.createServer();
      probe.once("error", reject);
      probe.listen(0, LOCALHOST_IP, () => {
        const addr = probe.address();
        const selected = typeof addr === "object" && addr ? addr.port : 0;
        probe.close(() => resolve(selected));
      });
    });
    if (port && port !== avoidPort) return port;
  }
  throw new Error("Failed to allocate an internal ttyd port");
}

export async function startTtydGateway(
  options: GatewayStartOptions,
): Promise<{ success: boolean; error?: string }> {
  if (server?.listening) {
    if (
      listenPort === options.listenPort &&
      targetPort === options.targetPort
    ) {
      lastError = null;
      return { success: true };
    }
    await stopTtydGateway();
  }

  listenPort = options.listenPort;
  targetPort = options.targetPort;

  return new Promise((resolve) => {
    const nextServer = http.createServer((req, res) => {
      const route = parseTtydRoute(req.url);
      if (!route) {
        sendPlain(res, 404, "ttyd gateway route not found");
        return;
      }
      proxyHttpRequest(req, res, route, options.targetPort);
    });

    nextServer.on("connection", (socket) => {
      activeSockets.add(socket);
      socket.on("close", () => activeSockets.delete(socket));
      socket.on("error", () => activeSockets.delete(socket));
    });

    nextServer.on("upgrade", (req, socket, head) => {
      const route = parseTtydRoute(req.url);
      if (!route) {
        socket.write("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
        socket.destroy();
        return;
      }
      log.info(
        `[ttydGateway] WS ${route.userId}/${route.projectId} -> ${route.targetPath} (cwd=${route.cwd})`,
      );
      proxyWebSocketUpgrade(req, socket, head, route, options.targetPort);
    });

    nextServer.once("error", (error: NodeJS.ErrnoException) => {
      lastError =
        error.code === "EADDRINUSE"
          ? `Port ${options.listenPort} already in use`
          : error.message;
      server = null;
      listenPort = null;
      targetPort = null;
      resolve({ success: false, error: lastError });
    });

    nextServer.listen(options.listenPort, LOCALHOST_IP, () => {
      server = nextServer;
      lastError = null;
      log.info(
        `[ttydGateway] Listening on ${LOCALHOST_IP}:${options.listenPort}, target=${LOCALHOST_IP}:${options.targetPort}`,
      );
      resolve({ success: true });
    });
  });
}

export async function stopTtydGateway(): Promise<void> {
  const current = server;
  server = null;
  listenPort = null;
  targetPort = null;
  lastError = null;

  for (const socket of activeSockets) {
    socket.destroy();
  }
  activeSockets.clear();

  if (!current) return;
  await new Promise<void>((resolve) => {
    current.close(() => resolve());
  });
  log.info("[ttydGateway] Stopped");
}
