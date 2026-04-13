import { readSetting } from "../../db";
import { t } from "../i18n";
import type { HttpResult } from "@shared/types/computerTypes";
import log from "electron-log";

function isHttpResult(value: unknown): value is HttpResult<unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const body = value as Record<string, unknown>;
  return (
    typeof body.code === "string" &&
    typeof body.message === "string" &&
    "data" in body
  );
}

/**
 * 检查 Lanproxy 通道健康状态
 */
export async function checkLanproxyHealth(savedKey: string): Promise<{
  healthy: boolean;
  error?: string;
}> {
  const serverHost = readSetting("lanproxy.server_host") as string | null;

  if (!serverHost) {
    return { healthy: false, error: t("Claw.Lanproxy.missingServerConfig") };
  }

  try {
    // serverHost 可能是纯域名（如 testagent.xspaceagi.com）或带协议（如 https://testagent.xspaceagi.com）
    const protocol = serverHost.startsWith("https") ? "https" : "http";
    const normalizedHost = serverHost.replace(/^https?:\/\//, "");
    const url = `${protocol}://${normalizedHost}/api/sandbox/config/health/${savedKey}`;
    const response = await fetch(url, {
      method: "GET",
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) {
      return {
        healthy: false,
        error: `HTTP ${response.status}`,
      };
    }
    let data: unknown;
    try {
      data = await response.json();
      log.info("[LanproxyHealth] Health API response", {
        status: response.status,
        data,
      });
    } catch {
      return {
        healthy: false,
        error: "Invalid JSON in health response",
      };
    }
    if (!isHttpResult(data)) {
      return {
        healthy: false,
        error: "Unexpected health response",
      };
    }
    const body = data;
    if (body.code === "0000") {
      return { healthy: true };
    }
    const apiMessage =
      typeof body.message === "string" && body.message.trim()
        ? body.message
        : undefined;
    const codeWithBracket = `[${body.code}]`;
    return {
      healthy: false,
      error: apiMessage
        ? `${codeWithBracket} ${apiMessage}`
        : `${codeWithBracket} Health check failed`,
    };
  } catch (e) {
    return {
      healthy: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}
