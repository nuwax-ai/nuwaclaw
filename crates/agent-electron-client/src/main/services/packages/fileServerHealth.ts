import http from "http";
import { LOCALHOST_HOSTNAME } from "../constants";

export interface FileServerHealthResult {
  healthy: boolean;
  error?: string;
}

/**
 * 通过 GET /health 端点检查 file-server 健康状态
 * 非阻塞，5 秒超时
 */
export async function checkFileServerHealth(
  port: number,
): Promise<FileServerHealthResult> {
  return new Promise((resolve) => {
    const req = http.request(
      {
        hostname: LOCALHOST_HOSTNAME,
        port,
        path: "/health",
        method: "GET",
        timeout: 5000,
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
      resolve({ healthy: false, error: "Health check timeout (5s)" });
    });

    req.end();
  });
}
