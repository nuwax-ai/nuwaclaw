import * as path from "node:path";
import * as fs from "node:fs";
import { spawn } from "node:child_process";
import pc from "picocolors";
import { getEngine } from "../core/engines/registry.js";
import { buildCliChildEnv, type EngineKind } from "../core/env/inheritEnv.js";
import type { PermissionMode } from "../core/permissions/policy.js";
import { startServeHttp } from "../core/serve/server.js";
import { startFileServer, stopFileServer } from "../core/serve/fileServer.js";
import {
  startLanproxy,
  type LanproxyHandle,
} from "../core/serve/lanproxyProcess.js";
import {
  readCredentials,
  rememberAccountCredentials,
  updateCredentials,
} from "../core/auth/credentials.js";
import { getDeviceId } from "../core/auth/deviceId.js";
import {
  registerClient,
  defaultSandboxValue,
  RegError,
} from "../core/auth/regClient.js";
import {
  CLI_AGENT_PORT,
  CLI_FILE_SERVER_PORT,
  findAvailablePort,
} from "../core/ports.js";
import { ensureDir, logsDir, workspacesDir } from "../util/paths.js";
import { debugLog } from "../core/debugLog.js";

export interface ServeCommandOptions {
  port?: string;
  host?: string;
  engine: string;
  cwd?: string;
  approve?: string;
  tunnel?: boolean;
  lanproxyPath?: string;
  lanproxyHost?: string;
  lanproxyPort?: string;
  lanproxySsl?: string;
  daemon?: boolean;
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  daemonArgs?: string[];
}

function parseBooleanFlag(
  value: string | undefined,
  defaultValue: boolean,
): boolean {
  if (value === undefined) return defaultValue;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`布尔值只能是 true 或 false，收到 ${value}`);
}

function parsePortOption(
  value: string | undefined,
  defaultValue: number,
  optionName: string,
): number {
  if (value === undefined) return defaultValue;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`${optionName} 必须是 1-65535 的整数，收到 ${value}`);
  }
  return port;
}

async function resolveAvailablePort(
  preferredPort: number,
  host: string,
  label: string,
  exclude: number[] = [],
): Promise<number> {
  const port = await findAvailablePort(preferredPort, { host, exclude });
  if (port !== preferredPort) {
    console.error(
      pc.yellow(
        `[nuwa-cli] ${label} 端口 ${preferredPort} 已不可用，自动改用 ${port}。`,
      ),
    );
  }
  return port;
}

function launchDaemon(argsOverride?: string[]): void {
  const args =
    argsOverride ?? process.argv.slice(1).filter((arg) => arg !== "--daemon");
  ensureDir(logsDir());
  const logPath = path.join(logsDir(), "serve.log");
  const out = fs.openSync(logPath, "a");
  const err = fs.openSync(logPath, "a");
  const child = spawn(process.execPath, args, {
    detached: true,
    stdio: ["ignore", out, err],
    env: buildCliChildEnv({ NUWACLAW_SERVE_DAEMONIZED: "1" }),
  });
  child.unref();
  debugLog("serve.daemon", "launched", {
    pid: child.pid,
    logPath,
    args,
  });
  console.log(pc.green(`nuwa-cli serve 已后台启动（pid ${child.pid}）。`));
  console.log(pc.dim(`日志：${logPath}`));
}

