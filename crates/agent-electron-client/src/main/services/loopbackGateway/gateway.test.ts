/**
 * 单元测试: Loopback Gateway（全站透明反代核心）
 *
 * 覆盖（断言口径移植自 nuwax-desktop 原型的离线验证）:
 * 1. 透明透传：方法/路径/请求体/SSE 流式
 * 2. Bearer 代注：缺失补、已有不覆盖
 * 3. x-client-type 注入与关闭
 * 4. Set-Cookie 规整：剥 Domain/Secure、SameSite=None→Lax
 * 5. WS 101 透传 + close 级联销毁；上游拒绝升级回写状态码
 * 6. host/origin/referer 改写指向目标
 * 7. 固定端口被占用回退随机端口
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import http from "node:http";
import net from "node:net";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

vi.mock("electron-log", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { startLoopbackGateway } from "./gateway";

const openServers: (http.Server | net.Server)[] = [];

/** 起一个回显上游：记录收到的请求，按 route 回应；跟踪底层连接防 close 挂起。 */
function startUpstream(
  handler: (
    req: http.IncomingMessage,
    res: http.ServerResponse,
    captured: Record<string, unknown>,
  ) => void,
): Promise<{
  server: http.Server;
  origin: string;
  captured: Record<string, unknown>;
}> {
  const captured: Record<string, unknown> = {};
  const server = http.createServer((req, res) => handler(req, res, captured));
  const conns = new Set<net.Socket>();
  server.on("connection", (sock: net.Socket) => {
    conns.add(sock);
    sock.on("close", () => conns.delete(sock));
  });
  (server as unknown as { __conns: Set<net.Socket> }).__conns = conns;
  openServers.push(server);
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as { port: number };
      resolve({ server, origin: `http://127.0.0.1:${addr.port}`, captured });
    });
  });
}

/** 简易 WS 客户端：完成握手并收发原始帧。 */
function wsHandshake(
  port: number,
  path: string,
  headers: Record<string, string> = {},
): Promise<{ sock: net.Socket; statusLine: string; responseHeaders: string }> {
  return new Promise((resolve, reject) => {
    const sock = net.connect(port, "127.0.0.1");
    const key = "dGhlIHNhbXBsZSBub25jZQ==";
    sock.write(
      `GET ${path} HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n` +
        Object.entries(headers)
          .map(([k, v]) => `${k}: ${v}`)
          .join("\r\n") +
        "\r\n\r\n",
    );
    let buf = "";
    const timer = setTimeout(
      () => reject(new Error("ws handshake timeout")),
      3000,
    );
    sock.on("data", (chunk: Buffer) => {
      buf += chunk.toString("latin1");
      const idx = buf.indexOf("\r\n\r\n");
      if (idx === -1) return;
      clearTimeout(timer);
      resolve({
        sock,
        statusLine: buf.slice(0, buf.indexOf("\r\n")),
        responseHeaders: buf.slice(0, idx),
      });
    });
    sock.on("error", reject);
  });
}

const gateways: { close(): Promise<void> }[] = [];

afterEach(async () => {
  for (const g of gateways.splice(0)) await g.close();
  for (const s of openServers.splice(0)) {
    // WS 升级产生的裸 socket 不归 http server close 管：显式销毁防挂起
    const conns = (s as unknown as { __conns?: Set<net.Socket> }).__conns;
    conns?.forEach((sock) => sock.destroy());
    await new Promise<void>((d) => s.close(() => d()));
  }
});

