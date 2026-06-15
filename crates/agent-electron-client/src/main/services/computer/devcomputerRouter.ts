/**
 * DevComputer 调试接口路由
 *
 * /devcomputer/* 接口，薄包装委托给 /computer/* handler。
 * 核心差异：handleDevcomputerChat 注入 auto_reload 默认配置。
 *
 * 对齐 rcoder 的 /devcomputer/* 实现。
 */

import * as http from "http";
import log from "electron-log";
import type {
  ComputerChatRequest,
  HttpResult,
  AutoReloadConfig,
} from "@shared/types/computerTypes";
import { handleComputerChat } from "./router";
import { parseBody } from "./router";

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

function error(code: string, message: string): HttpResult<null> {
  return { code, message, data: null, tid: null, success: false };
}

/** 默认启用的 AutoReloadConfig */
function defaultAutoReloadEnabled(): AutoReloadConfig {
  return {
    enabled: true,
    stability_check_ms: 500,
    stability_retries: 3,
    force: false,
  };
}

// ==================== Router ====================

export async function handleDevcomputerRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<void> {
  const url = new URL(
    req.url || "/",
    `http://${req.headers.host || "localhost"}`,
  );
  const pathname = url.pathname;
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

  try {
    switch (pathname) {
      case "/devcomputer/chat":
        await handleDevcomputerChat(req, res);
        break;

      // 其他 devcomputer 接口委托给 computer router 的 handleRequest
      // 由 requestDispatcher 统一处理，这里不需要额外路由
      default:
        sendJson(
          res,
          404,
          error("NOT_FOUND", `Unknown devcomputer path: ${pathname}`),
        );
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    log.error(`[DevComputer] Error handling ${pathname}: ${message}`);
    sendJson(res, 500, error("INTERNAL_ERROR", message));
  }
}

// ==================== Handlers ====================

/**
 * POST /devcomputer/chat
 *
 * 与 /computer/chat 功能相同，自动注入 auto_reload 默认配置（默认启用热重载）。
 * 对齐 rcoder 的 handle_devcomputer_chat 实现。
 */
async function handleDevcomputerChat(
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<void> {
  const body = (await parseBody(req)) as ComputerChatRequest;

  // 注入 auto_reload 默认配置（默认启用热重载）
  if (body.agent_config) {
    if (!body.agent_config.auto_reload) {
      body.agent_config.auto_reload = defaultAutoReloadEnabled();
    }
  } else {
    body.agent_config = {
      auto_reload: defaultAutoReloadEnabled(),
    };
  }

  log.info(
    `[DevComputer] chat: user_id=${body.user_id}, project_id=${body.project_id}, ` +
      `prompt_len=${body.prompt?.length}, auto_reload=enabled`,
  );

  // 委托给 computer chat handler（source=devcomputer 用于 {PREFIX_WORKSPACE_DIR} 替换）
  await handleComputerChat(req, res, body, "devcomputer");
}