export async function serveCommand(
  options: ServeCommandOptions,
): Promise<void> {
  debugLog("serve.command", "start", {
    engine: options.engine,
    tunnel: options.tunnel === true,
    daemon: options.daemon === true,
    requestedPort: options.port,
    requestedHost: options.host,
    requestedCwd: options.cwd,
  });
  if (options.daemon && process.env.NUWACLAW_SERVE_DAEMONIZED !== "1") {
    launchDaemon(options.daemonArgs);
    return;
  }

  const engineId = options.engine as EngineKind;
  try {
    getEngine(engineId);
  } catch (err) {
    console.error(pc.red(`[nuwa-cli] ${(err as Error).message}`));
    process.exitCode = 1;
    return;
  }

  const cwd = path.resolve(options.cwd ?? workspacesDir());
  const cwdIsProject = Boolean(options.cwd);
  ensureDir(cwd);
  const host = options.host ?? "127.0.0.1";
  debugLog("serve.command", "workspace resolved", { cwd, cwdIsProject });
  let port: number;
  try {
    const preferredPort = parsePortOption(
      options.port,
      CLI_AGENT_PORT,
      "--port",
    );
    port = await resolveAvailablePort(preferredPort, host, "HTTP API");
  } catch (err) {
    console.error(pc.red(`[nuwa-cli] ${(err as Error).message}`));
    process.exitCode = 1;
    return;
  }
  // Validate explicitly so a typo (e.g. `--approve deni`, `--approve strict`)
  // errors out instead of silently falling through to yolo (full auto-approve).
  const approveRaw = options.approve ?? "auto";
  if (approveRaw !== "auto" && approveRaw !== "deny") {
    console.error(
      pc.red(
        `[nuwa-cli] --approve 只支持 auto 或 deny，收到 "${approveRaw}"。`,
      ),
    );
    process.exitCode = 1;
    return;
  }
  const permissionMode: PermissionMode =
    approveRaw === "deny" ? "deny-noninteractive" : "yolo";
  let fileServerStarted = false;
  let activeFileServerPort: number | undefined;
  let lanproxyHandle: LanproxyHandle | undefined;
  const credentials = options.tunnel ? readCredentials() : {};
  const acceptedSecrets = options.tunnel
    ? [
        ...new Set(
          [credentials.configKey, credentials.savedKey].filter(
            (value): value is string => Boolean(value),
          ),
        ),
      ]
    : [];
  const overlay =
    options.apiKey || options.baseUrl || options.model
      ? {
          apiKey: options.apiKey,
          baseUrl: options.baseUrl,
          model: options.model,
        }
      : undefined;

  const { secret, stop, addAcceptedSecret } = startServeHttp({
    port,
    host,
    engine: engineId,
    cwd,
    cwdIsProject,
    permissionMode,
    overlay,
    acceptedSecrets,
    allowUnauthenticatedComputerRoutes: options.tunnel === true,
  });
  debugLog("serve.command", "http started", {
    host,
    port,
    engine: engineId,
    acceptedSecrets: acceptedSecrets.length,
  });
  console.log(pc.green(`nuwa-cli serve 已启动：http://${host}:${port}`));
  console.log(pc.dim(`X-Nuwax-Internal-Secret: ${secret}`));
  console.log(
    pc.dim(
      options.tunnel
        ? "（仅本次进程有效，不会持久化；本地直连调试可带此 header，云端隧道请求由 lanproxy savedKey 授权）"
        : "（仅本次进程有效，不会持久化，每个请求需带此 header）",
    ),
  );

  if (permissionMode === "yolo") {
    // yolo has no path confinement (unlike the Electron client's strict gate):
    // every tool call — file write/delete, shell, network — is auto-approved.
    // Surface that explicitly at startup rather than letting the default look
    // safe. See known limitation; full confinement is a follow-up.
    console.error(
      pc.yellow(
        "[nuwa-cli] 当前为自动批准（yolo）模式：引擎发起的所有工具调用（含文件写入/删除、命令执行、网络访问）都会被自动放行，且不做路径限制。请确认仅监听本机、X-Nuwax-Internal-Secret 未泄露；如需拒绝工具调用请改用 --approve deny。",
      ),
    );
  }

  if (options.tunnel) {
    // Checks configKey (current session), not just savedKey — a device that
    // merely *remembers* a key after logout shouldn't silently reconnect;
    // the user must explicitly `nuwa-cli login` first, same as the Electron
    // client's auto-reconnect only firing when the prior session wasn't
    // explicitly logged out.
    if (
      !credentials.domain ||
      !credentials.configKey ||
      !credentials.savedKey
    ) {
      console.error(
        pc.yellow(
          "[nuwa-cli] --tunnel 需要先登录：nuwa-cli login --domain <host> --saved-key <key>；本次仅提供本地 API，不建立云端隧道。",
        ),
      );
    } else {
      try {
        const ssl = parseBooleanFlag(options.lanproxySsl, true);
        debugLog("serve.tunnel", "register start", {
          domain: credentials.domain,
          username: credentials.username,
          preferredAgentPort: port,
        });
        const fileServerPort = await resolveAvailablePort(
          CLI_FILE_SERVER_PORT,
          "127.0.0.1",
          "file-server",
          [port],
        );
        const reg = await registerClient(credentials.domain, {
          username: credentials.username ?? "",
          password: "",
          savedKey: credentials.savedKey,
          deviceId: getDeviceId(),
          sandboxConfigValue: defaultSandboxValue({
            agentPort: port,
            fileServerPort,
            apiKey: secret,
          }),
        });
        debugLog("serve.tunnel", "register success", {
          domain: credentials.domain,
          username: credentials.username,
          computerName: reg.name,
          serverHost: reg.serverHost,
          serverPort: reg.serverPort,
          agentPort: port,
          fileServerPort,
        });
        if (
          reg.configValue?.fileServerPort &&
          reg.configValue.fileServerPort !== fileServerPort
        ) {
          console.error(
            pc.yellow(
              `[nuwa-cli] 后端返回的 fileServerPort=${reg.configValue.fileServerPort} 与 CLI 本次可用端口 ${fileServerPort} 不一致，本次以 CLI 端口为准。`,
            ),
          );
        }
        const lanproxyHost =
          options.lanproxyHost ?? reg.serverHost ?? credentials.serverHost;
        const lanproxyPort = parsePortOption(
          options.lanproxyPort ??
            (reg.serverPort ?? credentials.serverPort)?.toString(),
          0,
          "--lanproxy-port",
        );
        const lastRegAt = new Date().toISOString();
        addAcceptedSecret(reg.configKey);
        const serverHost = reg.serverHost ?? credentials.serverHost;
        const serverPort = reg.serverPort ?? credentials.serverPort;
        const patch: Parameters<typeof updateCredentials>[0] = {
          configKey: reg.configKey,
          savedKey: reg.configKey,
          serverHost,
          serverPort,
          token: reg.token,
          lastRegAt,
        };
        if (credentials.domain && credentials.username) {
          const remembered = rememberAccountCredentials({
            domain: credentials.domain,
            username: credentials.username,
            computerName: credentials.computerName,
            savedKey: reg.configKey,
            serverHost,
            serverPort,
            lastRegAt,
          });
          patch.savedKeys = remembered.savedKeys;
          patch.accounts = remembered.accounts;
        }
        updateCredentials(patch);
        if (
          !lanproxyHost ||
          !Number.isFinite(lanproxyPort) ||
          lanproxyPort <= 0
        ) {
          throw new Error(
            "注册成功但缺少 lanproxy serverHost/serverPort；请传 --lanproxy-host 与 --lanproxy-port",
          );
        }

        startFileServer(fileServerPort, cwd);
        debugLog("serve.fileServer", "started", {
          port: fileServerPort,
          workspaceRoot: cwd,
        });
        fileServerStarted = true;
        activeFileServerPort = fileServerPort;
        console.log(
          pc.green(`nuwax-file-server 已启动（端口 ${fileServerPort}）。`),
        );
        lanproxyHandle = startLanproxy({
          pathOverride:
            options.lanproxyPath ?? credentials.lanproxyPath ?? undefined,
          serverHost: lanproxyHost,
          serverPort: lanproxyPort,
          clientKey: reg.configKey,
          ssl,
        });
        debugLog("serve.lanproxy", "started", {
          pid: lanproxyHandle.pid,
          serverHost: lanproxyHost,
          serverPort: lanproxyPort,
          ssl,
        });
        console.log(
          pc.green(
            `lanproxy 已启动（pid ${lanproxyHandle.pid ?? "unknown"}，${lanproxyHost}:${lanproxyPort}，ssl=${ssl}）。`,
          ),
        );
      } catch (err) {
        const message =
          err instanceof RegError ? err.message : (err as Error).message;
        debugLog("serve.tunnel", "failed", { message });
        console.error(
          pc.red(
            `[nuwa-cli] --tunnel 注册失败：${message}；本次仅提供本地 API。`,
          ),
        );
      }
    }
  }

  await new Promise<void>((resolve) => {
    let shuttingDown = false;
    const shutdown = async () => {
      if (shuttingDown) return;
      shuttingDown = true;
      process.off("SIGINT", shutdown);
      process.off("SIGTERM", shutdown);
      console.log(pc.dim("\n正在关闭..."));
      debugLog("serve.command", "shutdown start", {
        fileServerStarted,
        activeFileServerPort,
        lanproxyPid: lanproxyHandle?.pid,
      });
      await stop();
      lanproxyHandle?.stop();
      if (lanproxyHandle) debugLog("serve.lanproxy", "stopped");
      if (fileServerStarted && activeFileServerPort !== undefined) {
        stopFileServer(activeFileServerPort, cwd);
        debugLog("serve.fileServer", "stopped", {
          port: activeFileServerPort,
        });
      }
      debugLog("serve.command", "shutdown done");
      resolve();
    };
    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
  });
}
