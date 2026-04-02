import { readSetting } from "../../db";

/**
 * 检查 Lanproxy 通道健康状态
 */
export async function checkLanproxyHealth(savedKey: string): Promise<{
  healthy: boolean;
  error?: string;
}> {
  const serverHost = readSetting("lanproxy.server_host") as string | null;

  if (!serverHost) {
    return { healthy: false, error: "缺少服务器配置" };
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
    if (response.ok) {
      return { healthy: true };
    }
    return { healthy: false, error: `HTTP ${response.status}` };
  } catch (e) {
    return {
      healthy: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}
