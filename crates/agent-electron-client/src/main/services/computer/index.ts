/**
 * Computer HTTP Server — 生命周期管理 + barrel 导出
 *
 * 在 agentPort（默认 60001）上启动 HTTP 服务器，
 * 将 Java 后端通过 lanproxy 隧道发来的请求路由到 AcpEngine。
 * Admin 接口（/admin/*）与主路由共用同一端口。
 */

import * as http from "http";
import log from "electron-log";
import { LOCALHOST_HOSTNAME } from "../constants";
import { getConfiguredPorts } from "../startupPorts";
import { killProcessTreesListeningOnTcpPort } from "../utils/processTree";
import { getOrCreateInternalSecret } from "../intervention";
import { serverState } from "./state";
import { handleRequest } from "./router";
import { handleAdminRequest } from "./adminServer";
import { closeAndClearAllSseClients } from "./sseManager";

// ==================== 请求分发器 ====================

async function requestDispatcher(
  req: http.IncomingMessage,
  res: http.ServerResponse,
) {
  const pathname = new URL(
    req.url || "/",
    `http://${req.headers.host || LOCALHOST_HOSTNAME}`,
  ).pathname;
  // /admin/* 路由到 admin handler；但 OPTIONS 预检仍交给 handleRequest 统一返回 204
  // （对齐原 computerServer：OPTIONS 在 admin 分发之前处理，否则 admin 预检会落到 404）
  if (
    pathname.startsWith("/admin/") &&
    req.method?.toUpperCase() !== "OPTIONS"
  ) {
    return handleAdminRequest(req, res);
  }
  return handleRequest(req, res);
}

// ==================== Lifecycle ====================

export async function startComputerServer(
  port: number,
): Promise<{ success: boolean; error?: string }> {
  if (!serverState.server) {
    try {
      log.info(`[ComputerServer] Pre-start port sweep for ${port}`);
      await killProcessTreesListeningOnTcpPort(port);
    } catch (error) {
      log.warn("[ComputerServer] Pre-start port sweep failed:", error);
    }
  }

  return new Promise((resolve) => {
    if (serverState.server) {
      serverState.lastError = null;
      resolve({ success: true });
      return;
    }

    serverState.server = http.createServer(requestDispatcher);

    (async () => {
      try {
        const { readSetting, writeSetting } = await import("../../db");
        serverState.interventionSecret = await getOrCreateInternalSecret(
          (key) => Promise.resolve(readSetting(key) as string | null),
          (key, value) =>
            Promise.resolve(writeSetting(key, value)).then(() => {}),
        );
      } catch (err) {
        log.warn(
          "[HTTP] Failed to initialize intervention secret:",
          (err as Error).message,
        );
      }
    })();

    serverState.server.on("error", (err: NodeJS.ErrnoException) => {
      log.error("❌ [ComputerServer] Server error:", err);
      const errorMsg =
        err.code === "EADDRINUSE" ? `Port ${port} already in use` : err.message;
      serverState.lastError = errorMsg;
      serverState.server = null;
      serverState.runningPort = null;
      resolve({ success: false, error: errorMsg });
    });

    // 监听 0.0.0.0：与 Tauri rcoder 行为一致，lanproxy 隧道需要从外部访问此端口
    serverState.server.listen(port, "0.0.0.0", () => {
      log.info(
        `✅ [ComputerServer] Listening on 0.0.0.0:${port} (aligned with rcoder /computer/* API)`,
      );
      serverState.lastError = null;
      serverState.runningPort = port;
      resolve({ success: true });
    });
  });
}

export function stopComputerServer(): Promise<void> {
  return new Promise((resolve) => {
    const portToSweep = serverState.runningPort ?? getConfiguredPorts().agent;
    if (!serverState.server) {
      serverState.lastError = null;
      serverState.runningPort = null;
      killProcessTreesListeningOnTcpPort(portToSweep)
        .catch((error) => {
          log.warn("[ComputerServer] Stop port sweep failed:", error);
        })
        .finally(() => resolve());
      return;
    }

    closeAndClearAllSseClients();

    serverState.server.close(() => {
      log.info("[ComputerServer] Stopped");
      serverState.server = null;
      serverState.lastError = null;
      serverState.runningPort = null;
      killProcessTreesListeningOnTcpPort(portToSweep)
        .catch((error) => {
          log.warn("[ComputerServer] Stop port sweep failed:", error);
        })
        .finally(() => resolve());
    });
  });
}

export function getComputerServerStatus(): {
  running: boolean;
  port?: number;
  error?: string;
} {
  if (!serverState.server || !serverState.server.listening) {
    return { running: false, error: serverState.lastError || undefined };
  }
  const addr = serverState.server.address();
  return {
    running: true,
    port: typeof addr === "object" && addr ? addr.port : undefined,
  };
}

// ==================== Barrel ====================

export {
  pushSseEvent,
  clearSseEventBuffer,
  clearAllSseEventBuffers,
  getSseEventBufferSize,
  hasSessionFirstTokenContext,
  setSessionFirstTokenContextForTest,
} from "./sseManager";
