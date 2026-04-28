import http from "http";
import { LOCALHOST_HOSTNAME } from "../constants";

export interface Chat2responseHealthResult {
  healthy: boolean;
  error?: string;
}

/**
 * chat2response 健康检查。
 * 仓库文档定义了 /health 端点，成功时返回 200。
 */
export async function checkChat2responseHealth(
  port: number,
): Promise<Chat2responseHealthResult> {
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
        if (res.statusCode === 200) {
          resolve({ healthy: true });
        } else {
          resolve({ healthy: false, error: `HTTP ${res.statusCode}` });
        }
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
