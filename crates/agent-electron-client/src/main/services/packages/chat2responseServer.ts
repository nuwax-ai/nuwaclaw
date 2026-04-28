import * as fs from "fs";
import * as path from "path";
import log from "electron-log";
import { ManagedProcess } from "../../processManager";
import { readSetting } from "../../db";
import { DEFAULT_CHAT2RESPONSE_PORT } from "@shared/constants";
import { getAppEnv, getChat2responseBundledDir } from "../system/dependencies";
import { isWindows } from "../system/shellEnv";
import { checkChat2responseHealth } from "./chat2responseHealth";

const chat2responseProcess = new ManagedProcess("chat2response");
let currentPort = DEFAULT_CHAT2RESPONSE_PORT;
type Chat2responseSource = "configured" | "bundled" | "path";
let currentSource: Chat2responseSource = "bundled";

function getDefaultBinCandidates(): string[] {
  return ["chat2response"];
}

function resolveBundledStartup(): {
  command: string;
  args: string[];
  cwd?: string;
} | null {
  const bundledDir = getChat2responseBundledDir();
  if (!bundledDir) return null;
  const pkgPath = path.join(bundledDir, "package.json");
  try {
    const pkgRaw = fs.readFileSync(pkgPath, "utf-8");
    const pkg = JSON.parse(pkgRaw) as {
      main?: string;
      bin?: string | Record<string, string>;
    };
    const binEntry =
      typeof pkg.bin === "string"
        ? pkg.bin
        : pkg.bin && typeof pkg.bin === "object"
          ? pkg.bin.chat2response || Object.values(pkg.bin)[0]
          : undefined;
    const entry = binEntry || pkg.main;
    if (!entry) return null;
    const entryPath = path.join(bundledDir, entry);
    if (!fs.existsSync(entryPath)) return null;
    // 统一用 node 执行 JS 入口，避免平台差异（shebang/可执行位/脚本后缀）导致启动失败。
    return {
      command: process.execPath,
      args: [entryPath],
      cwd: bundledDir,
    };
  } catch {
    return null;
  }
}

function resolveStartupPort(requestedPort?: number): number {
  if (requestedPort && Number.isInteger(requestedPort) && requestedPort > 0) {
    return requestedPort;
  }
  const settingsPort = readSetting("chat2response.port");
  if (
    typeof settingsPort === "number" &&
    Number.isInteger(settingsPort) &&
    settingsPort > 0
  ) {
    return settingsPort;
  }
  const envPort = Number(process.env.NUWAX_CHAT2RESPONSE_PORT || "");
  if (Number.isInteger(envPort) && envPort > 0) return envPort;
  return DEFAULT_CHAT2RESPONSE_PORT;
}

function resolveStartCommand(): {
  command: string;
  args: string[];
  cwd?: string;
  source: Chat2responseSource;
} | null {
  const configuredBinPath =
    (readSetting("chat2response.binPath") as string | null) ||
    process.env.NUWAX_CHAT2RESPONSE_BIN ||
    "";
  const configuredCwd =
    (readSetting("chat2response.cwd") as string | null) ||
    process.env.NUWAX_CHAT2RESPONSE_CWD ||
    undefined;

  if (configuredBinPath) {
    if (configuredBinPath.endsWith(".js")) {
      return {
        command: process.execPath,
        args: [configuredBinPath],
        cwd: configuredCwd,
        source: "configured",
      };
    }
    return {
      command: configuredBinPath,
      args: [],
      cwd: configuredCwd,
      source: "configured",
    };
  }

  const bundled = resolveBundledStartup();
  if (bundled) {
    return { ...bundled, source: "bundled" };
  }

  const candidates = getDefaultBinCandidates();
  for (const candidate of candidates) {
    if (candidate === "chat2response" || fs.existsSync(candidate)) {
      return { command: candidate, args: [], source: "path" };
    }
  }
  return null;
}

export function getChat2responseBaseUrl(port = currentPort): string {
  return `http://127.0.0.1:${port}/v1`;
}

export async function startChat2response(
  port?: number,
): Promise<{ success: boolean; error?: string }> {
  const startup = resolveStartCommand();
  if (!startup) {
    return {
      success: false,
      error:
        "chat2response start command not found. Prefer bundled resources/chat2response, or configure chat2response.binPath as fallback.",
    };
  }
  currentSource = startup.source;

  const resolvedPort = resolveStartupPort(port);
  currentPort = resolvedPort;
  const status = chat2responseProcess.status();
  if (status.running) {
    return { success: true };
  }

  const result = await chat2responseProcess.start({
    command: startup.command,
    args: startup.args,
    cwd: startup.cwd,
    env: {
      ...getAppEnv(),
      PORT: String(resolvedPort),
      CHAT2RESPONSE_PORT: String(resolvedPort),
      NODE_ENV: "production",
      ELECTRON_RUN_AS_NODE: "1",
    },
    startupDelayMs: 1500,
  });

  if (!result.success) return result;

  const health = await checkChat2responseHealth(resolvedPort);
  if (!health.healthy) {
    await stopChat2response();
    return {
      success: false,
      error: `chat2response health check failed: ${health.error || "unknown error"}`,
    };
  }

  log.info("[Chat2Response] started", {
    port: resolvedPort,
    baseUrl: getChat2responseBaseUrl(resolvedPort),
    source: currentSource,
    command: startup.command,
  });
  return { success: true };
}

export async function stopChat2response(): Promise<{
  success: boolean;
  error?: string;
}> {
  try {
    const result = await chat2responseProcess.stopAsync(3000);
    return { success: result.success };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

export function getChat2responseStatus(): {
  running: boolean;
  pid?: number;
  port: number;
  baseUrl: string;
  source: Chat2responseSource;
  error?: string;
} {
  const status = chat2responseProcess.status();
  return {
    ...status,
    port: currentPort,
    baseUrl: getChat2responseBaseUrl(currentPort),
    source: currentSource,
  };
}

export async function ensureChat2responseForEngine(
  engineType: string | null | undefined,
): Promise<void> {
  if (engineType === "codex-cli") {
    const result = await startChat2response();
    if (!result.success) {
      log.warn("[Chat2Response] auto-start failed for codex-cli", {
        error: result.error,
      });
    }
    return;
  }
  if (getChat2responseStatus().running) {
    await stopChat2response();
  }
}
