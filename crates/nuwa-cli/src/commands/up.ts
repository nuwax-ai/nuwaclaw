import pc from "picocolors";
import {
  getSavedKeyForAccount,
  readCredentials,
} from "../core/auth/credentials.js";
import { selectEngine } from "../core/engines/probe.js";
import type { EngineKind } from "../core/env/inheritEnv.js";
import { performReg, resolveDomain, resolveLoginPassword } from "./login.js";
import { serveCommand, type ServeCommandOptions } from "./serve.js";
import { debugLog } from "../core/debugLog.js";

export interface UpCommandOptions {
  domain?: string;
  savedKey?: string;
  username?: string;
  engine?: string;
  port?: string;
  host?: string;
  cwd?: string;
  approve?: string;
  lanproxyPath?: string;
  lanproxyHost?: string;
  lanproxyPort?: string;
  lanproxySsl?: string;
  daemon?: boolean;
  apiKey?: string;
  baseUrl?: string;
  model?: string;
}

function pushFlag(args: string[], name: string, value?: string): void {
  if (value !== undefined) args.push(name, value);
}

function buildServeDaemonArgs(
  options: UpCommandOptions,
  engine: EngineKind,
): string[] {
  const args = [process.argv[1], "serve", "--tunnel", "--engine", engine];
  pushFlag(args, "--port", options.port);
  pushFlag(args, "--host", options.host);
  pushFlag(args, "--cwd", options.cwd);
  pushFlag(args, "--approve", options.approve);
  pushFlag(args, "--lanproxy-path", options.lanproxyPath);
  pushFlag(args, "--lanproxy-host", options.lanproxyHost);
  pushFlag(args, "--lanproxy-port", options.lanproxyPort);
  pushFlag(args, "--lanproxy-ssl", options.lanproxySsl);
  pushFlag(args, "--api-key", options.apiKey);
  pushFlag(args, "--base-url", options.baseUrl);
  pushFlag(args, "--model", options.model);
  return args;
}

async function ensureRegistered(options: UpCommandOptions): Promise<void> {
  if (options.savedKey) {
    const domain = await resolveDomain(options.domain);
    if (!domain) throw new Error("已取消。");
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
    if (!domain) throw new Error("已取消。");
    const password = await resolveLoginPassword(options.username, domain);
    if (password === null) throw new Error("已取消。");
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
    if (!domain) throw new Error("已取消。");
    await performReg(domain, {
      username: existing.username ?? "",
      password: "",
      savedKey: existing.savedKey,
    });
    return;
  }

  throw new Error(
    "首次启动需要 --domain <host> --saved-key <key> 或 --domain <host> -u <username>",
  );
}

export async function upCommand(options: UpCommandOptions): Promise<void> {
  try {
    debugLog("up.command", "start", {
      domain: options.domain,
      username: options.username,
      engine: options.engine,
      hasSavedKey: Boolean(options.savedKey),
      daemon: options.daemon === true,
      cwd: options.cwd,
    });
    const { engine, probes } = await selectEngine(options.engine);
    const available = probes
      .filter((probe) => probe.ok)
      .map((probe) => probe.id)
      .join(", ");
    console.log(
      pc.green(
        `已选择引擎：${engine}${available ? `（可用：${available}）` : ""}`,
      ),
    );
    debugLog("up.command", "engine selected", {
      engine,
      available,
      probes: probes.map((probe) => ({
        id: probe.id,
        ok: probe.ok,
        detail: probe.ok ? undefined : probe.detail,
        fix: probe.ok ? undefined : probe.fix,
      })),
    });

    await ensureRegistered(options);
    debugLog("up.command", "registered");

    const serveOptions: ServeCommandOptions = {
      port: options.port,
      host: options.host,
      engine,
      cwd: options.cwd,
      approve: options.approve,
      tunnel: true,
      lanproxyPath: options.lanproxyPath,
      lanproxyHost: options.lanproxyHost,
      lanproxyPort: options.lanproxyPort,
      lanproxySsl: options.lanproxySsl,
      daemon: options.daemon,
      daemonArgs: options.daemon
        ? buildServeDaemonArgs(options, engine)
        : undefined,
      apiKey: options.apiKey,
      baseUrl: options.baseUrl,
      model: options.model,
    };
    debugLog("up.command", "serve handoff", {
      engine,
      tunnel: serveOptions.tunnel,
      daemon: serveOptions.daemon,
      cwd: serveOptions.cwd,
      port: serveOptions.port,
    });
    await serveCommand(serveOptions);
  } catch (err) {
    debugLog("up.command", "failed", {
      message: (err as Error).message,
    });
    console.error(pc.red(`[nuwa-cli] up 失败：${(err as Error).message}`));
    process.exitCode = 1;
  }
}
