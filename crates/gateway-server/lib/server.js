/**
 * Gateway HTTP 服务器 + 路由分发
 *
 * 参考 OpenClaw Gateway server.impl.ts 设计：
 * - 单一 http.createServer，所有插件共享
 * - 路径前缀匹配插件 → 剥离前缀后转发给插件 handler
 * - Gateway 自身提供 /health 端点
 */

import http from "http";
import { aggregateHealth } from "./health.js";

/**
 * 创建 Gateway HTTP server
 * @param {import('./plugin.js').PluginRegistry} registry
 * @returns {http.Server}
 */
export function createGatewayServer(registry) {
  return http.createServer((req, res) => {
    try {
      const parsed = new URL(req.url, `http://${req.headers.host || "127.0.0.1"}`);
      const pathname = parsed.pathname;

      if (pathname === "/health") {
        return handleHealth(req, res, registry);
      }

      const plugin = registry.match(pathname);
      if (plugin?.handler) {
        const rewritten = pathname.slice(plugin.prefix.length) || "/";
        req.url = rewritten + (parsed.search || "");
        return plugin.handler(req, res);
      }

      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Not found", path: pathname }));
    } catch (err) {
      console.error("[Gateway] request error:", err);
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Internal server error" }));
      }
    }
  });
}

/**
 * @param {http.IncomingMessage} req
 * @param {http.ServerResponse} res
 * @param {import('./plugin.js').PluginRegistry} registry
 */
async function handleHealth(req, res, registry) {
  try {
    const health = await aggregateHealth(registry);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(health));
  } catch (err) {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ healthy: false, error: err.message }));
  }
}
