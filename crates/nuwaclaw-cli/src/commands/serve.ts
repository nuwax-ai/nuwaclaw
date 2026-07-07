import * as path from "node:path";
import pc from "picocolors";
import { getEngine } from "../core/engines/registry.js";
import type { EngineKind } from "../core/env/inheritEnv.js";
import type { PermissionMode } from "../core/permissions/policy.js";
import { startServeHttp } from "../core/serve/server.js";
import { startFileServer, stopFileServer } from "../core/serve/fileServer.js";
import { readCredentials } from "../core/auth/credentials.js";
import { getDeviceId } from "../core/auth/deviceId.js";
import {
  registerClient,
  defaultSandboxValue,
  RegError,
} from "../core/auth/regClient.js";

export interface ServeCommandOptions {
  port?: string;
  host?: string;
  engine: string;
  cwd?: string;
  approve?: string;
  tunnel?: boolean;
  apiKey?: string;
  baseUrl?: string;
  model?: string;
}

export async function serveCommand(
  options: ServeCommandOptions,
): Promise<void> {
  const engineId = options.engine as EngineKind;
  try {
    getEngine(engineId);
  } catch (err) {
    console.error(pc.red(`[nuwaclaw] ${(err as Error).message}`));
    process.exitCode = 1;
    return;
  }

  const cwd = path.resolve(options.cwd ?? process.cwd());
  const port = Number(options.port ?? 60016);
  const host = options.host ?? "127.0.0.1";
  // Validate explicitly so a typo (e.g. `--approve deni`, `--approve strict`)
  // errors out instead of silently falling through to yolo (full auto-approve).
  const approveRaw = options.approve ?? "auto";
  if (approveRaw !== "auto" && approveRaw !== "deny") {
    console.error(
      pc.red(
        `[nuwaclaw] --approve 只支持 auto 或 deny，收到 "${approveRaw}"。`,
      ),
    );
    process.exitCode = 1;
    return;
  }
  const permissionMode: PermissionMode =
    approveRaw === "deny" ? "deny-noninteractive" : "yolo";
  let fileServerStarted = false;
  const overlay =
    options.apiKey || options.baseUrl || options.model
      ? {
          apiKey: options.apiKey,
          baseUrl: options.baseUrl,
          model: options.model,
        }
      : undefined;

  const { secret, stop } = startServeHttp({
    port,
    host,
    engine: engineId,
    cwd,
    permissionMode,
    overlay,
  });
  console.log(pc.green(`nuwaclaw serve 已启动：http://${host}:${port}`));
  console.log(pc.dim(`X-Nuwax-Internal-Secret: ${secret}`));
  console.log(pc.dim("（仅本次进程有效，不会持久化，每个请求需带此 header）"));

  if (permissionMode === "yolo") {
    // yolo has no path confinement (unlike the Electron client's strict gate):
    // every tool call — file write/delete, shell, network — is auto-approved.
    // Surface that explicitly at startup rather than letting the default look
    // safe. See known limitation; full confinement is a follow-up.
    console.error(
      pc.yellow(
        "[nuwaclaw] 当前为自动批准（yolo）模式：引擎发起的所有工具调用（含文件写入/删除、命令执行、网络访问）都会被自动放行，且不做路径限制。请确认仅监听本机、X-Nuwax-Internal-Secret 未泄露；如需拒绝工具调用请改用 --approve deny。",
      ),
    );
  }

  if (options.tunnel) {
    const credentials = readCredentials();
    // Checks configKey (current session), not just savedKey — a device that
    // merely *remembers* a key after logout shouldn't silently reconnect;
    // the user must explicitly `nuwaclaw login` first, same as the Electron
    // client's auto-reconnect only firing when the prior session wasn't
    // explicitly logged out.
    if (
      !credentials.domain ||
      !credentials.configKey ||
      !credentials.savedKey
    ) {
      console.error(
        pc.yellow(
          "[nuwaclaw] --tunnel 需要先登录：nuwaclaw login --domain <host> --saved-key <key>；本次仅提供本地 API，不建立云端隧道。",
        ),
      );
    } else {
      try {
        const reg = await registerClient(credentials.domain, {
          username: credentials.username ?? "",
          password: "",
          savedKey: credentials.savedKey,
          deviceId: getDeviceId(),
          sandboxConfigValue: defaultSandboxValue({ agentPort: port }),
        });
        const fileServerPort =
          reg.configValue?.fileServerPort ??
          defaultSandboxValue().fileServerPort;
        startFileServer(fileServerPort);
        fileServerStarted = true;
        console.log(
          pc.green(`nuwax-file-server 已启动（端口 ${fileServerPort}）。`),
        );
        console.log(
          pc.yellow(
            "[nuwaclaw] lanproxy 云端隧道尚未接入（lanproxy 目前没有独立分发渠道，且需要真实后端联调确认调用参数）——本次仅本地 file-server 可用，云端/IM 暂无法通过隧道访问。",
          ),
        );
      } catch (err) {
        const message =
          err instanceof RegError ? err.message : (err as Error).message;
        console.error(
          pc.red(
            `[nuwaclaw] --tunnel 注册失败：${message}；本次仅提供本地 API。`,
          ),
        );
      }
    }
  }

  await new Promise<void>((resolve) => {
    const shutdown = async () => {
      console.log(pc.dim("\n正在关闭..."));
      await stop();
      if (fileServerStarted) stopFileServer();
      resolve();
    };
    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
  });
}
