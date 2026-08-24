/**
 * 启动服务门禁（services gate）：核心本地服务就绪前壳层停在启动 loading，
 * 不挂 nuwax webview——避免页面首屏 API 抢跑产生「服务连接失败」类弹窗。
 *
 * 就绪判定（全部通过才放行）：
 * - Computer Server `/health`（agentPort，本机回环）——页面「我的电脑」/chat 类能力的地基；
 * - Loopback Gateway（启用时）origin 可达（任意 HTTP 响应即视为就绪——静态/反代
 *   目标不可达自有各自的引导页，这里只保证网关进程活着）。
 *
 * 超时（默认 30s）返回 ok:false + 未就绪项明细，壳层出错误屏 + 重试。
 */
import log from "electron-log";
import { readSetting } from "../db";
import { getConfiguredPorts } from "./startupPorts";

export interface ServicesGateResult {
  ok: boolean;
  /** 未就绪项明细（ok:false 时给 UI 展示） */
  detail: string[];
  elapsedMs: number;
}

/** 通用轮询：check 返回 null 表示未就绪继续等，非 null 即结果（抛错按未就绪处理）。 */
export async function pollUntil<T>(
  check: () => Promise<T | null>,
  opts: { intervalMs?: number; timeoutMs?: number } = {},
): Promise<T | null> {
  const interval = opts.intervalMs ?? 400;
  const deadline = Date.now() + (opts.timeoutMs ?? 30_000);
  // async 包装把同步 throw 也转成 reject，统一按未就绪处理
  const runCheck = async (): Promise<T | null> => {
    try {
      return await check();
    } catch {
      return null;
    }
  };
  for (;;) {
    const hit = await runCheck();
    if (hit !== null && hit !== undefined) return hit;
    if (Date.now() >= deadline) return null;
    await new Promise((r) => setTimeout(r, interval));
  }
}

async function urlResponds(url: string, timeoutMs = 1500): Promise<boolean> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    return res.status > 0;
  } catch {
    return false;
  }
}

/** 就绪检查一轮：返回未就绪项列表（空 = 就绪）。 */
async function checkOnce(): Promise<string[] | null> {
  const { agent } = getConfiguredPorts();
  const notReady: string[] = [];
  const computerOk = await urlResponds(`http://127.0.0.1:${agent}/health`);
  if (!computerOk) notReady.push(`Computer Server（端口 ${agent}）`);
  const loopback = readSetting("nuwax.loopback") as {
    enabled?: boolean;
    origin?: string | null;
  } | null;
  if (loopback?.enabled && loopback.origin) {
    const gwOk = await urlResponds(loopback.origin);
    if (!gwOk) notReady.push(`Loopback Gateway（${loopback.origin}）`);
  }
  return notReady;
}

/** 等待核心服务就绪（或超时）。超时时返回未就绪明细。 */
export async function runServicesGate(
  timeoutMs = 30_000,
): Promise<ServicesGateResult> {
  const start = Date.now();
  const notReady = await pollUntil(
    () => checkOnce().then((r) => (r.length === 0 ? [] : null)),
    {
      timeoutMs,
    },
  );
  // 超时后再查一轮拿明细
  const detail = notReady === null ? ((await checkOnce()) ?? ["未知"]) : [];
  const result: ServicesGateResult = {
    ok: notReady !== null,
    detail,
    elapsedMs: Date.now() - start,
  };
  log.info(
    `[ServicesGate] ${result.ok ? "ready" : "timeout"} in ${result.elapsedMs}ms${result.detail.length ? ` pending=[${result.detail.join(", ")}]` : ""}`,
  );
  return result;
}
