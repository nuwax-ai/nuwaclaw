/**
 * Shared utility for constructing session redirect URLs and syncing cookies.
 * Used by both ClientPage and SessionsPage.
 */

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
 * Returns null if auth info is incomplete.
 */
export async function syncCookieAndGetRedirectUrl(): Promise<string | null> {
  const [domain, userId, token] = await Promise.all([
    window.electronAPI?.settings.get("auth.domain") as Promise<string | null>,
    window.electronAPI?.settings.get("auth.user_id") as Promise<number | null>,
    window.electronAPI?.settings.get("auth.token") as Promise<string | null>,
  ]);

  if (!domain || !userId) return null;

  if (token) {
    await syncSessionCookie(domain, token);
  }

  return buildRedirectUrl(domain, userId);
}
