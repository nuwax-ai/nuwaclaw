/**
 * Intervention HTTP Handlers
 *
 * 用于 computerServer.ts 中的 /computer/notify-resolved 路由。
 * 包含 internal secret 校验和 request body 校验。
 */

import type {
  NotifyResolvedRequest,
  NotifyResolvedResponse,
  AcpPermissionResponse,
} from "@shared/types/intervention";
import { validateRcoderNotifyResolvedRequest } from "./rcoderPermissionProtocol";

// === Internal Secret 校验 ===

/**
 * 从 SQLite 读取 interventionInternalSecret。
 * 首次调用时如果不存在会自动生成并持久化。
 */
let cachedSecret: string | null = null;

export async function getOrCreateInternalSecret(
  getSetting: (key: string) => Promise<string | null>,
  setSetting: (key: string, value: string) => Promise<void>,
): Promise<string> {
  if (cachedSecret) return cachedSecret;

  const stored = await getSetting("interventionInternalSecret");
  if (stored) {
    cachedSecret = stored;
    return cachedSecret;
  }

  // 生成 32 字节随机 secret，base64url 编码
  const { randomBytes } = await import("crypto");
  const secret = randomBytes(32).toString("base64url");
  await setSetting("interventionInternalSecret", secret);
  cachedSecret = secret;
  return secret;
}

/**
 * 校验 HTTP 请求中的 internal secret。
 * Header: X-Nuwax-Internal-Secret
 */
export function verifyInternalCallback(
  req: { headers: Record<string, string | string[] | undefined> },
  secret: string,
): { ok: boolean } {
  const headerSecret = req.headers["x-nuwax-internal-secret"];
  if (!headerSecret || typeof headerSecret !== "string") {
    return { ok: false };
  }
  // constant-time comparison
  if (headerSecret.length !== secret.length) return { ok: false };
  let mismatch = 0;
  for (let i = 0; i < secret.length; i++) {
    mismatch |= headerSecret.charCodeAt(i) ^ secret.charCodeAt(i);
  }
  return { ok: mismatch === 0 };
}

// === Request Body 校验 ===

export function validateNotifyResolvedRequest(
  body: any,
): { ok: true } | { ok: false; message: string } {
  if (!body || typeof body !== "object") {
    return { ok: false, message: "request body is required" };
  }

  if (typeof body.interventionId !== "string" || !body.interventionId) {
    return { ok: false, message: "interventionId is required" };
  }

  if (typeof body.revision !== "number" || body.revision < 1) {
    return { ok: false, message: "revision must be a positive number" };
  }

  if (body.source !== "acp_permission") {
    return { ok: false, message: "source must be acp_permission" };
  }

  if (body.protocol !== "acp") {
    return { ok: false, message: "protocol must be acp" };
  }

  if (!body.acpResponse || typeof body.acpResponse !== "object") {
    return { ok: false, message: "acpResponse is required" };
  }

  const outcome = body.acpResponse.outcome;
  if (!outcome || typeof outcome !== "object") {
    return { ok: false, message: "acpResponse.outcome is required" };
  }

  if (outcome.outcome === "selected") {
    if (typeof outcome.optionId !== "string" || !outcome.optionId) {
      return { ok: false, message: "selected outcome requires optionId" };
    }
  } else if (outcome.outcome !== "cancelled") {
    return { ok: false, message: "outcome must be selected or cancelled" };
  }

  return { ok: true };
}

export { validateRcoderNotifyResolvedRequest };

/**
 * 根据 NotifyResolvedResponse 确定 HTTP status code
 */
export function statusFromNotifyResolvedResult(
  result: NotifyResolvedResponse,
): number {
  if (result.ok) return 200;
  if (!result.error) return 500;
  switch (result.error.code) {
    case "ERR_VALIDATION":
      return 400;
    case "ERR_SESSION_NOT_FOUND":
    case "ERR_PERMISSION_NOT_FOUND":
      return 404;
    case "ERR_PERMISSION_EXPIRED":
      return 410;
    case "ERR_PERMISSION_RESOLVE_FAILED":
    case "ERR_CONTAINER_ERROR":
      return 500;
    case "unauthorized":
      return 401;
    case "forbidden_target":
      return 403;
    case "not_found":
      return 404;
    case "revision_mismatch":
    case "already_resolved_conflict":
      return 409;
    case "invalid_acp_response":
      return 400;
    default:
      return 500;
  }
}
