/**
 * stdio MCP Server 工具发现
 *
 * 使用 MCP SDK（与 PersistentMcpBridge 相同的 Content-Length 协议），
 * 替代手写 spawn + JSON-RPC，避免 chrome-devtools 等现代 MCP 超时。
 */

import { Client } from "@modelcontextprotocol/sdk/client";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { StdioMcpServerEntry } from "./mcp";
import { withTimeout } from "./mcpDiscoverUtils";
import { getBundledMcpProxyDir } from "./packageLocator";

const DEFAULT_DISCOVER_TIMEOUT_MS = 30_000;

type StdioTransport = StdioClientTransport;

function mergeEnv(
  base: NodeJS.ProcessEnv,
  extra?: Record<string, string>,
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(base)) {
    if (value !== undefined) env[key] = value;
  }
  if (extra) Object.assign(env, extra);
  return env;
}

function createStdioTransport(entry: StdioMcpServerEntry): StdioTransport {
  const params = {
    command: entry.command,
    args: entry.args ?? [],
    env: mergeEnv(process.env, entry.env),
    stderr: "pipe" as const,
  };

  const bundledDir = getBundledMcpProxyDir();
  if (bundledDir) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const pkg = require(bundledDir) as {
        CustomStdioClientTransport?: new (
          server: typeof params,
        ) => StdioTransport;
      };
      if (pkg.CustomStdioClientTransport) {
        return new pkg.CustomStdioClientTransport(params);
      }
    } catch {
      // Fall back to SDK transport
    }
  }

  return new StdioClientTransport(params);
}

export async function discoverStdioMcpTools(
  entry: StdioMcpServerEntry,
  opts?: { timeoutMs?: number },
): Promise<string[]> {
  const timeoutMs = opts?.timeoutMs ?? DEFAULT_DISCOVER_TIMEOUT_MS;
  const transport = createStdioTransport(entry);
  const client = new Client({
    name: "nuwaclaw-mcp-discover",
    version: "1.0.0",
  });

  try {
    await withTimeout(client.connect(transport), timeoutMs, "MCP connect");
    const { tools } = await withTimeout(
      client.listTools(),
      timeoutMs,
      "MCP tools/list",
    );
    return (tools ?? [])
      .filter((tool) => tool && typeof tool.name === "string")
      .map((tool) => tool.name);
  } finally {
    try {
      await withTimeout(client.close(), 5_000, "MCP close");
    } catch {
      // 发现流程结束后的 close 失败/超时可忽略
    }
  }
}
