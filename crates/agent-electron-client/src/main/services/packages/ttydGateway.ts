import * as fs from "fs";
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
import {
  findProjectWorkspaceByProjectId,
  resolveComputerProjectWorkspaceDir,
  findNormalProjectWorkspaceByProjectId,
  resolveNormalProjectWorkspaceDir,
} from "../workspacePaths";
import { getTtydInitialCwd } from "./ttydHelper";
import {
  parseTtydRouteParams,
  normalizeTtydAbsoluteDir,
  type TtydRouteParamErrorCode,
  type TtydServiceType,
} from "./ttydRouteParams";

type GatewayStartOptions = {
  listenPort: number;
  targetPort: number;
};

/**
 * 路由解析三态：
 * - ok：正常路由（cwd 已按契约求解完毕）
 * - invalid：query 契约参数非法（→ HTTP/WS 400，带 code/message）
 * - not-found：路径不匹配（→ 404，现 null 语义）
 */
export type TtydRouteResolution =
  | {
      kind: "ok";
      userId: string;
      projectId: string;
      targetPath: string;
      cwd: string;
      serviceType: TtydServiceType;
    }
  | { kind: "invalid"; code: TtydRouteParamErrorCode; message: string }
  | { kind: "not-found" };

let server: http.Server | null = null;
let listenPort: number | null = null;
let targetPort: number | null = null;
let lastError: string | null = null;
const activeSockets = new Set<net.Socket | Duplex>();

