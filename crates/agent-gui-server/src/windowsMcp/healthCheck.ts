/**
 * Windows-MCP 健康检查
 *
 * 通过 HTTP 请求检查 windows-mcp 服务是否就绪。
 */

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

/**
 * 执行健康检查
 *
 * 通过发送 MCP initialize 请求检查服务是否就绪。
 */
export async function healthCheck(options: HealthCheckOptions): Promise<HealthCheckResult> {
  const { port, timeout = 5000, endpoint = '/mcp' } = options;
  const url = `http://127.0.0.1:${port}${endpoint}`;

  const startTime = Date.now();

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: {
            name: 'windows-mcp-health-check',
            version: '1.0.0',
          },
        },
        id: 1,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);
    const responseTime = Date.now() - startTime;

    if (response.ok) {
      // 验证响应是否为有效的 MCP 响应
      const data = await response.json();
      if (data.jsonrpc === '2.0' && data.id === 1) {
        return { healthy: true, responseTime };
      }
      return { healthy: false, error: 'Invalid MCP response', responseTime };
    }

    return { healthy: false, error: `HTTP ${response.status}`, responseTime };
  } catch (error) {
    const responseTime = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : String(error);

    if (errorMessage.includes('abort')) {
      return { healthy: false, error: 'Timeout', responseTime };
    }

    return { healthy: false, error: errorMessage, responseTime };
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
  }
): Promise<boolean> {
  const { timeout = 30000, interval = 500, requestTimeout = 5000 } = options || {};
  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    const result = await healthCheck({ port, timeout: requestTimeout });
    if (result.healthy) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, interval));
  }

  return false;
}
