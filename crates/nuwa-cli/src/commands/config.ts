import pc from "picocolors";
import {
  listStoredAccounts,
  readCredentials,
  updateCredentials,
} from "../core/auth/credentials.js";
import { normalizeServerHost } from "../core/auth/regClient.js";

const SETTABLE_KEYS = [
  "domain",
  "saved-key",
  "username",
  "lanproxy-path",
] as const;
type SettableKey = (typeof SETTABLE_KEYS)[number];

function isSettableKey(key: string): key is SettableKey {
  return (SETTABLE_KEYS as readonly string[]).includes(key);
}

export async function configGetCommand(key?: string): Promise<void> {
  const credentials = readCredentials();
  if (!key) {
    console.log(`domain: ${credentials.domain ?? "(未设置)"}`);
    console.log(`username: ${credentials.username ?? "(未设置)"}`);
    console.log(`computer-name: ${credentials.computerName ?? "(未设置)"}`);
    console.log(`accounts: ${listStoredAccounts(credentials).length}`);
    console.log(`saved-key: ${credentials.savedKey ? "(已设置)" : "(未设置)"}`);
    console.log(`lanproxy-path: ${credentials.lanproxyPath ?? "(未设置)"}`);
    return;
  }
  if (!isSettableKey(key)) {
    console.error(
      pc.red(
        `[nuwa-cli] 未知配置项 "${key}"，可用：${SETTABLE_KEYS.join(", ")}`,
      ),
    );
    process.exitCode = 1;
    return;
  }
  if (key === "saved-key") {
    console.log(credentials.savedKey ? "(已设置)" : "(未设置)");
    return;
  }
  if (key === "lanproxy-path") {
    console.log(credentials.lanproxyPath ?? "(未设置)");
    return;
  }
  console.log(
    credentials[key === "domain" ? "domain" : "username"] ?? "(未设置)",
  );
}

export async function configSetCommand(
  key: string,
  value: string,
): Promise<void> {
  if (!isSettableKey(key)) {
    console.error(
      pc.red(
        `[nuwa-cli] 未知配置项 "${key}"，可用：${SETTABLE_KEYS.join(", ")}`,
      ),
    );
    process.exitCode = 1;
    return;
  }
  if (key === "domain") {
    updateCredentials({ domain: normalizeServerHost(value) });
  } else if (key === "saved-key") {
    updateCredentials({ savedKey: value });
  } else if (key === "lanproxy-path") {
    updateCredentials({ lanproxyPath: value });
  } else {
    updateCredentials({ username: value });
  }
  console.log(pc.green(`已更新 ${key}。`));
}
