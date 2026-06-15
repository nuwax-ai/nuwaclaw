/**
 * Agent Management HTTP 路由
 *
 * /agent-mgmt/* 接口，提供 Agent 的安装、查询、卸载能力。
 * 对齐 rcoder 的 /agent-mgmt/* API 实现。
 */

import * as http from "http";
import log from "electron-log";
import type {
  HttpResult,
  InstallFromUrlRequest,
  ListAgentsRequest,
  CheckAgentRequest,
  UninstallAgentRequest,
} from "@shared/types/computerTypes";
import {
  installFromUrl,
  listAgents,
  checkAgent,
  uninstallAgent,
} from "../agentInstaller";

// ==================== Helpers ====================

function sendJson(
  res: http.ServerResponse,
  status: number,
  data: unknown,
): void {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
  });
  res.end(JSON.stringify(data));
}

function success<T>(data: T): HttpResult<T> {
  return { code: "0000", message: "Success", data, tid: null, success: true };
}

function error(code: string, message: string): HttpResult<null> {
  return { code, message, data: null, tid: null, success: false };
}

async function parseBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      try {
        const body = Buffer.concat(chunks).toString("utf-8");
        resolve(body ? JSON.parse(body) : {});
      } catch (e) {
        reject(new Error("Invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

// ==================== Router ====================

export async function handleAgentMgmtRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<void> {
  const pathname = new URL(
    req.url || "/",
    `http://${req.headers.host || "localhost"}`,
  ).pathname;
  const method = req.method?.toUpperCase() || "GET";

  // CORS preflight
  if (method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    });
    res.end();
    return;
  }

  if (method !== "POST") {
    sendJson(
      res,
      405,
      error("METHOD_NOT_ALLOWED", "Only POST method is allowed"),
    );
    return;
  }

  try {
    switch (pathname) {
      case "/agent-mgmt/agents/list":
        await handleListAgents(req, res);
        break;
      case "/agent-mgmt/agents/check":
        await handleCheckAgent(req, res);
        break;
      case "/agent-mgmt/agents/install-from-url":
        await handleInstallFromUrl(req, res);
        break;
      case "/agent-mgmt/agents/uninstall":
        await handleUninstallAgent(req, res);
        break;
      default:
        sendJson(
          res,
          404,
          error("NOT_FOUND", `Unknown agent-mgmt path: ${pathname}`),
        );
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    log.error(`[AgentMgmt] Error handling ${pathname}: ${message}`);
    sendJson(res, 500, error("INTERNAL_ERROR", message));
  }
}

// ==================== Handlers ====================

/** POST /agent-mgmt/agents/list */
async function handleListAgents(
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<void> {
  const body = (await parseBody(req)) as ListAgentsRequest;
  log.info(
    `[AgentMgmt] listAgents: user_id=${body.user_id}, project_id=${body.project_id}`,
  );

  const result = listAgents();
  sendJson(res, 200, success(result));
}

/** POST /agent-mgmt/agents/check */
async function handleCheckAgent(
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<void> {
  const body = (await parseBody(req)) as CheckAgentRequest;

  if (!body.agent_id?.trim()) {
    sendJson(res, 400, error("ERR_VALIDATION", "agent_id is required"));
    return;
  }

  log.info(
    `[AgentMgmt] checkAgent: agent_id=${body.agent_id}, version=${body.version}`,
  );

  const result = checkAgent(body.agent_id, body.version);
  sendJson(res, 200, success(result));
}

/** POST /agent-mgmt/agents/install-from-url */
async function handleInstallFromUrl(
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<void> {
  const body = (await parseBody(req)) as InstallFromUrlRequest;

  // 验证必填字段
  if (!body.agent?.agent_id?.trim()) {
    sendJson(res, 400, error("ERR_VALIDATION", "agent.agent_id is required"));
    return;
  }
  if (!body.agent?.command?.trim()) {
    sendJson(res, 400, error("ERR_VALIDATION", "agent.command is required"));
    return;
  }
  if (!body.agent?.version?.trim()) {
    sendJson(res, 400, error("ERR_VALIDATION", "agent.version is required"));
    return;
  }
  if (!body.platforms || Object.keys(body.platforms).length === 0) {
    sendJson(res, 400, error("ERR_VALIDATION", "platforms cannot be empty"));
    return;
  }

  log.info(
    `[AgentMgmt] installFromUrl: agent_id=${body.agent.agent_id}, ` +
      `version=${body.agent.version}, platforms=${Object.keys(body.platforms).join(",")}`,
  );

  try {
    const result = await installFromUrl(body);
    sendJson(res, 200, success(result));
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    log.error(`[AgentMgmt] installFromUrl failed: ${message}`);

    // 映射错误码
    let code = "ERR_AGENT_MGMT_INSTALL_FAILED";
    if (message.includes("Platform not found"))
      code = "ERR_AGENT_MGMT_PLATFORM_NOT_FOUND";
    else if (message.includes("SHA-256"))
      code = "ERR_AGENT_MGMT_CHECKSUM_MISMATCH";
    else if (message.includes("timeout"))
      code = "ERR_AGENT_MGMT_COMMAND_TIMEOUT";
    else if (
      message.includes("agent_id") ||
      message.includes("command") ||
      message.includes("version") ||
      message.includes("platforms")
    )
      code = "ERR_VALIDATION";

    sendJson(res, code === "ERR_VALIDATION" ? 400 : 500, error(code, message));
  }
}

/** POST /agent-mgmt/agents/uninstall */
async function handleUninstallAgent(
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<void> {
  const body = (await parseBody(req)) as UninstallAgentRequest;

  if (!body.agent_id?.trim()) {
    sendJson(res, 400, error("ERR_VALIDATION", "agent_id is required"));
    return;
  }

  log.info(
    `[AgentMgmt] uninstallAgent: agent_id=${body.agent_id}, version=${body.version}`,
  );

  try {
    const result = uninstallAgent(body.agent_id, body.version);
    sendJson(res, 200, success(result));
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    log.error(`[AgentMgmt] uninstallAgent failed: ${message}`);

    let code = "ERR_AGENT_MGMT_UNINSTALL_FAILED";
    if (message.includes("not found")) code = "ERR_AGENT_MGMT_NOT_FOUND";
    else if (message.includes("builtin"))
      code = "ERR_AGENT_MGMT_BUILTIN_PROTECTED";

    sendJson(res, 400, error(code, message));
  }
}
