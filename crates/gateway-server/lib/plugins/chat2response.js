/**
 * chat2response 插件 — 通过 http.createServer 拦截捕获 upstream handler
 *
 * 原理：
 * 1. 临时替换 http.createServer 为拦截函数
 * 2. import upstream chat2response 入口（它会调用 http.createServer(handler)）
 * 3. 捕获 handler 并恢复 http.createServer
 * 4. 将 handler 挂载为 Gateway 的 /chat2response/* 路由处理器
 *
 *
 * 适配层（不修改 node_modules）：
 * - 动态注入 "openai" provider，让 chat2response 能用 OPENAI_API_KEY/OPENAI_BASE_URL
 * - 拦截 /v1/responses POST 请求，用 CODEX_MODEL 环境变量覆盖 model 字段
 *   （codex-acp 可能发送上游不认识的默认模型名）
 */

import http from "http";
import { createRequire } from "module";
import { pathToFileURL } from "url";
import path from "path";
import fs from "fs";

const require = createRequire(import.meta.url);

const OPENAI_PROVIDER = {
  name: "OpenAI Compatible",
  baseUrl: process.env.OPENAI_BASE_URL || "https://api.openai.com/v1",
  defaultModel: "gpt-4o",
  models: [],
  supportsTools: true,
  supportsStreaming: true,
  transformRequest: (req) => {
    // Disable thinking/reasoning mode to avoid deepseek-v4-pro
    // reasoning_content passthrough requirement across turns.
    if (!req.thinking) {
      req.thinking = { type: "disabled" };
    }
    return req;
  },
};

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
      let modelOverride = "";
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
        if (process.env.OPENAI_BASE_URL && !process.env.DEFAULT_PROVIDER) {
          process.env.DEFAULT_PROVIDER = "openai";
        }

        const modelOverrideRaw = process.env.CODEX_MODEL || process.env.OPENAI_MODEL || "";
        modelOverride = modelOverrideRaw.replace(/^openai-compatible\//, "");

        await import(pathToFileURL(entryPath).href);

        // 动态注入 openai provider 到 chat2response 的 PROVIDERS 注册表
        if (process.env.OPENAI_BASE_URL) {
          try {
            const providersPath = path.join(path.dirname(entryPath), "providers", "index.js");
            const providers = await import(pathToFileURL(providersPath).href);
            if (providers.PROVIDERS && !providers.PROVIDERS.openai) {
              OPENAI_PROVIDER.baseUrl = process.env.OPENAI_BASE_URL;
              providers.PROVIDERS.openai = OPENAI_PROVIDER;
              console.log("[chat2response plugin] injected openai provider");
            }
          } catch (err) {
            console.warn("[chat2response plugin] failed to inject openai provider:", err.message);
          }
        }
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

      if (modelOverride) {
        const origHandler = capturedHandler;
        capturedHandler = (req, res) => {
          const pathname = new URL(req.url, "http://127.0.0.1").pathname;
          if (req.method === "POST" && (pathname === "/v1/responses" || pathname === "/responses")) {
            const chunks = [];
            req.on("data", (chunk) => chunks.push(chunk));
            req.on("end", () => {
              try {
                const body = JSON.parse(Buffer.concat(chunks).toString());
                body.model = modelOverride;
                origHandler(createParsedBodyRequest(req, body), res);
              } catch (err) {
                res.writeHead(400, { "Content-Type": "application/json" });
                res.end(JSON.stringify({
                  error: {
                    message: err instanceof Error ? err.message : String(err),
                    type: "invalid_request_error",
                  },
                }));
              }
            });
            return;
          }
          origHandler(req, res);
        };
      }

      this.handler = capturedHandler;
      console.log(`[chat2response plugin] upstream handler captured from: ${entryPath}, model override: ${modelOverride || "(none)"}`);
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

/**
 * Create a proxy of the original req with body-parser-compatible parsed body.
 * @param {http.IncomingMessage} origReq
 * @param {object} body
 * @returns {http.IncomingMessage}
 */
function createParsedBodyRequest(origReq, body) {
  return new Proxy(origReq, {
    get(target, prop) {
      if (prop === "body") {
        return body;
      }
      if (prop === "_body") {
        return true;
      }
      if (prop === "headers") {
        const { "content-length": _contentLength, ...headers } = target.headers;
        if (process.env.OPENAI_BASE_URL) {
          headers["x-provider"] = "openai";
        }
        return headers;
      }
      const val = target[prop];
      return typeof val === "function" ? val.bind(target) : val;
    },
    set(target, prop, value) {
      if (prop === "body" || prop === "_body") {
        return true;
      }
      target[prop] = value;
      return true;
    },
  });
}
