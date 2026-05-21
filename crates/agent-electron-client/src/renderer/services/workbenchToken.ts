import { AUTH_KEYS } from "@shared/constants";
import {
  getDomainTokenKey,
  getWorkbenchAccessTokenKey,
} from "@shared/utils/domain";

function getNonEmptyString(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeBaseUrl(value: unknown): string | null {
  const raw = getNonEmptyString(value);
  if (!raw) return null;
  return raw.replace(/\/+$/, "");
}

function uniqueDomains(...values: unknown[]): string[] {
  const seen = new Set<string>();
  const domains: string[] = [];
  for (const value of values) {
    const normalized = normalizeBaseUrl(value);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    domains.push(normalized);
  }
  return domains;
}

async function settingsSet(key: string, value: unknown): Promise<void> {
  await window.electronAPI?.settings.set(key, value);
}

/**
 * 从 SQLite settings 中扫描任意域名下的 token 缓存。
 */
export async function scanCachedAccessTokens(): Promise<string | null> {
  const api = window.electronAPI?.settings;
  if (!api?.listKeys) return null;

  for (const prefix of ["workbench.access_tokens.", "auth.tokens."]) {
    const rows = await api.listKeys(prefix);
    for (const row of rows) {
      const token = getNonEmptyString(row.value);
      if (token) return token;
    }
  }
  return null;
}

/**
 * 从 Electron session 的 ticket cookie 读取登录 JWT（与 OpenApp web 登录态一致）。
 */
export async function readTicketFromSession(
  domain: string,
): Promise<string | null> {
  const base = normalizeBaseUrl(domain);
  if (!base) return null;

  const result = await window.electronAPI?.session.getCookieValue?.({
    url: base,
    name: "ticket",
  });
  if (!result?.success || !result.found) return null;
  return getNonEmptyString(result.value);
}

/**
 * 将 token 写入 workbench / auth 域名缓存与 userInfo，供 Agent Mode 读取。
 */
export async function persistAccessTokenForDomains(
  token: string,
  domains: string[],
): Promise<void> {
  const normalizedToken = token.trim();
  if (!normalizedToken) return;

  for (const domain of uniqueDomains(...domains)) {
    await settingsSet(getWorkbenchAccessTokenKey(domain), normalizedToken);
    await settingsSet(getDomainTokenKey(domain), normalizedToken);
  }

  const userInfo = (await window.electronAPI?.settings.get(
    AUTH_KEYS.USER_INFO,
  )) as Record<string, unknown> | null;
  if (userInfo && typeof userInfo === "object") {
    await settingsSet(AUTH_KEYS.USER_INFO, {
      ...userInfo,
      accessToken: normalizedToken,
    });
  }
}

/**
 * 在缺少 accessToken 时，从 session ticket 与 settings 扫描恢复并写回缓存。
 */
export async function recoverWorkbenchAccessToken(
  domains: string[],
): Promise<string | null> {
  for (const domain of uniqueDomains(...domains)) {
    const fromSession = await readTicketFromSession(domain);
    if (fromSession) {
      await persistAccessTokenForDomains(fromSession, domains);
      return fromSession;
    }
  }

  const scanned = await scanCachedAccessTokens();
  if (scanned) {
    await persistAccessTokenForDomains(scanned, domains);
    return scanned;
  }

  return null;
}
