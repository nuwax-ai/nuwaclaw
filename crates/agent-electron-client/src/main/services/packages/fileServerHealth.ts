import http from "http";
import { LOCALHOST_HOSTNAME } from "../constants";

export interface FileServerHealthResult {
  healthy: boolean;
  error?: string;
}

/**
 * 通过 GET /health 端点检查 file-server 健康状态（单次探测）。
 * @param port file-server 监听端口
 * @param requestTimeoutMs 单次 HTTP 请求超时（默认 5s；轮询场景可缩短）
 */
export async function checkFileServerHealth(
  port: number,
  requestTimeoutMs = 5000,
): Promise<FileServerHealthResult> {
  return new Promise((resolve) => {
    const req = http.request(
      {
        hostname: LOCALHOST_HOSTNAME,
        port,
        path: "/health",
        method: "GET",
        timeout: requestTimeoutMs,
      },
      (res) => {
        let body = "";
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => {
          if (res.statusCode === 200) {
            try {
              const data = JSON.parse(body);
              if (data.status === "ok") {
                resolve({ healthy: true });
              } else {
                resolve({
                  healthy: false,
                  error: `Unexpected status: ${data.status}`,
                });
              }
            } catch (e) {
              resolve({
                healthy: false,
                error: `Invalid JSON response: ${e}`,
              });
            }
          } else {
            resolve({
              healthy: false,
              error: `HTTP ${res.statusCode}`,
            });
          }
        });
      },
    );

    req.on("error", (err) => {
      resolve({ healthy: false, error: err.message });
    });

    req.on("timeout", () => {
      req.destroy();
      resolve({
        healthy: false,
        error: `Health check timeout (${requestTimeoutMs}ms)`,
      });
    });

    req.end();
  });
}

/**
 * 轮询 GET /health 直到 file-server 就绪或超时。
 * 默认 20s（对齐 agent-kit DEFAULT_FILE_SERVER_HEALTH_TIMEOUT_MS）；
 * 外层完整启动重试见 @nuwax-ai/agent-kit withStartRetry。
 */
export async function waitForFileServerHealth(
  port: number,
  timeoutMs = 20_000,
  intervalMs = 200,
): Promise<FileServerHealthResult> {
  const deadline = Date.now() + timeoutMs;
  let lastError = "File-server health check timed out";

  while (Date.now() < deadline) {
    // 单次请求超时不超过剩余预算，避免墙钟时间明显超出 timeoutMs
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    const requestTimeoutMs = Math.min(1500, remaining);
    const result = await checkFileServerHealth(port, requestTimeoutMs);
    if (result.healthy) {
      return result;
    }
    lastError = result.error || lastError;
    const after = deadline - Date.now();
    if (after <= 0) break;
    await new Promise((resolve) =>
      setTimeout(resolve, Math.min(intervalMs, after)),
    );
  }

  return { healthy: false, error: lastError };
}
