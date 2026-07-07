import * as fs from "node:fs";
import { cliCredentialsPath, writeFileAtomic } from "../../util/paths.js";
import { getDeviceId } from "./deviceId.js";

/**
 * Single active account, matching the simplified domain+savedKey login
 * model — unlike the Electron client, nuwaclaw doesn't juggle multiple
 * accounts at once.
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
export interface Credentials {
  domain?: string;
  username?: string;
  configKey?: string;
  savedKey?: string;
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

/** Clears configKey/token/lastRegAt but keeps domain/username/savedKey — mirrors the Electron client's logout (configKey ends the session; savedKey persists for a future passwordless login). */
export function clearSessionKeepingSavedKey(): void {
  const current = readCredentials();
  writeCredentials({
    domain: current.domain,
    username: current.username,
    savedKey: current.savedKey,
  });
}

export { getDeviceId };
