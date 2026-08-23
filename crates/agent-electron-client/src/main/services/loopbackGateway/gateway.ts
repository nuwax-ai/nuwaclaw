/**
 * Loopback Gateway：nuwax webview 的同源加载网关（阶段一 = 全站透明反代）。
 *
 * 形态（nuwax-desktop 原型已实证的方案回流）：
 * - webview 从 `http://127.0.0.1:<port>/` 加载，所有路径（静态 / /api / WS）
 *   透明反代到 step1_config.serverHost —— 页面 origin 恒为回环地址，
 *   登录态 / Cookie 不再绑定云端域，跨域类问题（文件预览、iframe 场景）从根上消失。
 * - 云端方向注入与 nuwaclaw 主进程 webRequest 同语义的两件事：
 *   x-client-type（FR-03：后端仅凭该头在登录响应返回 token）与缺失时的
 *   Bearer 代注（iframe 导航 / raw fetch 带不了 Authorization）。
 *   网关发出的请求不经 Electron session，与 main.ts 的 onBeforeSendHeaders
 *   钩子（遇 localhost origin 本就跳过）天然不会重复注入。
 * - Set-Cookie 规整：剥 Domain/Secure、SameSite=None→Lax——origin 已是
 *   http://127.0.0.1，这些属性反而会导致 Cookie 被浏览器丢弃。
 * - WebSocket 透传（终端 websockify、远程电脑 noVNC 等）：上游 101 后
 *   回写原始握手响应并双向 pipe，任一侧断开级联销毁对端（防半开连接）。
 *
 * 端口：默认固定 46800（与 nuwax-desktop 原型的 46801 错开，双客户端可共存）；
 * 被占用时回退随机端口并告警（origin 不稳的会话 token 仍按实际 origin 落键，
 * 仅丢失「跨会话续接」，属可接受降级）。
 */
import http from "node:http";
import https from "node:https";
import log from "electron-log";

/** 逐跳头：转发时剥掉，由本层连接语义自行决定。 */
const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

export interface LoopbackGatewayOptions {
  /** 反代目标 origin（如 https://agent.nuwax.com；dev 联调为 http://localhost:3000）。 */
  targetOrigin: string;
  /** 固定端口（origin 稳定的关键）；缺省 46800。占用时回退随机端口。 */
  fixedPort?: number;
  /** 登录态出站注入源：页面带不了 Authorization 的请求（iframe 导航 / raw fetch）
   *  由网关代补 Bearer。返回空值则不注入。 */
  getAccessToken: () => string | null;
  /** 云端方向注入的客户端标识头值；空串显式关闭。缺省 "nuwaclaw"。 */
  clientTypeHeader?: string | null;
}

export interface LoopbackGatewayHandle {
  port: number;
  origin: string;
  close(): Promise<void>;
}

/** 反代注入上下文：登录态 Bearer 与客户端标识头。 */
interface ProxyContext {
  getAccessToken: () => string | null;
  clientTypeHeader: string | null;
}

/** Set-Cookie 规整：剥 Domain/Secure、SameSite=None→Lax（origin 是回环 http）。 */
function normalizeSetCookie(cookie: string): string {
  const segments = cookie
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);
  if (segments.length === 0) return cookie;
  const [pair, ...attrs] = segments;
  const kept = attrs
    .filter((attr) => {
      const lower = attr.toLowerCase();
      return !lower.startsWith("domain=") && lower !== "secure";
    })
    .map((attr) => {
      const eq = attr.indexOf("=");
      const key = eq === -1 ? attr : attr.slice(0, eq);
      const value = eq === -1 ? "" : attr.slice(eq + 1);
      if (
        key.toLowerCase() === "samesite" &&
        value.trim().toLowerCase() === "none"
      ) {
        return "SameSite=Lax";
      }
      return attr;
    });
  return [pair, ...kept].join("; ");
}

