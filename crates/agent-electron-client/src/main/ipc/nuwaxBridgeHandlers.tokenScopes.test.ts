/**
 * 单元测试: nuwaxBridgeHandlers 的 token 键空间统一（nuwaxTokenScopes 三路共用）
 *
 * 回归背景（审查实证的键空间分裂 bug）：
 * - persistToken 单写 sender 键，网关 Bearer 代注源读 serverHost 键 → 网关形态
 *   新登录代注拿空/陈旧 token；
 * - clear 单清 sender 键，getToken 回退链又从 serverHost 键复活过期 token →
 *   401 → clear → 复活死循环。
 * 修复后三路（getToken 回退 / persistToken 双写 / clear 全清）共享 nuwaxTokenScopes。
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const settings = new Map<string, unknown>();
const handlers = new Map<
  string,
  (event: unknown, ...args: unknown[]) => unknown
>();
const emitters = new Map<string, ((...args: unknown[]) => void)[]>();
let mainWindowSender: ((channel: string, payload: unknown) => void) | undefined;

vi.mock("electron", () => ({
  ipcMain: {
    handle: (
      channel: string,
      fn: (event: unknown, ...a: unknown[]) => unknown,
    ) => {
      handlers.set(channel, fn);
    },
    on: (channel: string, fn: (...a: unknown[]) => void) => {
      const list = emitters.get(channel) ?? [];
      list.push(fn);
      emitters.set(channel, list);
    },
  },
  dialog: {},
  net: {},
  BrowserWindow: class {},
}));

vi.mock("electron-log", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../db", () => ({
  readSetting: (key: string) => settings.get(key) ?? null,
  writeSetting: (key: string, value: unknown) => {
    settings.set(key, value);
  },
}));

vi.mock("./processHandlers", () => ({
  stopAllServicesNow: vi.fn(async () => undefined),
  restartAllServicesNow: vi.fn(async () => undefined),
  isAnyCoreServiceRunning: vi.fn(() => true),
}));

import {
  registerNuwaxBridgeHandlers,
  NUWAX_TOKEN_KEY_PREFIX,
} from "./nuwaxBridgeHandlers";

const GW_ORIGIN = "http://127.0.0.1:46800";
const HOST_ORIGIN = "https://testagent.xspaceagi.com";

function senderEvent(origin: string): { senderFrame: { url: string } } {
  return { senderFrame: { url: `${origin}/home` } };
}

beforeEach(() => {
  settings.clear();
  handlers.clear();
  emitters.clear();
  mainWindowSender = undefined;
  registerNuwaxBridgeHandlers({
    getMainWindow: () =>
      ({
        webContents: {
          send: (c: string, p: unknown) => mainWindowSender?.(c, p),
        },
      }) as never,
  } as never);
  settings.set("step1_config", { serverHost: HOST_ORIGIN });
  settings.set("nuwax.loopback", { enabled: true, origin: GW_ORIGIN });
});

describe("token 键空间统一（网关形态）", () => {
  it("getToken：sender 键为空 → serverHost 键回退并回写 sender 键", async () => {
    settings.set(`${NUWAX_TOKEN_KEY_PREFIX}${HOST_ORIGIN}`, "OLD-TOKEN");
    const token = (await handlers.get("auth:getToken")!(
      senderEvent(GW_ORIGIN),
    )) as string;
    expect(token).toBe("OLD-TOKEN");
    expect(settings.get(`${NUWAX_TOKEN_KEY_PREFIX}${GW_ORIGIN}`)).toBe(
      "OLD-TOKEN",
    );
  });

  it("persistToken：双写 sender + serverHost（网关键）——代注源不再拿空/陈旧", async () => {
    settings.set(`${NUWAX_TOKEN_KEY_PREFIX}${HOST_ORIGIN}`, "STALE");
    const ok = (await handlers.get("auth:persistToken")!(
      senderEvent(GW_ORIGIN),
      "FRESH",
    )) as boolean;
    expect(ok).toBe(true);
    expect(settings.get(`${NUWAX_TOKEN_KEY_PREFIX}${GW_ORIGIN}`)).toBe("FRESH");
    expect(settings.get(`${NUWAX_TOKEN_KEY_PREFIX}${HOST_ORIGIN}`)).toBe(
      "FRESH",
    );
  });

  it("clear：全清候选键——过期 token 不被回退链复活（死循环修复）", async () => {
    settings.set(`${NUWAX_TOKEN_KEY_PREFIX}${GW_ORIGIN}`, "EXPIRED");
    settings.set(`${NUWAX_TOKEN_KEY_PREFIX}${HOST_ORIGIN}`, "EXPIRED");
    await handlers.get("auth:clear")!(senderEvent(GW_ORIGIN));
    expect(settings.get(`${NUWAX_TOKEN_KEY_PREFIX}${GW_ORIGIN}`)).toBeNull();
    expect(settings.get(`${NUWAX_TOKEN_KEY_PREFIX}${HOST_ORIGIN}`)).toBeNull();
    // 清后再取：回退链无键可复活
    const again = await handlers.get("auth:getToken")!(senderEvent(GW_ORIGIN));
    expect(again).toBeNull();
  });
});
