import * as clack from "@clack/prompts";
import pc from "picocolors";
import {
  registerClient,
  normalizeServerHost,
  defaultSandboxValue,
  RegError,
} from "../core/auth/regClient.js";
import {
  readCredentials,
  updateCredentials,
  clearSessionKeepingSavedKey,
} from "../core/auth/credentials.js";
import { getDeviceId } from "../core/auth/deviceId.js";

export interface LoginCommandOptions {
  domain?: string;
  savedKey?: string;
  username?: string;
}

async function resolveDomain(
  explicit: string | undefined,
): Promise<string | null> {
  if (explicit) return normalizeServerHost(explicit);
  const existing = readCredentials();
  if (existing.domain) return existing.domain;
  const answer = await clack.text({
    message: "Nuwax 服务器地址：",
    placeholder: "https://agent.nuwax.com",
  });
  if (clack.isCancel(answer)) return null;
  return normalizeServerHost(answer);
}

async function performReg(
  domain: string,
  auth: { username: string; password: string; savedKey?: string },
): Promise<void> {
  const result = await registerClient(domain, {
    username: auth.username,
    password: auth.password,
    savedKey: auth.savedKey,
    deviceId: getDeviceId(),
    sandboxConfigValue: defaultSandboxValue(),
  });
  updateCredentials({
    domain,
    username: auth.username || undefined,
    configKey: result.configKey,
    savedKey: result.configKey,
    token: result.token,
    lastRegAt: new Date().toISOString(),
  });
  console.log(pc.green(`已登录：${result.name ?? auth.username}（${domain}）`));
}

export async function loginCommand(
  options: LoginCommandOptions,
): Promise<void> {
  const domain = await resolveDomain(options.domain);
  if (!domain) {
    console.error(pc.dim("已取消。"));
    return;
  }

  try {
    if (options.savedKey) {
      const existing = readCredentials();
      await performReg(domain, {
        username: options.username ?? existing.username ?? "",
        password: "",
        savedKey: options.savedKey,
      });
      return;
    }

    if (options.username) {
      const password = await clack.password({
        message: `${options.username}@${domain} 密码：`,
      });
      if (clack.isCancel(password)) {
        console.error(pc.dim("已取消。"));
        return;
      }
      await performReg(domain, {
        username: options.username,
        password,
        savedKey: undefined,
      });
      return;
    }

    const existing = readCredentials();
    if (existing.savedKey) {
      await performReg(domain, {
        username: existing.username ?? "",
        password: "",
        savedKey: existing.savedKey,
      });
      return;
    }

    throw new Error(
      "首次登录需要 --saved-key <key> 或 -u <username>（随后提示输入密码）",
    );
  } catch (err) {
    const message =
      err instanceof RegError ? err.message : (err as Error).message;
    console.error(pc.red(`[nuwaclaw] 登录失败：${message}`));
    process.exitCode = 1;
  }
}

export async function logoutCommand(): Promise<void> {
  clearSessionKeepingSavedKey();
  console.log(pc.dim("已退出登录（savedKey 已保留，下次可免密登录）。"));
}

export interface StatusCommandOptions {
  remote?: boolean;
}

export async function statusCommand(
  options: StatusCommandOptions,
): Promise<void> {
  const credentials = readCredentials();
  // "logged in" tracks configKey, not savedKey — mirrors the Electron
  // client's isLoggedIn(): a saved device key alone (post-logout) must never
  // be reported as an active session.
  if (!credentials.configKey) {
    console.log(
      pc.dim(
        credentials.savedKey
          ? "未登录（savedKey 已保存，运行 `nuwaclaw login` 免密重新登录）。"
          : "未登录。运行 `nuwaclaw login --domain <host> --saved-key <key>` 登录。",
      ),
    );
    return;
  }

  console.log(`域名：${credentials.domain}`);
  console.log(`用户：${credentials.username || "(未知)"}`);
  console.log(`savedKey：已保存`);
  console.log(`上次注册：${credentials.lastRegAt ?? "(未知)"}`);

  if (options.remote && credentials.domain) {
    try {
      await performReg(credentials.domain, {
        username: credentials.username ?? "",
        password: "",
        savedKey: credentials.savedKey,
      });
      console.log(pc.green("远程校验：savedKey 有效。"));
    } catch (err) {
      const message =
        err instanceof RegError ? err.message : (err as Error).message;
      console.error(pc.red(`远程校验失败：${message}`));
      process.exitCode = 1;
    }
  }
}