/** 组装转发请求头：剥逐跳头、host/origin/referer 改写指向目标、按需注入 Bearer 与客户端标识。 */
function buildProxyHeaders(
  req: http.IncomingMessage,
  target: URL,
  ctx: ProxyContext,
): Record<string, string | string[]> {
  const headers: Record<string, string | string[]> = {};
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined || HOP_BY_HOP.has(key.toLowerCase())) continue;
    headers[key] = value;
  }
  headers["host"] = target.host;
  // 后端可能有 Referer/Origin 校验：统一改写为后端自身，避免把 127.0.0.1 漏过去。
  // referer 保留原路径只换 origin（页面在后站的同一路径），比指向请求自身更忠实。
  if (headers["origin"] !== undefined) headers["origin"] = target.origin;
  if (headers["referer"] !== undefined) {
    try {
      const ref = new URL(String(headers["referer"]));
      headers["referer"] = `${target.origin}${ref.pathname}${ref.search}`;
    } catch {
      delete headers["referer"];
    }
  }
  // 客户端标识头（FR-03 登录链路）：后端仅凭 x-client-type 才在登录响应返回 token。
  if (ctx.clientTypeHeader) headers["x-client-type"] = ctx.clientTypeHeader;
  // 登录态注入：页面自身的 Bearer 请求已带头，只在缺失时补，不覆盖。
  if (headers["authorization"] === undefined) {
    const token = ctx.getAccessToken();
    if (token) headers["authorization"] = `Bearer ${token}`;
  }
  return headers;
}

/** 原始管道反代：请求头经 buildProxyHeaders 转发，响应逐字回传（Set-Cookie 规整除外）。
 *  SSE（text/event-stream）与普通响应同路直通：不设 timeout、不缓冲，data 到即转发。 */
function proxyRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  target: URL,
  ctx: ProxyContext,
): void {
  const headers = buildProxyHeaders(req, target, ctx);
  const transport = target.protocol === "https:" ? https : http;
  const upstream = transport.request(
    {
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port || (target.protocol === "https:" ? 443 : 80),
      method: req.method,
      path: req.url,
      headers,
    },
    (upstreamRes) => {
      const outHeaders: Record<string, string | string[]> = {};
      for (const [key, value] of Object.entries(upstreamRes.headers)) {
        if (value === undefined || HOP_BY_HOP.has(key.toLowerCase())) continue;
        outHeaders[key] = value;
      }
      if (Array.isArray(outHeaders["set-cookie"])) {
        outHeaders["set-cookie"] = (outHeaders["set-cookie"] as string[]).map(
          normalizeSetCookie,
        );
      }
      res.writeHead(upstreamRes.statusCode ?? 502, outHeaders);
      upstreamRes.pipe(res);
      res.on("close", () => upstreamRes.destroy());
    },
  );
  upstream.on("error", (err) => {
    if (!res.headersSent) {
      res.writeHead(502, { "content-type": "application/json; charset=utf-8" });
    }
    res.end(
      JSON.stringify({
        error: "bad gateway",
        detail: String(err?.message ?? err),
      }),
    );
  });
  req.pipe(upstream);
}

/**
 * WebSocket 反代（终端 websockify、远程电脑 noVNC 预览等）：
 * 上游 101 后回写原始握手响应并双向 pipe；上游拒绝升级时原样回写状态行与头
 * 再断开；任一侧断开级联销毁对端——pipe 只传播 end 不传播 destroy，
 * 不显式销毁会累积半开连接（客户端关 VNC 查看器后上游连接须随之关闭）。
 */