function sendPlain(
  res: http.ServerResponse,
  statusCode: number,
  message: string,
  extraHeaders?: http.OutgoingHttpHeaders,
) {
  res.writeHead(statusCode, {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-cache",
    ...extraHeaders,
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

/**
 * 目录是否为「可当工作区用」：存在、是目录、且有内容。
 *
 * 禅道 2526：URL 路径里的 projectId 是平台 conversationId，直接拼出的
 * computer-project-workspace/<userId>/<projectId> 只在「标识符轨道且引擎已在本机跑过」
 * 时是会话真实工作区；对云端沙箱会话 / 绝对路径轨道（web 端目录弹窗自选）会话，
 * 该目录不存在或为空（ensureProjectWorkspace 建的空壳）。终端不应落进这种目录。
 */
export function isUsableWorkspaceDir(dir: string): boolean {
  try {
    if (!fs.statSync(dir).isDirectory()) return false;
    return fs.readdirSync(dir).length > 0;
  } catch {
    return false;
  }
}

/**
 * normalProject 层可用性判据：存在且是目录即用（不查非空）。
 *
 * 与 isUsableWorkspaceDir 的差异：平铺层的「非空」判据防空壳目录（禅道 2526，
 * ensureProjectWorkspace 会为云端会话建空壳）；normalProject 层目录仅由本机
 * chat（ensureNormalProjectWorkspace）在 normalProject 会话真实路由到本机时
 * 创建，空目录是新项目的合法初始形态（引擎尚未写入内容）——对齐云端
 * agent_runner ws_terminal 的 is_dir 语义，避免「刚建项目就开终端落回 workspace 根」。
 */
function isExistingDir(dir: string): boolean {
  try {
    return fs.statSync(dir).isDirectory();
  } catch {
    return false;
  }
}

/**
 * 终端路由 cwd 推导（导出供测试）：
 * 1. service_type=computer-normal-project → normalProject 镜像目录
 *    {base}/computer-project-workspace/{userId}/normalProject/{projectId}（chat 侧
 *    ensureNormalProjectWorkspace 预建，存在即用——空目录是新项目合法初始态，
 *    对齐云端 is_dir 语义；userId 轨道不可信时按 projectId 反查 normalProject 层，
 *    多命中不猜）——镜像云端 /home/user/normalProject/{pid} 布局。镜像层 miss 时
 *    **不走平铺层**（拼接与平铺反查）：常规项目 id 与 conversationId 同为数字
 *    单段名，跨轨道命中会把终端落进同数字普通会话（甚至他人 userId 下）的工作区
 *    ——直接回落三级兜底。
 * 2. 默认业务：拼接目录 computer-project-workspace/<userId>/<projectId> 存在且
 *    非空 → 用之；userId 轨道不可信时按 projectId 反查平铺层。
 * 3. 兜底 getTtydInitialCwd()（最近活跃引擎工作区 → 配置工作区 → HOME；禅道 2526）。
 */
export function resolveRouteCwd(
  userId: string,
  projectId: string,
  options?: { serviceType?: TtydServiceType },
): string {
  if (options?.serviceType === "computer-normal-project") {
    const np = resolveNormalProjectWorkspaceDir(
      getBaseWorkspaceDir(),
      userId,
      projectId,
    );
    if (isExistingDir(np)) {
      return np;
    }
    const npByPid = findNormalProjectWorkspaceByProjectId(
      getBaseWorkspaceDir(),
      projectId,
      isExistingDir,
    );
    if (npByPid) {
      log.info(
        `[ttydGateway] normalProject cwd by projectId: '${np}' unusable, matched '${npByPid}'`,
      );
      return npByPid;
    }
    const npFallback = getTtydInitialCwd();
    log.info(
      `[ttydGateway] normalProject cwd miss ('${np}' missing), fallback to '${npFallback}' (flat layer skipped to avoid cross-track hit)`,
    );
    return npFallback;
  }
  const resolved = resolveComputerProjectWorkspaceDir(
    getBaseWorkspaceDir(),
    userId,
    projectId,
  );
  if (isUsableWorkspaceDir(resolved)) {
    return resolved;
  }
  // userId 轨道不可信时（开发代理写死 local / 跨端 userId 不一致），按 projectId 反查
  // computer-project-workspace/*/{projectId}，命中唯一可用目录则用之，避免终端落进 HOME。
  const byProjectId = findProjectWorkspaceByProjectId(
    getBaseWorkspaceDir(),
    projectId,
    isUsableWorkspaceDir,
  );
  if (byProjectId) {
    log.info(
      `[ttydGateway] route cwd by projectId: '${resolved}' unusable, matched '${byProjectId}'`,
    );
    return byProjectId;
  }
  const fallback = getTtydInitialCwd();
  if (fallback !== resolved) {
    log.info(
      `[ttydGateway] route cwd fallback: '${resolved}' unusable (missing/empty), using '${fallback}'`,
    );
  }
  return fallback;
}

/**
 * 路由解析（导出供测试）。流程：
 * 1. 路径段解析（/computer/ttyd/{userId}/{projectId}/{rest}）失败 → not-found。
 * 2. query 契约参数校验（ttydRouteParams，与服务端对齐）失败 → invalid（400）。
 * 3. cwd query 与存量 arg=--cwd 通道值不同 → invalid（TTYD_CWD_CONFLICT，fail-fast
 *    暴露集成问题）；等值放行。
 * 4. cwd 求解优先级：cwd query（目录存在即用，缺失 warn 回落）> arg=--cwd（存量
 *    IPC 显式通道）> resolveRouteCwd（service_type 推导 + 现有四级链）。
 * 5. /ws 且无显式 arg=--cwd 时注入 arg=--cwd&arg=<cwd>；已消费的 service_type/cwd
 *    从转发 query 剥离（内部 ttyd 只认 arg 参数）。
 */
export function parseTtydRoute(
  rawUrl: string | undefined,
): TtydRouteResolution {
  const url = new URL(rawUrl || "/", `http://${LOCALHOST_IP}`);
  const segments = url.pathname.split("/").filter(Boolean);
  if (
    segments.length < 5 ||
    segments[0] !== "computer" ||
    segments[1] !== "ttyd"
  ) {
    return { kind: "not-found" };
  }

  const userId = decodeSafePathSegment(segments[2]);
  const projectId = decodeSafePathSegment(segments[3]);
  if (!userId || !projectId) return { kind: "not-found" };

  const rest = segments.slice(4).join("/");
  const targetPathname = `/${rest || ""}`;
  const params = url.searchParams;

  const parsedParams = parseTtydRouteParams(params);
  if (!parsedParams.ok) {
    return {
      kind: "invalid",
      code: parsedParams.code,
      message: parsedParams.message,
    };
  }
  const { serviceType, cwd: cwdQuery } = parsedParams;

  const argCwd = extractArgCwdValue(params);
  // 冲突检测：cwd query 与存量 arg=--cwd 通道值不同 → invalid（fail-fast 暴露
  // 集成问题）；等值放行。argCwd 同过归一化后再比较（cwdQuery 是归一化值，
  // 同一目录的两种写法如 C:\x 与 C:/x 不应误报冲突）；argCwd 本身不可归一化
  // （非绝对路径形态）时退回字面比较。
  const argCwdComparable = (() => {
    if (argCwd === null) return null;
    const normalized = normalizeTtydAbsoluteDir(argCwd);
    return normalized.ok ? normalized.value : argCwd;
  })();
  if (
    cwdQuery !== null &&
    argCwdComparable !== null &&
    cwdQuery !== argCwdComparable
  ) {
    return {
      kind: "invalid",
      code: "TTYD_CWD_CONFLICT",
      message: `cwd query '${cwdQuery}' conflicts with arg=--cwd '${argCwd}'`,
    };
  }

  let cwd: string;
  if (cwdQuery !== null && isUsableExplicitCwdDir(cwdQuery)) {
    cwd = cwdQuery;
  } else {
    if (cwdQuery !== null) {
      log.warn(
        `[ttydGateway] Explicit cwd unusable (missing/not a directory), fall back: '${cwdQuery}'`,
      );
    }
    cwd = argCwd ?? resolveRouteCwd(userId, projectId, { serviceType });
  }

  if (targetPathname === "/ws" && !hasExplicitCwdArg(params)) {
    params.append("arg", "--cwd");
    params.append("arg", cwd);
  }
  params.delete("service_type");
  params.delete("cwd");

  const query = params.toString();
  return {
    kind: "ok",
    userId,
    projectId,
    targetPath: query ? `${targetPathname}?${query}` : targetPathname,
    cwd,
    serviceType,
  };
}

/** getAll("arg") 中 --cwd 的后随值；无则 null（存量 IPC 显式通道，ttyd:getWsUrl 在用） */
function extractArgCwdValue(params: URLSearchParams): string | null {
  const args = params.getAll("arg");
  const index = args.indexOf("--cwd");
  return index >= 0 && index + 1 < args.length ? args[index + 1] : null;
}

/**
 * 显式 cwd 可用性判据：存在且是目录即用。与 isUsableWorkspaceDir 的区别：
 * 后者的「非空」判据用于防空壳 computer-project-workspace 目录（禅道 2526，
 * ensureProjectWorkspace 只建目录不落内容）；显式 cwd 是调用方的明确意图，
 * 空目录也是合法落点（对齐服务端 agent_runner resolve_explicit_cwd 语义）。
 */
function isUsableExplicitCwdDir(dir: string): boolean {
  try {
    return fs.statSync(dir).isDirectory();
  } catch {
    return false;
  }
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
  route: Extract<TtydRouteResolution, { kind: "ok" }>,
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
  route: Extract<TtydRouteResolution, { kind: "ok" }>,
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
      if (route.kind === "not-found") {
        sendPlain(res, 404, "ttyd gateway route not found");
        return;
      }
      if (route.kind === "invalid") {
        log.warn(
          `[ttydGateway] Rejected route query: ${route.code}: ${route.message}`,
        );
        sendPlain(res, 400, `[ttyd-gateway] ${route.code}: ${route.message}`, {
          "X-Ttyd-Error-Code": route.code,
        });
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
      if (route.kind === "not-found") {
        socket.write("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
        socket.destroy();
        return;
      }
      if (route.kind === "invalid") {
        log.warn(
          `[ttydGateway] Rejected WS upgrade: ${route.code}: ${route.message}`,
        );
        // 浏览器侧表现为 "Unexpected response code: 400"；X-Ttyd-Error-Code
        // 头供前端/联调定位（对齐现有 404 裸写风格）
        socket.write(
          `HTTP/1.1 400 Bad Request\r\n` +
            `Content-Type: text/plain; charset=utf-8\r\n` +
            `X-Ttyd-Error-Code: ${route.code}\r\n` +
            `Connection: close\r\n\r\n` +
            `[ttyd-gateway] ${route.code}: ${route.message}`,
        );
        socket.destroy();
        return;
      }
      log.info(
        `[ttydGateway] WS ${route.userId}/${route.projectId} -> ${route.targetPath} (cwd=${route.cwd}, serviceType=${route.serviceType})`,
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
