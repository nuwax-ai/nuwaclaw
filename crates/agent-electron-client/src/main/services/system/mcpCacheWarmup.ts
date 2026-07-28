/**
 * MCP npx 缓存预热 — 启动期后台 best-effort
 *
 * 运行时 MCP server 以 `npx -y <pkg>@<spec>` 拉起，首包会现下载（慢、且可能因
 * registry/网络抖动失败），影响 agent 工具调用的高可用。本模块在启动时静默预热
 * `~/.nuwaclaw/npm-cache/_npx`，使运行时直接命中缓存、零网络、秒级拉起。
 *
 * 策略：spawn `npx -y <spec>` → 轮询 `_npx/<hash>/node_modules/<pkg>` 命中 → kill。
 * - 复用 getAppEnv() 与打包 node 的 npx（与运行时同 env、同 _npx 缓存位置，保证命中）
 * - 串行、每包超时 5min、best-effort 绝不抛错、绝不阻塞启动
 * - 幂等：标记文件 + isPackageInNpxCache 谓词双判（谓词为唯一真理，应对 GC 自愈）
 *
 * 必须在 maintainNpmPackageCache()（GC）之后执行，否则 GC 清掉 _npx 后预热白做。
 */

import { spawn } from "child_process";
import * as fs from "fs";
import * as path from "path";
import log from "electron-log";
import { getAppDataDir } from "./appPaths";
import { getAppEnv } from "./appEnv";
import { isWindows } from "./shellEnv";
import {
  getBundledNodeBinDir,
  getNodeBinPathWithFallback,
} from "./binaryLocator";
import { getNpmCacheDir } from "./npmCacheMaintenance";

/**
 * 预热目标包。
 * 注意：spec 字符串须与运行时实际下发的 spec 逐字一致，否则 npx 算出不同 _npx
 * hash、不命中。把本常量视为「合约」——后端 ACP context_servers 下发版本须对齐。
 */
export const MCP_WARMUP_SPECS = [
  "nuwax-ask-question-mcp@latest",
  "@nuwax-ai/openui-mcp@latest",
  "chrome-devtools-mcp@latest",
] as const;

/** 单包预热超时；chrome-devtools-mcp 体积较大，慢网/Win 首拉常 >60–90s */
export const MCP_WARMUP_PER_PKG_TIMEOUT_MS = 300_000;
export const MCP_WARMUP_POLL_INTERVAL_MS = 500;
const WARMUP_KILL_GRACE_MS = 3_000;
const WARMUP_STATE_FILENAME = ".mcp-npx-warmup.json";

export type McpCacheWarmupOptions = {
  /** 测试注入：自定义 spawn（返回 kill + onClose 句柄） */
  spawnNpx?: (
    pkgSpec: string,
    env: NodeJS.ProcessEnv,
  ) => {
    kill: (sig?: NodeJS.Signals) => void;
    onClose: Promise<number | null>;
  };
  /** 测试注入：判定包是否已入缓存（默认 isPackageInNpxCache） */
  isCached?: (npxDir: string, pkgName: string) => boolean;
  /** 测试注入：当前时间戳 */
  now?: () => number;
  /** 测试/调用方注入：app 版本（默认从 electron app 取） */
  appVersion?: string;
  /** 覆盖单包超时 */
  perPkgTimeoutMs?: number;
  /** 覆盖轮询间隔 */
  pollIntervalMs?: number;
  /** 覆盖 kill 优雅宽限 */
  killGraceMs?: number;
  /** 强制重预热，忽略标记/缓存命中 */
  force?: boolean;
};

export type McpCacheWarmupResult = {
  skipped: boolean;
  reason?: string;
  warmed: string[];
  failed: { spec: string; error: string }[];
  npxDir: string;
};

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * 从 spec 解析出包名：去 `@version`，保留 `@scope/name`。
 * - `nuwax-ask-question-mcp@latest` → `nuwax-ask-question-mcp`
 * - `@nuwax-ai/openui-mcp@latest`    → `@nuwax-ai/openui-mcp`
 */
export function pkgNameFromSpec(spec: string): string {
  if (spec.startsWith("@")) {
    const idx = spec.indexOf("@", 1);
    return idx === -1 ? spec : spec.slice(0, idx);
  }
  const idx = spec.lastIndexOf("@");
  return idx === -1 ? spec : spec.slice(0, idx);
}

