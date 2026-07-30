import { readSetting } from "../../db";
import { t } from "../i18n";
import log from "electron-log";
import { DEFAULT_SERVER_HOST } from "@shared/constants";

export interface LanproxyHealthResult {
  healthy: boolean;
  error?: string;
}

/** 云端隧道回探默认超时（缩短阻塞；私有化无接口时靠 404 快失败） */
export const LANPROXY_TUNNEL_WAIT_TIMEOUT_MS = 10_000;

/**
 * 规范化业务后端域（补协议、去尾部 `/`）。
 * 与 renderer auth.normalizeServerHost 行为一致，供主进程使用。
 */
export function normalizeBusinessDomain(input: string): string {
  let value = input.trim();
  if (!value) return value;
  value = value.replace(/\/+$/, "");
  if (/^https?:\/\//i.test(value)) return value;
  return `https://${value}`;
}

/**
 * 解析云端 health 接口应使用的业务域名。
 *
 * 优先级（与 auth 调 reg 的 domain 解析对齐）：
 * 1. step1_config.serverHost — 用户登录的业务域（首选，勿与隧道地址混淆）
 * 2. lanproxy.server_host — 仅在 step1 缺失时兜底（历史/半完成配置；可能是 reg 回写的隧道主机）
 * 3. DEFAULT_SERVER_HOST — 最后兜底，保证至少能发出探测
 */
export function getBusinessDomain(): string {
  const step1 = readSetting("step1_config") as { serverHost?: string } | null;
  const step1Host = step1?.serverHost?.trim() || "";
  if (step1Host) {
    return normalizeBusinessDomain(step1Host);
  }

  const lanproxyHost = (
    readSetting("lanproxy.server_host") as string | null
  )?.trim();
  if (lanproxyHost) {
    return normalizeBusinessDomain(lanproxyHost);
  }

  return normalizeBusinessDomain(DEFAULT_SERVER_HOST);
}

/** 云端 envelope 健康判定：三选一容错，适配后端字段演进 */
export function isLanproxyTunnelEnvelopeHealthy(envelope: {
  code?: string;
  success?: boolean;
  data?: { online?: boolean };
}): boolean {
  return (
    envelope.code === "0000" ||
    envelope.success === true ||
    envelope.data?.online === true
  );
}

/**
 * 第 2 层：进程稳定存活检查。
 * spawn 成功后跨稳定窗口再次确认 pid 仍在，捕捉「连 server 失败后延迟退出」。
 */
export async function confirmLanproxyHealthy(
  pid: number | undefined,
  stabilizeMs = 1000,
): Promise<boolean> {
  if (!pid) return false;
  const isAlive = (p: number): boolean => {
    try {
      process.kill(p, 0);
      return true;
    } catch {
      return false;
    }
  };
  if (!isAlive(pid)) return false;
  if (stabilizeMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, stabilizeMs));
  }
  return isAlive(pid);
}

/**
 * 第 3 层：轮询业务域云端隧道 online 状态。
 * GET {domain}/api/sandbox/config/health/{configKey}
 *
 * 对明确「接口不存在」的 HTTP 状态（404/501/405）立即返回 false，避免私有化部署空耗超时。
 */
export async function waitForLanproxyTunnel(
  domain: string,
  configKey: string,
  timeoutMs = LANPROXY_TUNNEL_WAIT_TIMEOUT_MS,
  intervalMs = 500,
): Promise<boolean> {
  if (!domain || !configKey) return false;
  const base = domain.replace(/\/+$/, "");
  const url = `${base}/api/sandbox/config/health/${encodeURIComponent(configKey)}`;
  const deadline = Date.now() + timeoutMs;

  do {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
      // 私有化后端常未实现 health：404/501/405 快失败，避免打满超时阻塞启动
      if (res.status === 404 || res.status === 501 || res.status === 405) {
        log.warn(
          "[LanproxyHealth] Tunnel health endpoint missing (fast-fail)",
          { status: res.status, url },
        );
        return false;
      }
      if (res.ok) {
        const envelope = (await res.json()) as {
          code?: string;
          success?: boolean;
          message?: string;
          data?: { online?: boolean };
        };
        // 轮询过程用 debug，避免启动期刷屏；就绪时由调用方打 info
        log.debug("[LanproxyHealth] Tunnel health poll", {
          status: res.status,
          code: envelope.code,
          success: envelope.success,
          online: envelope.data?.online,
        });
        if (isLanproxyTunnelEnvelopeHealthy(envelope)) {
          return true;
        }
      }
    } catch {
      // 隧道尚未 online 或网络抖动，继续重试直至超时
    }
    if (Date.now() >= deadline) break;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  } while (Date.now() < deadline);

  return false;
}

/**
 * 单次云端健康探测（供 admin `/admin/health/lanproxy` 等即时查询）。
 * 使用业务域，判定与 waitForLanproxyTunnel 一致（三选一容错）。
 */
export async function checkLanproxyHealth(
  savedKey: string,
): Promise<LanproxyHealthResult> {
  if (!savedKey) {
    return { healthy: false, error: "savedKey is empty" };
  }

  const domain = getBusinessDomain();
  if (!domain) {
    return { healthy: false, error: t("Claw.Lanproxy.missingServerConfig") };
  }

  try {
    const url = `${domain}/api/sandbox/config/health/${encodeURIComponent(savedKey)}`;
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
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      return {
        healthy: false,
        error: "Unexpected health response",
      };
    }
    const body = data as {
      code?: string;
      success?: boolean;
      message?: string;
      data?: { online?: boolean };
    };
    if (isLanproxyTunnelEnvelopeHealthy(body)) {
      return { healthy: true };
    }
    const apiMessage =
      typeof body.message === "string" && body.message.trim()
        ? body.message
        : undefined;
    const codeLabel =
      typeof body.code === "string" && body.code ? `[${body.code}]` : "[?]";
    return {
      healthy: false,
      error: apiMessage
        ? `${codeLabel} ${apiMessage}`
        : `${codeLabel} Health check failed`,
    };
  } catch (e) {
    return {
      healthy: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

/**
 * 启动后三层健康检查：进程稳定存活 → 云端隧道 online。
 * 失败仅返回结果，不抛错；调用方决定是否 fatal。
 * @param stabilizeMs 传给 confirmLanproxyHealthy 的稳定窗口（默认 1s）
 */
export async function probeLanproxyAfterStart(
  pid: number | undefined,
  configKey: string,
  stabilizeMs = 1000,
): Promise<LanproxyHealthResult> {
  const alive = await confirmLanproxyHealthy(pid, stabilizeMs);
  if (!alive) {
    return {
      healthy: false,
      error: "Lanproxy process not stable after start",
    };
  }

  const domain = getBusinessDomain();
  if (!domain || !configKey) {
    return {
      healthy: false,
      error: !domain
        ? t("Claw.Lanproxy.missingServerConfig")
        : "configKey is empty",
    };
  }

  const online = await waitForLanproxyTunnel(domain, configKey);
  if (!online) {
    return {
      healthy: false,
      error:
        "Lanproxy tunnel health check timed out or endpoint unavailable (private backends may omit /api/sandbox/config/health)",
    };
  }
  return { healthy: true };
}
