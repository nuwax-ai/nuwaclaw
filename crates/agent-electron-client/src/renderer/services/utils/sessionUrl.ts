/**
 * Shared utility for constructing session redirect URLs and syncing cookies.
 * Used by both ClientPage and SessionsPage.
 */

import { getCurrentAuth } from "../core/auth";
import { AUTH_KEYS } from "@shared/constants";

export function buildRedirectUrl(
  domain: string,
  userId: string | number,
): string {
  const normalizedDomain = domain.replace(/\/+$/, "");
  return `${normalizedDomain}/api/sandbox/config/redirect/${userId}`;
}

export async function syncSessionCookie(
  domain: string,
  token: string,
): Promise<void> {
  let cookieDomain: string;
  try {
    cookieDomain = new URL(domain).hostname;
  } catch {
    cookieDomain = domain.replace(/^https?:\/\//, "");
  }
  await window.electronAPI?.session.setCookie({
    url: domain,
    name: "ticket",
    value: token,
    domain: cookieDomain,
    httpOnly: true,
    secure: domain.startsWith("https"),
  });
}

/**
 * Read auth settings, sync cookie, and return the redirect URL.
 * Returns null if auth info is incomplete (not logged in, or missing domain/userId).
 */
export async function syncCookieAndGetRedirectUrl(): Promise<string | null> {
  const auth = await getCurrentAuth();
  if (!auth.isLoggedIn) return null;

  const domain = auth.userInfo?.currentDomain;
  const userId = auth.userInfo?.id;
  if (!domain || !userId) return null;

  const token = (await window.electronAPI?.settings.get(
    AUTH_KEYS.AUTH_TOKEN,
  )) as string | null;
  if (token) {
    await syncSessionCookie(domain, token);
  }

  return buildRedirectUrl(domain, userId);
}
