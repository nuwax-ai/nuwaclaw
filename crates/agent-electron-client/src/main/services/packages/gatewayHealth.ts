import http from "http";
import { LOCALHOST_HOSTNAME } from "../constants";

export interface GatewayHealthResult {
  healthy: boolean;
  plugins?: Record<string, { healthy: boolean; error?: string }>;
  error?: string;
}

export async function checkGatewayHealth(
  port: number,
): Promise<GatewayHealthResult> {
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
        res.on("data", (chunk: Buffer) => {
          body += chunk.toString();
        });
        res.on("end", () => {
          if (res.statusCode === 200) {
            try {
              const data = JSON.parse(body);
              resolve({
                healthy: data.healthy ?? true,
                plugins: data.plugins,
              });
            } catch {
              resolve({ healthy: true });
            }
          } else {
            resolve({ healthy: false, error: `HTTP ${res.statusCode}` });
          }
        });
      },
    );

    req.on("error", (err) => {
      resolve({ healthy: false, error: err.message });
    });

    req.on("timeout", () => {
      req.destroy();
      resolve({ healthy: false, error: "Gateway health check timeout (5s)" });
    });

    req.end();
  });
}
