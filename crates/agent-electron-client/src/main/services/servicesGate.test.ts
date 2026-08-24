/**
 * 单元测试: servicesGate 的 pollUntil（启动服务门禁的轮询内核）
 */

import { describe, it, expect, vi } from "vitest";

vi.mock("electron-log", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../db", () => ({ readSetting: vi.fn(() => null) }));
vi.mock("./startupPorts", () => ({
  getConfiguredPorts: vi.fn(() => ({ agent: 60006 })),
}));

import { pollUntil } from "./servicesGate";

describe("pollUntil（服务门禁轮询）", () => {
  it("立即命中：首轮即返回", async () => {
    const r = await pollUntil(async () => "hit", { intervalMs: 10 });
    expect(r).toBe("hit");
  });

  it("延迟命中：第 3 轮通过", async () => {
    let n = 0;
    const r = await pollUntil(
      async () => {
        n += 1;
        return n >= 3 ? "ok" : null;
      },
      { intervalMs: 10, timeoutMs: 2000 },
    );
    expect(r).toBe("ok");
    expect(n).toBe(3);
  });

  it("超时返回 null（不抛错）", async () => {
    const r = await pollUntil(async () => null, {
      intervalMs: 10,
      timeoutMs: 50,
    });
    expect(r).toBeNull();
  });

  it("check 抛错按未就绪处理，不中断轮询", async () => {
    let n = 0;
    const r = await pollUntil(
      () => {
        n += 1;
        if (n === 1) throw new Error("boom");
        return "recovered";
      },
      { intervalMs: 10, timeoutMs: 2000 },
    );
    expect(r).toBe("recovered");
    expect(n).toBe(2);
  });
});
