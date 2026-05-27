/**
 * 远程 MCP Server（Streamable HTTP / SSE）工具发现
 *
 * 用于 MCP 设置页的「测试」按钮：连接远程端点并调用 listTools。
 */

import { Client } from "@modelcontextprotocol/sdk/client";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import type { RemoteMcpServerEntry } from "./mcp";

const DEFAULT_DISCOVER_TIMEOUT_MS = 30_000;

function buildRequestHeaders(
  entry: RemoteMcpServerEntry,
): Record<string, string> | undefined {
  const headers: Record<string, string> = { ...(entry.headers ?? {}) };
  if (entry.authToken) {
    headers.Authorization = `Bearer ${entry.authToken}`;
  }
  return Object.keys(headers).length > 0 ? headers : undefined;
}

function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${ms}ms`));
    }, ms);
    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}

/**
 * 连接远程 MCP 并返回工具名称列表
 */
function parseRemoteMcpUrl(rawUrl: string): URL {
  const trimmed = rawUrl.trim();
  if (!trimmed) {
    throw new Error("MCP URL is empty");
  }
  try {
    return new URL(trimmed);
  } catch {
    throw new Error(`Invalid MCP URL: ${trimmed}`);
  }
}

export async function discoverRemoteMcpTools(
  entry: RemoteMcpServerEntry,
  opts?: { timeoutMs?: number },
): Promise<string[]> {
  const timeoutMs = opts?.timeoutMs ?? DEFAULT_DISCOVER_TIMEOUT_MS;
  const url = parseRemoteMcpUrl(entry.url);
  const headers = buildRequestHeaders(entry);
  const requestInit = headers ? { headers } : undefined;

  const transport =
    entry.transport === "sse"
      ? new SSEClientTransport(url, requestInit ? { requestInit } : undefined)
      : new StreamableHTTPClientTransport(
          url,
          requestInit ? { requestInit } : undefined,
        );

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
