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
  getSavedKeyForAccount,
  rememberAccountCredentials,
} from "../core/auth/credentials.js";
import { getDeviceId } from "../core/auth/deviceId.js";
import { getServeStatus } from "../core/serve/serveLock.js";

export interface LoginCommandOptions {
  domain?: string;
  savedKey?: string;
  username?: string;
}

export async function resolveDomain(
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

export async function performReg(
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
  const patch: Parameters<typeof updateCredentials>[0] = {
    domain,
    username: auth.username || undefined,
    computerName: result.name,
    configKey: result.configKey,
    savedKey: result.configKey,
    serverHost: result.serverHost,
    serverPort: result.serverPort,
    token: result.token,
    lastRegAt: new Date().toISOString(),
  };
  if (auth.username) {
    const remembered = rememberAccountCredentials({
      domain,
      username: auth.username,
      computerName: result.name,
      savedKey: result.configKey,
      serverHost: result.serverHost,
      serverPort: result.serverPort,
      lastRegAt: patch.lastRegAt,
    });
    patch.savedKeys = remembered.savedKeys;
    patch.accounts = remembered.accounts;
  }
  updateCredentials(patch);
  console.log(pc.green(`已登录：${result.name ?? auth.username}（${domain}）`));
}

export async function resolveLoginPassword(
  username: string,
  domain: string,
): Promise<string | null> {
  if (process.env.NUWACLAW_PASSWORD) return process.env.NUWACLAW_PASSWORD;
  const password = await clack.password({
    message: `${username}@${domain} 密码：`,
  });
  if (clack.isCancel(password)) return null;
  return password;
}

export async function loginCommand(
  options: LoginCommandOptions,
): Promise<void> {
  try {
    if (options.savedKey) {
      const domain = await resolveDomain(options.domain);
      if (!domain) {
        console.error(pc.dim("已取消。"));
        return;
      }
      const existing = readCredentials();
      await performReg(domain, {
        username: options.username ?? existing.username ?? "",
        password: "",
        savedKey: options.savedKey,
      });
      return;
    }

    if (options.username) {
      const domain = await resolveDomain(options.domain);
      if (!domain) {
        console.error(pc.dim("已取消。"));
        return;
      }
      const password = await resolveLoginPassword(options.username, domain);
      if (password === null) {
        console.error(pc.dim("已取消。"));
        return;
      }
      await performReg(domain, {
        username: options.username,
        password,
        savedKey: getSavedKeyForAccount(domain, options.username),
      });
      return;
    }

    const existing = readCredentials();
    if (existing.savedKey) {
      const domain = await resolveDomain(options.domain);
      if (!domain) {
        console.error(pc.dim("已取消。"));
        return;
      }
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
    console.error(pc.red(`[nuwa-cli] 登录失败：${message}`));
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

/**
 * Reports whether a local `serve` is running and on which port, by reading the
 * lock `serve` writes on listen and probing `/health` (no secret needed). The
 * X-Nuwax-Internal-Secret itself is never persisted, so this can only say a
 * serve is up — to actually call `/computer/chat` the user must still grab the
 * secret from the serve process's startup output.
 */
async function printServeStatus(): Promise<void> {
  const status = await getServeStatus();
  if (status.state === "running") {
    console.log(
      `serve：${pc.green("运行中")}  端口 ${status.port}  PID ${status.pid}  启动于 ${status.startedAt}`,
    );
    console.log(
      pc.dim(
        `  地址 http://${status.host}:${status.port}（X-Nuwax-Internal-Secret 仅启动时打印，未落盘）`,
      ),
    );
  } else if (status.state === "unhealthy") {
    console.log(
      `serve：${pc.yellow("异常")}  PID ${status.pid}  端口 ${status.port}（/health 无响应，可能仍在启动或不健康）`,
    );
  } else {
    console.log(
      `serve：${pc.dim("未运行")}${
        status.note ? `  ${pc.dim(status.note)}` : ""
      }（可用 \`nuwa-cli serve\` 启动）`,
    );
  }
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
          ? "未登录（savedKey 已保存，运行 `nuwa-cli login` 免密重新登录）。"
          : "未登录。运行 `nuwa-cli login --domain <host> --saved-key <key>` 登录。",
      ),
    );
    await printServeStatus();
    return;
  }

  console.log(`域名：${credentials.domain}`);
  console.log(`用户：${credentials.username || "(未知)"}`);
  console.log(`电脑名：${credentials.computerName || "(未知)"}`);
  console.log(`savedKey：已保存`);
  console.log(`上次注册：${credentials.lastRegAt ?? "(未知)"}`);
  await printServeStatus();

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