/**
 * 扫描 `_npx/<hash>/node_modules/<pkg>` 判定包是否已入缓存。
 * 与 npx 内部 hash 算法无关——只要任一 hash 目录下有该包即视为命中。
 */
export function isPackageInNpxCache(npxDir: string, pkgName: string): boolean {
  if (!npxDir || !fs.existsSync(npxDir)) return false;
  let entries: string[];
  try {
    entries = fs.readdirSync(npxDir);
  } catch {
    return false;
  }
  for (const hash of entries) {
    if (fs.existsSync(path.join(npxDir, hash, "node_modules", pkgName))) {
      return true;
    }
  }
  return false;
}

/**
 * 解析预热用的 npx 命令。
 * 与运行时 mcp.ts 的 resolveNpmCliCommand 等价（自包含以保持 system 层不依赖
 * packages/mcp.ts，遵守分层方向）。返回 null 表示 node/npx 不可用，调用方应跳过。
 */
export function resolveWarmupNpxCommand(): {
  command: string;
  args: (spec: string) => string[];
} | null {
  const nodeBin = getNodeBinPathWithFallback();
  if (!nodeBin) return null;

  // 非 Windows：运行时直接用 PATH 上的 npx（getAppEnv PATH 优先打包 bin 目录）。
  // 保持与运行时一致是命中同一 _npx 缓存的关键。
  if (!isWindows()) {
    return { command: "npx", args: (spec) => ["-y", spec] };
  }

  // Windows：node.exe + npx-cli.js（避免 cmd.exe /c 脆弱引号，与运行时一致）
  const binDir = getBundledNodeBinDir() || path.dirname(nodeBin);
  const nodeExe = path.join(binDir, "node.exe");
  const cliJs = path.join(binDir, "node_modules", "npm", "bin", "npx-cli.js");
  if (fs.existsSync(nodeExe) && fs.existsSync(cliJs)) {
    return { command: nodeExe, args: (spec) => [cliJs, "-y", spec] };
  }
  return null;
}

type WarmupState = {
  appVersion: string;
  npxDir: string;
  specs: string[];
  warmedAt: number;
};

function getWarmupStatePath(): string {
  return path.join(getAppDataDir(), WARMUP_STATE_FILENAME);
}

function readWarmupState(): WarmupState | null {
  try {
    const p = getWarmupStatePath();
    if (!fs.existsSync(p)) return null;
    const data = JSON.parse(fs.readFileSync(p, "utf8"));
    if (
      typeof data?.appVersion === "string" &&
      typeof data?.npxDir === "string" &&
      Array.isArray(data?.specs)
    ) {
      return {
        appVersion: data.appVersion,
        npxDir: data.npxDir,
        specs: data.specs,
        warmedAt: typeof data.warmedAt === "number" ? data.warmedAt : 0,
      };
    }
    return null;
  } catch {
    return null;
  }
}

function writeWarmupState(state: WarmupState): void {
  try {
    fs.mkdirSync(getAppDataDir(), { recursive: true });
    fs.writeFileSync(getWarmupStatePath(), JSON.stringify(state), "utf8");
  } catch (err) {
    log.warn("[McpWarmup] Failed to write state file:", err);
  }
}

function getAppVersion(): string {
  try {
    // 动态 require 避免顶层 import electron（vitest 单测无需 mock electron）
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { app } = require("electron");
    return typeof app?.getVersion === "function" ? app.getVersion() : "0.0.0";
  } catch {
    return "0.0.0";
  }
}

function spawnNpxDefault(
  cmd: { command: string; args: (spec: string) => string[] },
  spec: string,
  env: NodeJS.ProcessEnv,
): { kill: (sig?: NodeJS.Signals) => void; onClose: Promise<number | null> } {
  const child = spawn(cmd.command, cmd.args(spec), {
    env,
    stdio: "ignore",
    windowsHide: true,
  });
  const onClose = new Promise<number | null>((resolve) => {
    child.on("close", (code) => resolve(code));
    child.on("error", () => resolve(null));
  });
  return { kill: (sig) => child.kill(sig), onClose };
}

/**
 * 预热单个 spec：spawn npx → 轮询缓存命中 → kill 常驻进程。
 * 返回 true 表示已入缓存；false 表示超时或进程异常退出且未命中。
 */
