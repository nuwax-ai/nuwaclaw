import * as fs from "node:fs";
import { cliCredentialsPath, writeFileAtomic } from "../../util/paths.js";
import { getDeviceId } from "./deviceId.js";

/**
 * One active account plus remembered device keys for past domain+username
 * pairs. The active `savedKey` remains a quick default, while `savedKeys`
 * mirrors the Electron client's per-account savedKey behavior so re-login
 * with the same domain+username renews the same device instead of creating a
 * new computer entry.
 *
 * `configKey` and `savedKey` hold the same value after a successful reg but
 * serve different purposes (mirrors the Electron client's auth.ts):
 * - `configKey`: current-session validity. Cleared on logout. This is what
 *   "am I logged in" (status/doctor) checks — matching the Electron
 *   client's `isLoggedIn()`, which only checks its configKey equivalent.
 * - `savedKey`: device-remembered credential. Survives logout, and is only
 *   used when the user explicitly runs `login` again (passwordless
 *   re-auth) — never to silently treat a logged-out CLI as logged in.
 */
export interface StoredAccountCredentials {
  domain: string;
  username: string;
  computerName?: string;
  savedKey: string;
  serverHost?: string;
  serverPort?: number;
  lastRegAt?: string;
}

export interface Credentials {
  domain?: string;
  username?: string;
  computerName?: string;
  configKey?: string;
  savedKey?: string;
  /**
   * Legacy lightweight index kept for backward compatibility with early
   * nuwa-cli builds. New writes also populate `accounts`.
   */
  savedKeys?: Record<string, string>;
  accounts?: Record<string, StoredAccountCredentials>;
  serverHost?: string;
  serverPort?: number;
  lanproxyPath?: string;
  token?: string;
  lastRegAt?: string;
}

export function readCredentials(): Credentials {
  const filePath = cliCredentialsPath();
  if (!fs.existsSync(filePath)) return {};
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch {
    return {};
  }
}

export function writeCredentials(credentials: Credentials): void {
  writeFileAtomic(
    cliCredentialsPath(),
    JSON.stringify(credentials, null, 2),
    0o600,
  );
}

export function updateCredentials(patch: Partial<Credentials>): Credentials {
  const merged = { ...readCredentials(), ...patch };
  writeCredentials(merged);
  return merged;
}

export function normalizeDomainForSavedKey(domain: string): string {
  try {
    return new URL(domain).hostname.toLowerCase();
  } catch {
    return domain
      .replace(/^https?:\/\//i, "")
      .split("/")[0]
      .split(":")[0]
      .toLowerCase();
  }
}

export function savedKeyAccountKey(domain: string, username: string): string {
  return `${normalizeDomainForSavedKey(domain)}_${username}`;
}

export function getAccountForCredentials(
  credentials: Credentials,
  domain?: string,
  username?: string,
): StoredAccountCredentials | undefined {
  if (!domain || !username) return undefined;
  const accountKey = savedKeyAccountKey(domain, username);
  const account = credentials.accounts?.[accountKey];
  if (account) return account;

  const savedKey = credentials.savedKeys?.[accountKey];
  if (savedKey) {
    return {
      domain,
      username,
      savedKey,
    };
  }

  // Backward compatibility for credentials written before per-account keys:
  // if the active account matches, its global savedKey is the right device key.
  if (
    credentials.domain === domain &&
    credentials.username === username &&
    credentials.savedKey
  ) {
    return {
      domain,
      username,
      computerName: credentials.computerName,
      savedKey: credentials.savedKey,
      serverHost: credentials.serverHost,
      serverPort: credentials.serverPort,
      lastRegAt: credentials.lastRegAt,
    };
  }
  return undefined;
}

export function listStoredAccounts(
  credentials = readCredentials(),
): Array<{ key: string; account: StoredAccountCredentials; current: boolean }> {
  const accounts = new Map<string, StoredAccountCredentials>();

  for (const [key, account] of Object.entries(credentials.accounts ?? {})) {
    accounts.set(key, account);
  }

  for (const [key, savedKey] of Object.entries(credentials.savedKeys ?? {})) {
    if (!accounts.has(key)) {
      const separator = key.lastIndexOf("_");
      accounts.set(key, {
        domain: separator > 0 ? key.slice(0, separator) : key,
        username: separator > 0 ? key.slice(separator + 1) : "",
        savedKey,
      });
    }
  }

  if (credentials.domain && credentials.username && credentials.savedKey) {
    const key = savedKeyAccountKey(credentials.domain, credentials.username);
    accounts.set(key, {
      ...accounts.get(key),
      domain: credentials.domain,
      username: credentials.username,
      computerName: credentials.computerName,
      savedKey: credentials.savedKey,
      serverHost: credentials.serverHost,
      serverPort: credentials.serverPort,
      lastRegAt: credentials.lastRegAt,
    });
  }

  const currentKey =
    credentials.domain && credentials.username
      ? savedKeyAccountKey(credentials.domain, credentials.username)
      : undefined;
  return [...accounts.entries()]
    .map(([key, account]) => ({
      key,
      account,
      current: key === currentKey,
    }))
    .sort((a, b) => a.key.localeCompare(b.key));
}

export function resolveStoredAccount(
  selector: string,
  credentials = readCredentials(),
): { key: string; account: StoredAccountCredentials } | null {
  const accounts = listStoredAccounts(credentials);
  const exact = accounts.find((item) => item.key === selector);
  if (exact) return { key: exact.key, account: exact.account };

  const byUsername = accounts.filter(
    (item) => item.account.username === selector,
  );
  if (byUsername.length === 1) {
    return { key: byUsername[0].key, account: byUsername[0].account };
  }
  return null;
}

export function getSavedKeyForAccount(
  domain?: string,
  username?: string,
): string | undefined {
  const current = readCredentials();
  if (!domain || !username) return current.savedKey;
  return getAccountForCredentials(current, domain, username)?.savedKey;
}

export function rememberSavedKeyForAccount(
  domain: string,
  username: string | undefined,
  savedKey: string,
): Record<string, string> | undefined {
  if (!username) return readCredentials().savedKeys;
  const current = readCredentials();
  return {
    ...(current.savedKeys ?? {}),
    [savedKeyAccountKey(domain, username)]: savedKey,
  };
}

export function rememberAccountCredentials(params: StoredAccountCredentials): {
  savedKeys: Record<string, string>;
  accounts: Record<string, StoredAccountCredentials>;
} {
  const current = readCredentials();
  const accountKey = savedKeyAccountKey(params.domain, params.username);
  return {
    savedKeys: {
      ...(current.savedKeys ?? {}),
      [accountKey]: params.savedKey,
    },
    accounts: {
      ...(current.accounts ?? {}),
      [accountKey]: params,
    },
  };
}

/** Clears configKey/token/lastRegAt but keeps domain/username/computerName/savedKey/savedKeys — mirrors the Electron client's logout (configKey ends the session; savedKey persists for a future passwordless login). */
export function clearSessionKeepingSavedKey(): void {
  const current = readCredentials();
  writeCredentials({
    domain: current.domain,
    username: current.username,
    computerName: current.computerName,
    savedKey: current.savedKey,
    savedKeys: current.savedKeys,
    accounts: current.accounts,
    serverHost: current.serverHost,
    serverPort: current.serverPort,
    lanproxyPath: current.lanproxyPath,
  });
}

export { getDeviceId };
