/**
 * chat2response 插件 — 通过 http.createServer 拦截捕获 upstream handler
 *
 * 原理：
 * 1. 临时替换 http.createServer 为拦截函数
 * 2. import upstream chat2response 入口（它会调用 http.createServer(handler)）
 * 3. 捕获 handler 并恢复 http.createServer
 * 4. 将 handler 挂载为 Gateway 的 /chat2response/* 路由处理器
 *
 * 这样 chat2response 的 handler 运行在 Gateway 的 HTTP server 内，
 * 不需要额外的端口或子进程。
 */

import http from "http";
import { createRequire } from "module";
import { pathToFileURL } from "url";
import path from "path";
import fs from "fs";

const require = createRequire(import.meta.url);

/**
 * @returns {import('../plugin.js').GatewayPlugin}
 */
export function createChat2responsePlugin() {
  /** @type {((req: http.IncomingMessage, res: http.ServerResponse) => void) | null} */
  let capturedHandler = null;

  return {
    name: "chat2response",
    prefix: "/chat2response",
    handler: null,

    /**
     * @param {import('../plugin.js').PluginContext} context
     */
    async start(context) {
      const resourcesDir = context.resourcesDir;
      let entryPath;

      if (resourcesDir) {
        const bundledPkgPath = path.join(resourcesDir, "node_modules", "chat2response", "package.json");
        if (fs.existsSync(bundledPkgPath)) {
          entryPath = resolveEntryFromPkg(bundledPkgPath);
        }
      }

      if (!entryPath) {
        try {
          const pkgJsonPath = require.resolve("chat2response/package.json");
          entryPath = resolveEntryFromPkg(pkgJsonPath);
        } catch {
          throw new Error("[chat2response plugin] chat2response package not found");
        }
      }

      if (!entryPath || !fs.existsSync(entryPath)) {
        throw new Error(`[chat2response plugin] entry not found: ${entryPath}`);
      }

      const origCreateServer = http.createServer;
      let captured = false;

      const noop = () => proxy;
      const proxy = new Proxy(noop, {
        get(target, prop) {
          if (prop === "address") return () => ({ port: 0, family: "IPv4", address: "127.0.0.1" });
          if (prop === "listening") return false;
          if (typeof prop === "string") return noop;
          return undefined;
        },
      });

      http.createServer = (handlerOrOpts, maybeHandler) => {
        const actualHandler =
          typeof handlerOrOpts === "function" ? handlerOrOpts : maybeHandler;
        if (actualHandler && !captured) {
          capturedHandler = actualHandler;
          captured = true;
        }
        return proxy;
      };

      const envKeysToRestore = new Set(["PORT", "CHAT2RESPONSE_PORT"]);
      const savedEnv = {};
      for (const key of envKeysToRestore) {
        savedEnv[key] = process.env[key];
      }
      try {
        if (context.env) {
          for (const [k, v] of Object.entries(context.env)) {
            if (v !== undefined) {
              process.env[k] = v;
            }
          }
        }
        process.env.PORT = "0";
        process.env.CHAT2RESPONSE_PORT = "0";

        await import(pathToFileURL(entryPath).href);
      } finally {
        http.createServer = origCreateServer;
        for (const key of envKeysToRestore) {
          if (savedEnv[key] === undefined) {
            delete process.env[key];
          } else {
            process.env[key] = savedEnv[key];
          }
        }
      }

      if (!capturedHandler) {
        throw new Error("[chat2response plugin] failed to capture upstream handler from http.createServer");
      }

      this.handler = capturedHandler;
      console.log(`[chat2response plugin] upstream handler captured from: ${entryPath}`);
    },

    async stop() {
      capturedHandler = null;
      this.handler = null;
    },

    async healthCheck() {
      return { healthy: !!this.handler };
    },
  };
}

/**
 * @param {string} pkgJsonPath
 * @returns {string}
 */
function resolveEntryFromPkg(pkgJsonPath) {
  const pkgDir = path.dirname(pkgJsonPath);
  const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, "utf-8"));
  const binField = pkg.bin;
  let relEntry = "";
  if (typeof binField === "string") {
    relEntry = binField;
  } else if (binField && typeof binField === "object") {
    relEntry = binField.chat2response || Object.values(binField)[0] || "";
  }
  if (!relEntry && typeof pkg.main === "string") {
    relEntry = pkg.main;
  }
  if (!relEntry) {
    relEntry = "index.js";
  }
  return path.join(pkgDir, relEntry);
}