async function warmupOne(
  spec: string,
  pkgName: string,
  cmd: { command: string; args: (spec: string) => string[] },
  env: NodeJS.ProcessEnv,
  npxDir: string,
  opts: Required<
    Pick<
      McpCacheWarmupOptions,
      "isCached" | "now" | "perPkgTimeoutMs" | "pollIntervalMs" | "killGraceMs"
    >
  >,
  spawnNpx?: McpCacheWarmupOptions["spawnNpx"],
): Promise<boolean> {
  const handle = spawnNpx
    ? spawnNpx(spec, env)
    : spawnNpxDefault(cmd, spec, env);

  const deadline = opts.now() + opts.perPkgTimeoutMs;
  let closed = false;
  handle.onClose.then(() => {
    closed = true;
  });

  try {
    while (opts.now() < deadline) {
      if (opts.isCached(npxDir, pkgName)) return true; // 命中：下载已完成
      if (closed) return opts.isCached(npxDir, pkgName); // 进程已退出：再校验一次
      await sleep(opts.pollIntervalMs);
    }
    return false; // 超时
  } finally {
    // 无论命中/超时/退出，都收尾 kill 常驻子进程；SIGTERM → 宽限 → SIGKILL
    handle.kill("SIGTERM");
    await Promise.race([handle.onClose, sleep(opts.killGraceMs)]);
    handle.kill("SIGKILL"); // 已退出则 kill 为 no-op
  }
}

/**
 * 启动期后台预热 MCP npx 缓存。best-effort，绝不抛错。
 */
export async function warmupMcpNpxCache(
  options?: McpCacheWarmupOptions,
): Promise<McpCacheWarmupResult> {
  const npxDir = path.join(getNpmCacheDir(), "_npx");
  const env = getAppEnv();
  const isCached = options?.isCached ?? isPackageInNpxCache;
  const now = options?.now ?? Date.now;
  const perPkgTimeoutMs =
    options?.perPkgTimeoutMs ?? MCP_WARMUP_PER_PKG_TIMEOUT_MS;
  const pollIntervalMs = options?.pollIntervalMs ?? MCP_WARMUP_POLL_INTERVAL_MS;
  const killGraceMs = options?.killGraceMs ?? WARMUP_KILL_GRACE_MS;
  const appVersion = options?.appVersion ?? getAppVersion();
  const specs = [...MCP_WARMUP_SPECS];

  const empty = (
    reason: string,
    extra: Partial<McpCacheWarmupResult> = {},
  ): McpCacheWarmupResult => ({
    skipped: true,
    reason,
    warmed: [],
    failed: [],
    npxDir,
    ...extra,
  });

  const cmd = resolveWarmupNpxCommand();
  if (!cmd) return empty("npx unavailable");

  // 幂等：标记 + 缓存命中双判。谓词为唯一真理——标记只用于避免冗余 spawn；
  // 若 GC 删了 _npx（标记仍在），下次启动谓词检测到缺失会重新预热（自愈）。
  if (!options?.force) {
    const state = readWarmupState();
    const markerMatches =
      state?.appVersion === appVersion &&
      state.npxDir === npxDir &&
      specs.every((s) => state.specs.includes(s));
    if (
      markerMatches &&
      specs.every((s) => isCached(npxDir, pkgNameFromSpec(s)))
    ) {
      return empty("already warmed");
    }
  }

  const warmed: string[] = [];
  const failed: { spec: string; error: string }[] = [];

  // 串行预热：对 registry/CPU 友好、避免 _npx 锁竞争（仿 dependencyInstaller 队列）
  for (const spec of specs) {
    const pkgName = pkgNameFromSpec(spec);
    if (isCached(npxDir, pkgName)) {
      warmed.push(spec); // 已在缓存，记为成功
      continue;
    }
    try {
      const ok = await warmupOne(
        spec,
        pkgName,
        cmd,
        env,
        npxDir,
        {
          isCached,
          now,
          perPkgTimeoutMs,
          pollIntervalMs,
          killGraceMs,
        },
        options?.spawnNpx,
      );
      if (ok) warmed.push(spec);
      else failed.push({ spec, error: "timeout or not cached after spawn" });
    } catch (err) {
      failed.push({
        spec,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (failed.length === 0) {
    writeWarmupState({ appVersion, npxDir, specs: warmed, warmedAt: now() });
  }

  log.info(
    `[McpWarmup] done: warmed=${warmed.length}/${specs.length}, failed=${failed.length}` +
      (failed.length
        ? `, failedSpecs=${failed.map((f) => f.spec).join(",")}`
        : ""),
  );
  return { skipped: false, warmed, failed, npxDir };
}
