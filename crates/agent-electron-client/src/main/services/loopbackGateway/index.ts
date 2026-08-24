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
import { app, session, webContents } from "electron";
import log from "electron-log";
import * as fs from "fs";
import * as net from "net";
import * as path from "path";
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
  // 显式配置优先（设置里「本地化加速」开关落此键）；env 仅作未配置时的缺省
  const step1 = readSetting("step1_config") as Step1GatewayFields | null;
  if (step1?.nuwaxLoadMode)
    return step1.nuwaxLoadMode === "gateway";
  return process.env.NUWAX_LOOPBACK === "1";
}

/** 透明反代目标 origin：dev（未打包）联调 localhost:3000（NUWAX_LOOPBACK_TARGET
 *  可覆盖）；生产反代 step1_config.serverHost / DEFAULT_SERVER_HOST。 */
function resolveTargetOrigin(): string {
  if (!app.isPackaged) {
    return process.env.NUWAX_LOOPBACK_TARGET || DEV_TARGET;
  }
  return resolveBackendOrigin();
}

/** 后端 origin（dist 模式的 /api 反代目标与 Bearer 源）：一律真实后端
 *  （serverHost / DEFAULT_SERVER_HOST，NUWAX_LOOPBACK_TARGET 可覆盖）——
 *  dev 缺省的 localhost:3000 是 nuwax dev server，不是 API 后端。 */
function resolveBackendOrigin(): string {
  if (process.env.NUWAX_LOOPBACK_TARGET)
    return process.env.NUWAX_LOOPBACK_TARGET;
  const step1 = readSetting("step1_config") as Step1GatewayFields | null;
  const raw = (step1?.serverHost || DEFAULT_SERVER_HOST)
    .trim()
    .replace(/\/+$/, "");
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;
}

/** dist 目录解析：dev = 仓库根 nuwax/dist（子模块）；打包 = resources/nuwax-dist。 */
export function resolveNuwaxDistDir(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "nuwax-dist");
  }
  // dev：app path = crates/agent-electron-client → 仓库根/nuwax/dist
  return path.resolve(app.getAppPath(), "..", "..", "nuwax", "dist");
}

function distDirAvailable(): boolean {
  try {
    return fs.existsSync(path.join(resolveNuwaxDistDir(), "index.html"));
  } catch {
    return false;
  }
}

/** dist 模式开关：显式 env（dev 验收）或 nuwaxLoadMode='gateway' 且 dist 就绪。 */
function isDistModeEnabled(): boolean {
  if (process.env.NUWAX_LOOPBACK_DIST === "1") return true;
  const step1 = readSetting("step1_config") as Step1GatewayFields | null;
  return step1?.nuwaxLoadMode === "gateway" && distDirAvailable();
}

/** 网关 Bearer 代注源：跨候选键取 token（backend origin 键优先，网关 origin 键
 *  兜底）——与 nuwaxBridgeHandlers 的 nuwaxTokenScopes 同一候选空间；persistToken
 *  双写后两键恒新，兜底覆盖「直连时代存量 + 网关形态新登录」的过渡期。 */
function serverHostTokenProvider(backendOrigin: string): () => string | null {
  return () => {
    try {
      const candidates = [new URL(backendOrigin).origin];
      const loopback = readSetting(LOOPBACK_RUNTIME_KEY) as {
        enabled?: boolean;
        origin?: string | null;
      } | null;
      if (loopback?.enabled && loopback.origin)
        candidates.push(loopback.origin);
      for (const scope of [...new Set(candidates)]) {
        const value = readSetting(`${NUWAX_TOKEN_KEY_PREFIX}${scope}`);
        if (typeof value === "string" && value) return value;
      }
      return null;
    } catch {
      return null;
    }
  };
}

/** 本地目标判定：目标是本地 dev server 时无需网关（本地源不存在云端域绑定问题，
 *  直连即得原始 dev 体验——HMR 等不经代理层）。 */
function isLocalTarget(origin: string): boolean {
  try {
    const host = new URL(origin).hostname;
    return host === "localhost" || host === "127.0.0.1" || host === "::1";
  } catch {
    return false;
  }
}

/** TCP 可达性探测（dev：nuwax dev server 在线与否决定直连还是回落 dist）。 */
function isOriginReachable(origin: string, timeoutMs = 600): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const url = new URL(origin);
      const sock = net.connect(
        { port: Number(url.port) || 80, host: url.hostname },
        () => {
          sock.destroy();
          resolve(true);
        },
      );
      sock.setTimeout(timeoutMs, () => {
        sock.destroy();
        resolve(false);
      });
      sock.on("error", () => {
        sock.destroy();
        resolve(false);
      });
    } catch {
      resolve(false);
    }
  });
}

/** 幂等启动：未启用时清运行时键并静默返回。失败仅告警，不阻断客户端启动。
 *  形态优先级（dev 语义）：nuwax dev server 在线 → webview 直连（原始 dev 体验）；
 *  不在线且 dist 就绪 → dist 形态（子模块本地 nuwax，make electron-dev 随时可见
 *  完整客户端）；远程目标 → 透明反代。 */
export async function ensureLoopbackGateway(): Promise<
  LoopbackGatewayHandle | undefined