function proxyUpgrade(
  req: http.IncomingMessage,
  socket: import("node:stream").Duplex,
  head: Buffer,
  target: URL,
  ctx: ProxyContext,
): void {
  socket.on("error", () => socket.destroy());
  const headers = buildProxyHeaders(req, target, ctx);
  headers["connection"] = "Upgrade";
  headers["upgrade"] =
    (req.headers["upgrade"] as string | undefined) || "websocket";

  const transport = target.protocol === "https:" ? https : http;
  const upstream = transport.request({
    protocol: target.protocol,
    hostname: target.hostname,
    port: target.port || (target.protocol === "https:" ? 443 : 80),
    method: "GET",
    path: req.url,
    headers,
  });
  const writeRawHead = (
    statusCode: number,
    statusMessage: string,
    rawHeaders: http.IncomingHttpHeaders,
  ): string => {
    let out = `HTTP/1.1 ${statusCode} ${statusMessage}\r\n`;
    for (const [key, value] of Object.entries(rawHeaders)) {
      if (value === undefined) continue;
      out += `${key}: ${Array.isArray(value) ? value.join(", ") : value}\r\n`;
    }
    return `${out}\r\n`;
  };
  upstream.on("upgrade", (upstreamRes, upstreamSocket, upstreamHead) => {
    upstreamSocket.on("error", () => socket.destroy());
    socket.write(
      writeRawHead(
        upstreamRes.statusCode ?? 101,
        upstreamRes.statusMessage ?? "Switching Protocols",
        upstreamRes.headers,
      ),
    );
    if (upstreamHead?.length) socket.write(upstreamHead);
    upstreamSocket.pipe(socket);
    socket.pipe(upstreamSocket);
    // pipe 只传播 end 不传播 destroy：任一侧断开时显式级联销毁对端，防半开
    // 连接累积（客户端关 VNC 查看器后上游 websockify 连接须随之关闭）。
    // 客户端优雅断开（FIN）只触发 'end'，abort（RST）走 'close'/'error'——
    // 三者都挂，任一到达即视为断开。
    const killUpstream = () => upstreamSocket.destroy();
    socket.on("end", killUpstream);
    socket.on("close", killUpstream);
    const killClient = () => socket.destroy();
    upstreamSocket.on("end", killClient);
    upstreamSocket.on("close", killClient);
  });
  upstream.on("response", (upstreamRes) => {
    // 上游拒绝升级：回写拒绝响应（浏览器 WS 报握手失败时可见真实状态码）。
    socket.end(
      writeRawHead(
        upstreamRes.statusCode ?? 502,
        upstreamRes.statusMessage ?? "",
        upstreamRes.headers,
      ),
    );
    upstreamRes.resume();
  });
  upstream.on("error", () => socket.destroy());
  upstream.end(head);
}

/** 起网关：全站透明反代（无本地路由表——阶段一目标 origin 即 nuwax 站点本体）。 */
export async function startLoopbackGateway(
  opts: LoopbackGatewayOptions,
): Promise<LoopbackGatewayHandle> {
  const target = new URL(opts.targetOrigin);
  const ctx: ProxyContext = {
    getAccessToken: opts.getAccessToken,
    clientTypeHeader: opts.clientTypeHeader ?? "nuwaclaw",
  };

  return await new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      proxyRequest(req, res, target, ctx);
    });
    server.on("upgrade", (req, socket, head) => {
      proxyUpgrade(req, socket, head, target, ctx);
    });

    const fixedPort = opts.fixedPort ?? 46800;
    const listen = (port: number, isFallback: boolean): void => {
      server.listen(port, "127.0.0.1", () => {
        const actual =
          (server.address() as { port: number } | null)?.port ?? port;
        const origin = `http://127.0.0.1:${actual}`;
        if (isFallback) {
          log.warn(
            `[LoopbackGateway] 固定端口 ${fixedPort} 被占用，回退随机端口 ${actual}——本次会话登录态不与既往续接`,
          );
        }
        log.info(`[LoopbackGateway] listening ${origin} → ${target.origin}`);
        resolve({
          port: actual,
          origin,
          close: () =>
            new Promise<void>((done) => {
              server.close(() => done());
              server.closeAllConnections?.();
            }),
        });
      });
    };
    server.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "EADDRINUSE" && !server.listening) {
        listen(0, true);
        return;
      }
      log.warn("[LoopbackGateway] listen failed:", err.message);
      // 其余错误同样回退随机端口，网关不可用不应阻断客户端启动（direct 形态仍在）。
      if (!server.listening) listen(0, true);
    });
    listen(fixedPort, false);
  });
}
