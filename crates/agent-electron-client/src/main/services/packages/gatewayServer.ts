import * as fs from "fs";
import * as path from "path";
import log from "electron-log";
import { ManagedProcess } from "../../processManager";
import { readSetting } from "../../db";
import { DEFAULT_GATEWAY_PORT } from "@shared/constants";
import { getAppEnv, getGatewayBundledDir } from "../system/dependencies";
import { checkGatewayHealth } from "./gatewayHealth";

const gatewayProcess = new ManagedProcess("gateway");
let currentPort = DEFAULT_GATEWAY_PORT;
type GatewaySource = "configured" | "bundled" | "path";
let currentSource: GatewaySource = "bundled";

function resolveBundledStartup(): {
  command: string;
  args: string[];
  cwd?: string;
} | null {
  const bundledDir = getGatewayBundledDir();
  if (!bundledDir) return null;
  const pkgPath = path.join(bundledDir, "package.json");
  try {
    const pkgRaw = fs.readFileSync(pkgPath, "utf-8");
    const pkg = JSON.parse(pkgRaw) as {
      main?: string;
      bin?: string | Record<string, string>;
    };
    let entry = "";
    if (typeof pkg.bin === "string") {
      entry = pkg.bin;
    } else if (pkg.bin && typeof pkg.bin === "object") {
      entry = pkg.bin["gateway-server"] || Object.values(pkg.bin)[0] || "";
    }
    if (!entry && pkg.main) entry = pkg.main;
    if (!entry) return null;
    const entryPath = path.join(bundledDir, entry);
    if (!fs.existsSync(entryPath)) return null;
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
  const settingsPort = readSetting("gateway.port");
  if (
    typeof settingsPort === "number" &&
    Number.isInteger(settingsPort) &&
    settingsPort > 0
  ) {
    return settingsPort;
  }
  const step1 = readSetting("step1_config") as {
    gatewayPort?: number;
  } | null;
  if (
    step1?.gatewayPort &&
    Number.isInteger(step1.gatewayPort) &&
    step1.gatewayPort > 0
  ) {
    return step1.gatewayPort;
  }
  const envPort = Number(process.env.NUWAX_GATEWAY_PORT || "");
  if (Number.isInteger(envPort) && envPort > 0) return envPort;
  return DEFAULT_GATEWAY_PORT;
}

function resolveStartCommand(): {
  command: string;
  args: string[];
  cwd?: string;
  source: GatewaySource;
} | null {
  const configuredBinPath =
    (readSetting("gateway.binPath") as string | null) ||
    process.env.NUWAX_GATEWAY_BIN ||
    "";
  const configuredCwd =
    (readSetting("gateway.cwd") as string | null) ||
    process.env.NUWAX_GATEWAY_CWD ||
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

  if (fs.existsSync("gateway-server")) {
    return { command: "gateway-server", args: [], source: "path" };
  }
  return null;
}

export function getGatewayBaseUrl(port = currentPort): string {
  return `http://127.0.0.1:${port}/chat2response/v1`;
}

export async function startGateway(
  port?: number,
  credentials?: { apiKey?: string; baseUrl?: string; model?: string },
): Promise<{ success: boolean; error?: string }> {
  const startup = resolveStartCommand();
  if (!startup) {
    return {
      success: false,
      error:
        "gateway start command not found. Prefer bundled resources/gateway, or configure gateway.binPath as fallback.",
    };
  }
  currentSource = startup.source;

  const resolvedPort = resolveStartupPort(port);
  currentPort = resolvedPort;
  const status = gatewayProcess.status();
  const hasRuntimeConfig = !!(
    credentials?.apiKey ||
    credentials?.baseUrl ||
    credentials?.model
  );
  if (status.running) {
    if (!hasRuntimeConfig) {
      return { success: true };
    }
    log.info("[Gateway] restarting to apply new runtime config");
    await gatewayProcess.stopAsync(3000);
  }

  const resourcesDir = getGatewayBundledDir() || "";

  const result = await gatewayProcess.start({
    command: startup.command,
    args: startup.args,
    cwd: startup.cwd,
    env: {
      ...getAppEnv(),
      GATEWAY_PORT: String(resolvedPort),
      GATEWAY_RESOURCES_DIR: resourcesDir,
      PORT: String(resolvedPort),
      NODE_ENV: "production",
      ELECTRON_RUN_AS_NODE: "1",
      ...(credentials?.apiKey
        ? {
            DEEPSEEK_API_KEY: credentials.apiKey,
            CODEX_API_KEY: credentials.apiKey,
            OPENAI_API_KEY: credentials.apiKey,
          }
        : {}),
      ...(credentials?.baseUrl ? { OPENAI_BASE_URL: credentials.baseUrl } : {}),
      ...(credentials?.model
        ? { CODEX_MODEL: credentials.model, OPENAI_MODEL: credentials.model }
        : {}),
    },
    startupDelayMs: 1500,
  });

  if (!result.success) return result;

  const health = await checkGatewayHealth(resolvedPort);
  if (!health.healthy) {
    await stopGateway();
    return {
      success: false,
      error: `gateway health check failed: ${health.error || "unknown error"}`,
    };
  }

  log.info("[Gateway] started", {
    port: resolvedPort,
    baseUrl: getGatewayBaseUrl(resolvedPort),
    source: currentSource,
    command: startup.command,
    plugins: health.plugins
      ? Object.keys(health.plugins).join(", ")
      : "unknown",
  });
  return { success: true };
}

export async function stopGateway(): Promise<{
  success: boolean;
  error?: string;
}> {
  try {
    const result = await gatewayProcess.stopAsync(3000);
    return { success: result.success };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

export function getGatewayStatus(): {
  running: boolean;
  pid?: number;
  port: number;
  baseUrl: string;
  source: GatewaySource;
  error?: string;
} {
  const status = gatewayProcess.status();
  return {
    ...status,
    port: currentPort,
    baseUrl: getGatewayBaseUrl(currentPort),
    source: currentSource,
  };
}

export async function ensureGatewayForEngine(
  engineType: string | null | undefined,
  credentials?: { apiKey?: string; baseUrl?: string; model?: string },
): Promise<void> {
  if (engineType === "codex-cli") {
    const result = await startGateway(undefined, credentials);
    if (!result.success) {
      log.warn("[Gateway] auto-start failed for codex-cli", {
        error: result.error,
      });
    }
    return;
  }
  if (getGatewayStatus().running) {
    await stopGateway();
  }
}