> {
  if (running) return running;
  if (!isLoopbackGatewayEnabled()) {
    writeSetting(LOOPBACK_RUNTIME_KEY, { enabled: false, origin: null });
    return undefined;
  }
  let distMode = isDistModeEnabled();
  const backendOrigin = resolveBackendOrigin();
  let targetOrigin = distMode ? backendOrigin : resolveTargetOrigin();
  if (!distMode && isLocalTarget(targetOrigin)) {
    if (await isOriginReachable(targetOrigin)) {
      log.info(
        `[LoopbackGateway] 目标为本地 dev server（${targetOrigin}），跳过网关——webview 直连`,
      );
      writeSetting(LOOPBACK_RUNTIME_KEY, { enabled: false, origin: null });
      return undefined;
    }
    if (distDirAvailable()) {
      // nuwax dev server 不在线：回落 dist 形态（显式 NUWAX_LOOPBACK_DIST 已在
      // 上方 isDistModeEnabled 命中；此处覆盖 dev 缺省目标为 dist）。
      distMode = true;
      targetOrigin = backendOrigin;
      log.info(
        `[LoopbackGateway] 本地 dev server 不在线，回落 dist 形态（子模块本地 nuwax）`,
      );
    } else {
      log.info(
        `[LoopbackGateway] 目标为本地 dev server（${targetOrigin}）且不在线、dist 未就绪——webview 直连（等待 nuwax dev server）`,
      );
      writeSetting(LOOPBACK_RUNTIME_KEY, { enabled: false, origin: null });
      return undefined;
    }
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
      targetOrigin,
      distDir: distMode ? resolveNuwaxDistDir() : undefined,
      fixedPort,
      getAccessToken: serverHostTokenProvider(backendOrigin),
    });
    if (distMode) {
      startAbsoluteUrlNormalization(running.origin, backendOrigin);
    }
    writeSetting(LOOPBACK_RUNTIME_KEY, {
      enabled: true,
      origin: running.origin,
      mode: running.mode,
    });
    return running;
  } catch (e) {
    log.warn("[LoopbackGateway] start failed (non-fatal):", e);
    writeSetting(LOOPBACK_RUNTIME_KEY, { enabled: false, origin: null });
    return undefined;
  }
}

/** 绝对 URL 归一（dist 模式）：nuwax 返回的后端绝对地址（fileProxyUrl 等）在页面
 *  fetch 时从回环 origin 直连后端域会撞 CORS——请求层重定向回网关 origin（同源，
 *  顺带享 Bearer/x-client-type 注入）。nuwax-desktop 已实证同款方案。 */
let normalizationActive = false;
function startAbsoluteUrlNormalization(
  gatewayOrigin: string,
  backendOrigin: string,
): void {
  try {
    const backend = new URL(backendOrigin);
    session.defaultSession.webRequest.onBeforeRequest(
      { urls: ["http://*/*", "https://*/*"] },
      (details, callback) => {
        const url = details.url;
        if (!url.startsWith(`${backend.origin}/`)) {
          callback({});
          return;
        }
        // 仅 webview guest（发起页 origin = 网关 origin）的绝对 URL 归一。
        // 壳 renderer（vite origin）直连后端的 API 不归一——壳 API 域名与后端
        // 同域时全量误伤：重定向进网关后后端回 ACAO=后端域 ≠ 壳 origin，
        // preflight 直接被 CORS 拦死（i18n/sandbox reg 等全挂）。
        let fromGuest = false;
        try {
          const wc = details.webContentsId
            ? webContents.fromId(details.webContentsId)
            : null;
          fromGuest =
            !!wc &&
            typeof wc.getURL() === "string" &&
            wc.getURL().startsWith(gatewayOrigin);
        } catch {
          /* webContents 可能已销毁——按非 guest 放行 */
        }
        if (fromGuest) {
          callback({
            redirectURL: gatewayOrigin + url.slice(backend.origin.length),
          });
          return;
        }
        callback({});
      },
    );
    normalizationActive = true;
    log.info(
      `[LoopbackGateway] 绝对 URL 归一 → ${gatewayOrigin}（${backend.origin}）`,
    );
  } catch (e) {
    log.warn("[LoopbackGateway] 绝对 URL 归一注册失败:", e);
  }
}

function stopAbsoluteUrlNormalization(): void {
  if (!normalizationActive) return;
  try {
    session.defaultSession.webRequest.onBeforeRequest(
      null as never,
      null as never,
    );
  } catch {
    /* 旧版签名差异时忽略（退出路径） */
  }
  normalizationActive = false;
}

export async function stopLoopbackGateway(): Promise<void> {
  if (!running) return;
  const handle = running;
  running = undefined;
  stopAbsoluteUrlNormalization();
  await handle.close();
  writeSetting(LOOPBACK_RUNTIME_KEY, { enabled: false, origin: null });
  log.info("[LoopbackGateway] stopped");
}

export function loopbackGatewayStatus(): {
  running: boolean;
  origin?: string;
  mode?: "dist" | "proxy";
} {
  return running
    ? { running: true, origin: running.origin, mode: running.mode }
    : { running: false };
}

/**
 * 配置变更后的网关刷新（settings 保存/restartAll 钩子调用）：
 * 停掉在跑实例 → 按当前配置重确保（direct 即停、gateway/dist 重起）→
 * 通知 renderer 重解析 webview URL（形态/后端/域名可能已变）。
 */
export async function refreshLoopbackGateway(): Promise<void> {
  await stopLoopbackGateway();
  await ensureLoopbackGateway();
  try {
    const { BrowserWindow } = require("electron") as typeof import("electron");
    const win = BrowserWindow.getAllWindows()[0];
    const loopback = readSetting(LOOPBACK_RUNTIME_KEY);
    win?.webContents.send("nuwax:loopback-changed", loopback);
  } catch {
    /* 窗口不存在时忽略 */
  }
}
