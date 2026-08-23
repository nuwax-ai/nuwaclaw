/**
 * Loopback Gateway 编排：按 step1_config.nuwaxLoadMode（'direct' | 'gateway'，
 * 缺省 direct——不配置即完全维持现状）决定是否起网关；env NUWAX_LOOPBACK=1
 * 可强制开启（开发验收用）。
 *
 * 运行时真值写 settings 键 `nuwax.loopback` = { enabled, origin }：
 * renderer（NuwaxHostWebview）免新 IPC 面直接读，enabled 时 webview 从网关
 * origin 加载 nuwax。Bearer 注入源 = serverHost origin 名下的存量 token
 * （nuwax.accessToken.<origin>，与 nuwaxBridgeHandlers 同键空间）。
 */
import { app } from "electron";
import log from "electron-log";
import { readSetting, writeSetting } from "../../db";
import { DEFAULT_SERVER_HOST } from "@shared/constants";
import { NUWAX_TOKEN_KEY_PREFIX } from "../../ipc/nuwaxBridgeHandlers";
import { getConfiguredPorts } from "../startupPorts";
import { startLoopbackGateway, type LoopbackGatewayHandle } from "./gateway";

export const DEFAULT_LOOPBACK_GATEWAY_PORT = 46800;

/** dev 联调目标（与 renderer NUWAX_DEV_HOST 对齐）；可 env 覆盖。 */
const DEV_TARGET = "http://localhost:3000";

/** 运行时键（renderer 读；enabled=false 时同时用于清理残留）。 */
export const LOOPBACK_RUNTIME_KEY = "nuwax.loopback";

interface Step1GatewayFields {
  nuwaxLoadMode?: "direct" | "gateway";
  gatewayPort?: number;
  serverHost?: string;
}

let running: LoopbackGatewayHandle | undefined;

/** 网关是否处于启用态（step1 配置或 env 强制）。 */
export function isLoopbackGatewayEnabled(): boolean {
  if (process.env.NUWAX_LOOPBACK === "1") return true;
  const step1 = readSetting("step1_config") as Step1GatewayFields | null;
  return step1?.nuwaxLoadMode === "gateway";
}

/** 目标 origin：dev（未打包）联调 localhost:3000（NUWAX_LOOPBACK_TARGET 可覆盖）；
 *  生产反代 step1_config.serverHost / DEFAULT_SERVER_HOST。 */
function resolveTargetOrigin(): string {
  if (!app.isPackaged) {
    return process.env.NUWAX_LOOPBACK_TARGET || DEV_TARGET;
  }
  const step1 = readSetting("step1_config") as Step1GatewayFields | null;
  const raw = (step1?.serverHost || DEFAULT_SERVER_HOST)
    .trim()
    .replace(/\/+$/, "");
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;
}

/** serverHost origin 名下的 nuwax token（网关 Bearer 代注源）。 */
function serverHostTokenProvider(): () => string | null {
  return () => {
    try {
      const origin = new URL(resolveTargetOrigin()).origin;
      const value = readSetting(`${NUWAX_TOKEN_KEY_PREFIX}${origin}`);
      return typeof value === "string" && value ? value : null;
    } catch {
      return null;
    }
  };
}

/** 幂等启动：未启用时清运行时键并静默返回。失败仅告警，不阻断客户端启动。 */
export async function ensureLoopbackGateway(): Promise<
  LoopbackGatewayHandle | undefined
> {
  if (running) return running;
  if (!isLoopbackGatewayEnabled()) {
    writeSetting(LOOPBACK_RUNTIME_KEY, { enabled: false, origin: null });
    return undefined;
  }
  const step1 = readSetting("step1_config") as Step1GatewayFields | null;
  // 端口校验：配置值可能与服务端口族冲突（如误填 ttyd 默认口 60009——会反把
  // ttyd 挤掉）或越界，一律回落默认 46800 并告警。
  const configured = step1?.gatewayPort;
  let fixedPort = DEFAULT_LOOPBACK_GATEWAY_PORT;
  if (configured !== undefined) {
    const servicePorts = Object.values(getConfiguredPorts()).filter(
      (p): p is number => typeof p === "number",
    );
    if (
      !Number.isInteger(configured) ||
      configured < 1024 ||
      configured > 65535 ||
      servicePorts.includes(configured) ||
      configured === DEFAULT_LOOPBACK_GATEWAY_PORT + 1 // 46801 = nuwax-desktop 原型占用
    ) {
      log.warn(
        `[LoopbackGateway] gatewayPort=${configured} 非法/与服务端口冲突，回落 ${DEFAULT_LOOPBACK_GATEWAY_PORT}`,
      );
    } else {
      fixedPort = configured;
    }
  }
  try {
    running = await startLoopbackGateway({
      targetOrigin: resolveTargetOrigin(),
      fixedPort,
      getAccessToken: serverHostTokenProvider(),
    });
    writeSetting(LOOPBACK_RUNTIME_KEY, {
      enabled: true,
      origin: running.origin,
    });
    return running;
  } catch (e) {
    log.warn("[LoopbackGateway] start failed (non-fatal):", e);
    writeSetting(LOOPBACK_RUNTIME_KEY, { enabled: false, origin: null });
    return undefined;
  }
}

export async function stopLoopbackGateway(): Promise<void> {
  if (!running) return;
  const handle = running;
  running = undefined;
  await handle.close();
  writeSetting(LOOPBACK_RUNTIME_KEY, { enabled: false, origin: null });
  log.info("[LoopbackGateway] stopped");
}

export function loopbackGatewayStatus(): { running: boolean; origin?: string } {
  return running
    ? { running: true, origin: running.origin }
    : { running: false };
}
