/**
 * Admin Server — 管理接口（与 Computer Server 共用同一端口）
 *
 * 路由前缀 /admin/*，由 index.ts 的服务器创建时分发过来。
 */

import * as http from "http";
import log from "electron-log";
import { BrowserWindow } from "electron";
import { DEFAULT_ADMIN_SERVER_PORT } from "@shared/constants";
import { checkLanproxyHealth } from "../packages/lanproxyHealth";
import { agentService } from "../engines/unifiedAgent";
import { parseBody } from "./router";

/** 获取主窗口 */
const getMainWindow = () => BrowserWindow.getAllWindows()[0];

const notifyServicesRestarting = () => {
  getMainWindow()?.webContents.send("admin:servicesRestarting");
};

const notifyServicesRestarted = (
  results: Record<string, { success: boolean; error?: string }>,
) => {
  const hasFailure = Object.values(results).some((r) => !r.success);
  getMainWindow()?.webContents.send("admin:servicesRestarted", {
    success: !hasFailure,
    results,
  });
};

/** 执行完整重启流程（供延迟调用） */
async function doRestartAllServicesIncludingComputerServer(): Promise<
  Record<string, { success: boolean; error?: string }>
> {
  const { getServiceManager } = await import("../../ipc/processHandlers");
  const serviceManager = getServiceManager();
  if (!serviceManager) {
    throw new Error("ServiceManager not initialized");
  }

  const base = await serviceManager.restartAllServicesExceptLanproxy();

  // 动态 import 避免与 index.ts 的循环依赖
  const { stopComputerServer, startComputerServer } = await import("./index");
  await stopComputerServer();

  const { getConfiguredPorts } = await import("../startupPorts");
  const { agent: agentPort } = getConfiguredPorts();
  let csResult: { success: boolean; error?: string };
  try {
    await startComputerServer(agentPort);
    csResult = { success: true };
  } catch (e) {
    csResult = { success: false, error: String(e) };
  }

  const results: Record<string, { success: boolean; error?: string }> = {
    ...base.results,
    computerServer: csResult,
  };

  notifyServicesRestarted(results);
  return results;
}

export async function handleAdminRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<void> {
  const url = new URL(
    req.url || "/",
    `http://localhost:${DEFAULT_ADMIN_SERVER_PORT}`,
  );
  const pathname = url.pathname;
  const method = req.method || "GET";

  const sendJson = (status: number, data: unknown) => {
    res.writeHead(status, {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    });
    res.end(JSON.stringify(data));
  };

  try {
    // GET /admin/health
    if (pathname === "/admin/health" && method === "GET") {
      sendJson(200, { status: "ok", timestamp: Date.now() });
      return;
    }

    // GET /admin/health/lanproxy
    if (pathname === "/admin/health/lanproxy" && method === "GET") {
      const { readSetting } = await import("../../db");
      const savedKey = readSetting("auth.saved_key") as string | null;
      if (!savedKey) {
        sendJson(200, { healthy: false, error: "savedKey not configured" });
        return;
      }
      const health = await checkLanproxyHealth(savedKey);
      sendJson(200, health);
      return;
    }

    // POST /admin/services/restart
    if (pathname === "/admin/services/restart" && method === "POST") {
      log.info("[AdminServer] /admin/services/restart called");

      sendJson(200, {
        code: "0000",
        message: "Restart scheduled; will run in 2 seconds",
        data: null,
      });

      notifyServicesRestarting();

      setTimeout(async () => {
        try {
          const results = await doRestartAllServicesIncludingComputerServer();
          const failedServices = Object.entries(results)
            .filter(([, v]) => !v.success)
            .map(([k, v]) => `${k}: ${v.error}`)
            .join("; ");
          if (failedServices) {
            log.warn(
              `[AdminServer] Some services failed to start: ${failedServices}`,
            );
          } else {
            log.info("[AdminServer] Delayed restart complete");
          }
        } catch (e) {
          log.error("[AdminServer] Delayed restart error:", e);
        }
      }, 2000);
      return;
    }

    // POST /admin/acp-mode
    if (pathname === "/admin/acp-mode" && method === "POST") {
      const body = (await parseBody(req)) as {
        acpSessionId?: string;
        mode?: string;
      };
      const acpEngine = agentService.getAcpEngine();
      if (!acpEngine) {
        sendJson(404, { code: "404", message: "ACP engine not running" });
        return;
      }
      if (!body.mode || (body.mode !== "ask" && body.mode !== "yolo")) {
        sendJson(400, { code: "400", message: 'mode must be "ask" or "yolo"' });
        return;
      }
      if (body.acpSessionId) {
        (acpEngine as any).setEffectiveMode(body.acpSessionId, body.mode);
        log.info(
          `[AdminServer] ACP mode set to "${body.mode}" for session ${body.acpSessionId}`,
        );
      } else {
        const sessions = (acpEngine as any).sessions as Map<
          string,
          { acpSessionId?: string }
        >;
        for (const [, session] of sessions) {
          if (session.acpSessionId) {
            (acpEngine as any).setEffectiveMode(
              session.acpSessionId,
              body.mode,
            );
          }
        }
        log.info(
          `[AdminServer] ACP mode set to "${body.mode}" for all ${sessions.size} session(s)`,
        );
      }
      sendJson(200, {
        code: "0000",
        message: `ACP mode set to "${body.mode}"`,
        data: { mode: body.mode, acpSessionId: body.acpSessionId || "all" },
      });
      return;
    }

    // GET /admin/acp-mode
    if (pathname === "/admin/acp-mode" && method === "GET") {
      const acpEngine = agentService.getAcpEngine();
      if (!acpEngine) {
        sendJson(404, { code: "404", message: "ACP engine not running" });
        return;
      }
      const modes: Record<string, string> = {};
      const sessions = (acpEngine as any).sessions as Map<
        string,
        { acpSessionId?: string }
      >;
      const effectiveModes = (acpEngine as any).effectiveModes as Map<
        string,
        string
      >;
      for (const [, session] of sessions) {
        if (session.acpSessionId) {
          modes[session.acpSessionId] =
            effectiveModes.get(session.acpSessionId) ?? "yolo (default)";
        }
      }
      sendJson(200, { code: "0000", data: modes });
      return;
    }

    // 404
    sendJson(404, { code: "404", message: `Path not found: ${pathname}` });
  } catch (error: any) {
    log.error(`[AdminServer] Request handling error: ${pathname}`, error);
    sendJson(500, {
      code: "1003",
      message: error.message || "Internal error",
      data: null,
    });
  }
}
