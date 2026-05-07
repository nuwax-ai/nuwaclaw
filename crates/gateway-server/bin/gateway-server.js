#!/usr/bin/env node
/**
 * NuwaClaw Gateway Server 入口
 *
 * 参考 OpenClaw Gateway server.impl.ts 的模块化设计：
 * - 单一 HTTP server，多插件路由分发
 * - chat2response 作为第一个插件（通过 handler 拦截集成）
 * - 未来服务通过注册新插件挂载
 *
 * 环境变量：
 * - GATEWAY_PORT: 监听端口（默认 60009）
 * - GATEWAY_RESOURCES_DIR: bundled 资源目录
 */

import { createGatewayServer } from "../lib/server.js";
import { PluginRegistry } from "../lib/plugin.js";
import { createChat2responsePlugin } from "../lib/plugins/chat2response.js";

const argv = process.argv.slice(2);
const isHelpMode = argv.includes("--help") || argv.includes("-h");

if (isHelpMode) {
  console.log(`gateway-server (NuwaClaw)

Usage:
  gateway-server

Environment:
  GATEWAY_PORT          Port to listen on (default: 60009)
  GATEWAY_RESOURCES_DIR Path to bundled resources directory

Notes:
  - Gateway routes multiple services through a single HTTP port.
  - chat2response is mounted at /chat2response/v1/*.
  - Health check: GET /health
`);
  process.exit(0);
}

const port = parseInt(process.env.GATEWAY_PORT || "60009", 10);
const resourcesDir = process.env.GATEWAY_RESOURCES_DIR || "";

const registry = new PluginRegistry();

registry.register(createChat2responsePlugin());

try {
  await registry.startAll({ resourcesDir, env: { ...process.env } });
} catch (err) {
  console.error("[Gateway] Plugin startup failed:", err);
  process.exit(1);
}

const server = createGatewayServer(registry);

server.on("error", (err) => {
  console.error("[Gateway] Server error:", err);
  process.exit(1);
});

server.listen(port, "127.0.0.1", () => {
  console.log(`[Gateway] Listening on 127.0.0.1:${port}`);

  const plugins = registry.getAll();
  for (const plugin of plugins) {
    const status = plugin.handler ? "active" : "inactive";
    console.log(`[Gateway]   /${plugin.name} → ${status} (prefix: ${plugin.prefix})`);
  }
});

function shutdown() {
  console.log("[Gateway] Shutting down...");
  void registry.stopAll().then(() => {
    server.close();
    process.exit(0);
  });
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
