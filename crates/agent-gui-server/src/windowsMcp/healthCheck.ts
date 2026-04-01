/**
 * Windows-MCP 健康检查
 *
 * 使用官方 MCP SDK（Streamable HTTP Transport + Client）完成 initialize 握手，
 * 并调用 listTools() 确认服务真正可用，与 nuwax-mcp-stdio-proxy 针对 HTTP MCP 的判定方式一致。
 *
 * 注意：StreamableHTTPClientTransport 在 send() 里会用内部 AbortController 的 signal 覆盖
 * requestInit.signal，因此超时必须外层 Promise.race，并在 finally 里 client.close() 以 abort 传输层。
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

/** 健康检查选项 */
export interface HealthCheckOptions {
  /** 端口号 */
  port: number;
  /** 超时时间（毫秒），默认 5000 */
  timeout?: number;
  /** MCP 端点路径，默认 '/mcp' */
  endpoint?: string;
}

/** 健康检查结果 */
export interface HealthCheckResult {
  /** 是否健康 */
  healthy: boolean;
  /** 响应时间（毫秒） */
  responseTime?: number;
  /** 错误信息 */
  error?: string;
}

async function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout>;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(message)), ms);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    clearTimeout(timeoutId!);
  }
}

/**
 * 执行健康检查
 *
 * 通过 SDK 建立 MCP 会话并 listTools，避免手写 fetch 解析 SSE/NDJSON。
 */
export async function healthCheck(options: HealthCheckOptions): Promise<HealthCheckResult> {
  const { port, timeout = 5000, endpoint = '/mcp' } = options;
  const url = new URL(`http://127.0.0.1:${port}${endpoint}`);
  const startTime = Date.now();

  const client = new Client({
    name: 'windows-mcp-health-check',
    version: '1.0.0',
  });

  try {
    await withTimeout(
      (async () => {
        const transport = new StreamableHTTPClientTransport(url, {
          requestInit: {
            headers: {
              Accept: 'application/json, text/event-stream',
            },
          },
        });
        await client.connect(transport);
        await client.listTools();
      })(),
      timeout,
      'Timeout'
    );

    return { healthy: true, responseTime: Date.now() - startTime };
  } catch (error) {
    const responseTime = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : String(error);

    if (errorMessage === 'Timeout') {
      return { healthy: false, error: 'Timeout', responseTime };
    }

    return { healthy: false, error: errorMessage, responseTime };
  } finally {
    try {
      await client.close();
    } catch {
      /* ignore */
    }
  }
}

/**
 * 等待服务就绪
 *
 * 多次尝试健康检查，直到服务就绪或超时。
 */
export async function waitForReady(
  port: number,
  options?: {
    /** 总超时时间（毫秒），默认 30000 */
    timeout?: number;
    /** 每次检查间隔（毫秒），默认 500 */
    interval?: number;
    /** 单次请求超时（毫秒），默认 5000 */
    requestTimeout?: number;
    /** MCP 端点路径，默认 '/mcp' */
    endpoint?: string;
  }
): Promise<boolean> {
  const { timeout = 30000, interval = 500, requestTimeout = 5000, endpoint } = options || {};
  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    const result = await healthCheck({ port, timeout: requestTimeout, endpoint });
    if (result.healthy) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, interval));
  }

  return false;
}