describe("loopback gateway（透明反代）", () => {
  it("全站透传：方法/路径/请求体原样到达上游", async () => {
    const up = await startUpstream((req, res, cap) => {
      cap.method = req.method;
      cap.url = req.url;
      cap.host = req.headers.host;
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => chunks.push(c));
      req.on("end", () => {
        cap.body = Buffer.concat(chunks).toString();
        res.writeHead(200, { "content-type": "text/plain" });
        res.end("pong");
      });
    });
    const gw = await startLoopbackGateway({
      targetOrigin: up.origin,
      getAccessToken: () => null,
      clientTypeHeader: "",
    });
    gateways.push(gw);
    const resp = await fetch(`${gw.origin}/api/ping?q=1`, {
      method: "POST",
      body: "ping",
    });
    expect(resp.status).toBe(200);
    expect(await resp.text()).toBe("pong");
    expect(up.captured.method).toBe("POST");
    expect(up.captured.url).toBe("/api/ping?q=1");
    expect(up.captured.body).toBe("ping");
  });

  it("host/origin/referer 改写指向目标", async () => {
    const up = await startUpstream((req, res, cap) => {
      cap.origin = req.headers.origin;
      cap.referer = req.headers.referer;
      res.writeHead(204).end();
    });
    const gw = await startLoopbackGateway({
      targetOrigin: up.origin,
      getAccessToken: () => null,
      clientTypeHeader: "",
    });
    gateways.push(gw);
    await fetch(`${gw.origin}/x`, {
      headers: { origin: gw.origin, referer: `${gw.origin}/y` },
    });
    expect(up.captured.origin).toBe(up.origin);
    expect(up.captured.referer).toBe(`${up.origin}/y`);
  });

  it("Bearer 代注：缺失补、已有不覆盖", async () => {
    const up = await startUpstream((req, res, cap) => {
      cap.auth = req.headers.authorization;
      res.writeHead(204).end();
    });
    const gw = await startLoopbackGateway({
      targetOrigin: up.origin,
      getAccessToken: () => "TOKEN-A",
      clientTypeHeader: "",
    });
    gateways.push(gw);
    await fetch(`${gw.origin}/a`);
    expect(up.captured.auth).toBe("Bearer TOKEN-A");
    await fetch(`${gw.origin}/b`, {
      headers: { authorization: "Bearer SELF" },
    });
    expect(up.captured.auth).toBe("Bearer SELF");
  });

  it("x-client-type：缺省 nuwaclaw，空串关闭", async () => {
    const up = await startUpstream((req, res, cap) => {
      cap.xct = req.headers["x-client-type"];
      res.writeHead(204).end();
    });
    const gw1 = await startLoopbackGateway({
      targetOrigin: up.origin,
      getAccessToken: () => null,
    });
    gateways.push(gw1);
    await fetch(`${gw1.origin}/a`);
    expect(up.captured.xct).toBe("nuwaclaw");

    const gw2 = await startLoopbackGateway({
      targetOrigin: up.origin,
      getAccessToken: () => null,
      clientTypeHeader: "",
    });
    gateways.push(gw2);
    await fetch(`${gw2.origin}/b`);
    expect(up.captured.xct).toBeUndefined();
  });

  it("Set-Cookie 规整：剥 Domain/Secure、SameSite=None→Lax", async () => {
    const up = await startUpstream((_req, res) => {
      res.writeHead(200, {
        "set-cookie": [
          "a=1; Domain=agent.nuwax.com; Secure; SameSite=None; Path=/",
          "b=2; HttpOnly; Path=/",
        ],
      });
      res.end();
    });
    const gw = await startLoopbackGateway({
      targetOrigin: up.origin,
      getAccessToken: () => null,
      clientTypeHeader: "",
    });
    gateways.push(gw);
    const resp = await fetch(`${gw.origin}/c`);
    const cookies = resp.headers.getSetCookie();
    expect(cookies[0]).toBe("a=1; SameSite=Lax; Path=/");
    expect(cookies[1]).toBe("b=2; HttpOnly; Path=/");
  });

  it("SSE 流式直通（分块到即转发，不缓冲）", async () => {
    const up = await startUpstream((_req, res) => {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write("data: 1\n\n");
      setTimeout(() => {
        res.write("data: 2\n\n");
        res.end();
      }, 60);
    });
    const gw = await startLoopbackGateway({
      targetOrigin: up.origin,
      getAccessToken: () => null,
      clientTypeHeader: "",
    });
    gateways.push(gw);
    const resp = await fetch(`${gw.origin}/sse`);
    expect(resp.headers.get("content-type")).toBe("text/event-stream");
    const first = await resp.body!.getReader().read();
    expect(new TextDecoder().decode(first.value)).toContain("data: 1");
  });

  it("WS 101 透传 + close 级联：客户端断开后上游连接随之关闭", async () => {
    let upstreamClosed = false;
    const up = await startUpstream(() => undefined);
    up.server.on("upgrade", (_req, socket) => {
      // 客户端断开 → 网关级联 destroy 上游连接：表现为 end（优雅 FIN）或 close（RST）
      socket.on("close", () => {
        upstreamClosed = true;
      });
      socket.on("end", () => {
        upstreamClosed = true;
      });
      socket.write(
        "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: s3pPLMBiTxaQ9kYGzzhZRbK+xOo=\r\n\r\n",
      );
      socket.on("data", () => socket.write("echo"));
    });
    const gw = await startLoopbackGateway({
      targetOrigin: up.origin,
      getAccessToken: () => null,
      clientTypeHeader: "",
    });
    gateways.push(gw);
    const { sock, statusLine } = await wsHandshake(gw.port, "/ws");
    expect(statusLine).toContain("101");
    // 模拟浏览器中断查看器（abortive close，非优雅 end）：级联销毁上游
    sock.destroy();
    await new Promise((r) => setTimeout(r, 150));
    expect(upstreamClosed).toBe(true);
  });

  it("上游拒绝升级：回写真实状态码", async () => {
    const up = await startUpstream(() => undefined);
    up.server.on("upgrade", (_req, socket) => {
      socket.end("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
    });
    const gw = await startLoopbackGateway({
      targetOrigin: up.origin,
      getAccessToken: () => null,
      clientTypeHeader: "",
    });
    gateways.push(gw);
    const { statusLine } = await wsHandshake(gw.port, "/ws-denied");
    expect(statusLine).toContain("401");
  });

  it("固定端口被占用：回退随机端口", async () => {
    const up = await startUpstream((_req, res) => {
      res.writeHead(204).end();
    });
    const gw1 = await startLoopbackGateway({
      targetOrigin: up.origin,
      fixedPort: 0, // 让系统随机分配一个作为「被占用」的固定口
      getAccessToken: () => null,
      clientTypeHeader: "",
    });
    gateways.push(gw1);
    const gw2 = await startLoopbackGateway({
      targetOrigin: up.origin,
      fixedPort: gw1.port,
      getAccessToken: () => null,
      clientTypeHeader: "",
    });
    gateways.push(gw2);
    expect(gw2.port).not.toBe(gw1.port);
    expect(gw2.port).toBeGreaterThan(0);
  });

  it("dist 模式：本地静态托管 + SPA 回退 + 后端前缀反代", async () => {
    const up = await startUpstream((req, res, cap) => {
      cap.apiPath = req.url;
      cap.auth = req.headers.authorization;
      res.writeHead(200, { "content-type": "application/json" });
      res.end('{"code":0}');
    });
    const distDir = fs.mkdtempSync(path.join(os.tmpdir(), "gw-dist-"));
    fs.writeFileSync(path.join(distDir, "index.html"), "<html>HOME</html>");
    fs.mkdirSync(path.join(distDir, "static"));
    fs.writeFileSync(
      path.join(distDir, "static", "a.880437de.js"),
      "console.log(1)",
    );
    const gw = await startLoopbackGateway({
      targetOrigin: up.origin,
      distDir,
      getAccessToken: () => "TK",
      clientTypeHeader: "nuwaclaw",
    });
    gateways.push(gw);
    expect(gw.mode).toBe("dist");
    // 静态：首页 no-cache；带 hash 资源长缓存
    const home = await fetch(`${gw.origin}/`);
    expect(await home.text()).toContain("HOME");
    expect(home.headers.get("cache-control")).toBe("no-cache");
    const asset = await fetch(`${gw.origin}/static/a.880437de.js`);
    expect(asset.headers.get("cache-control")).toContain("immutable");
    // SPA 深链回 index.html；带扩展名未命中 404
    const deep = await fetch(`${gw.origin}/home/chat/1/2`);
    expect(await deep.text()).toContain("HOME");
    const missing = await fetch(`${gw.origin}/nope.xyz`);
    expect(missing.status).toBe(404);
    // 后端前缀反代：/api 与 /computer 走上游并注入 Bearer
    const api = await fetch(`${gw.origin}/api/user/info`);
    expect(await api.json()).toEqual({ code: 0 });
    expect(up.captured.apiPath).toBe("/api/user/info");
    expect(up.captured.auth).toBe("Bearer TK");
    await fetch(`${gw.origin}/computer/terminal/x/ws`);
    expect(up.captured.apiPath).toBe("/computer/terminal/x/ws");
    // 路径穿越拒绝
    const escape = await fetch(`${gw.origin}/..%2f..%2fetc%2fpasswd`);
    expect([403, 404]).toContain(escape.status);
    fs.rmSync(distDir, { recursive: true, force: true });
  });
});
