/**
 * 手动启动服务流程单测：断言「先 reg 再启动」的调用顺序。
 * 对应 L7：启动代理服务前必须调用 /reg，保证 lanproxy 使用最新 serverHost/serverPort。
 */

import { describe, it, expect, vi } from "vitest";
import { runManualStartService } from "./startServiceFlow";

describe("runManualStartService", () => {
  it("应先调用 syncConfigToServer，再调用 startService（key=lanproxy）", async () => {
    const callOrder: string[] = [];
    const sync = vi.fn().mockImplementation(async () => {
      callOrder.push("sync");
    });
    const start = vi.fn().mockImplementation(async () => {
      callOrder.push("start");
    });

    await runManualStartService(
      "lanproxy",
      {
        syncConfigToServer: sync,
        startService: start,
      },
      // 不传 callbacks，测试基本流程
    );

    expect(sync).toHaveBeenCalledWith({ suppressToast: true });
    expect(start).toHaveBeenCalledWith("lanproxy");
    expect(callOrder).toEqual(["sync", "start"]);
  });

  it("其他 key 同样保持先 reg 再 startService 的顺序", async () => {
    const callOrder: string[] = [];
    const sync = vi.fn().mockImplementation(async () => {
      callOrder.push("sync");
    });
    const start = vi.fn().mockImplementation(async () => {
      callOrder.push("start");
    });

    await runManualStartService("agent", {
      syncConfigToServer: sync,
      startService: start,
    });

    expect(callOrder).toEqual(["sync", "start"]);
    expect(start).toHaveBeenCalledWith("agent");
  });

  it("callbacks 应在 reg 调用期间触发", async () => {
    const callOrder: string[] = [];
    const sync = vi.fn().mockImplementation(async () => {
      callOrder.push("sync");
    });
    const start = vi.fn().mockImplementation(async () => {
      callOrder.push("start");
    });

    await runManualStartService(
      "lanproxy",
      {
        syncConfigToServer: sync,
        startService: start,
      },
      {
        onRegStart: () => callOrder.push("regStart"),
        onRegEnd: () => callOrder.push("regEnd"),
      },
    );

    // regStart < sync < regEnd < start
    expect(callOrder).toEqual(["regStart", "sync", "regEnd", "start"]);
  });

  it("reg 失败时仍应调用 onRegEnd", async () => {
    const callOrder: string[] = [];
    const sync = vi.fn().mockRejectedValue(new Error("reg failed"));
    const start = vi.fn().mockImplementation(async () => {
      callOrder.push("start");
    });

    await expect(
      runManualStartService(
        "lanproxy",
        {
          syncConfigToServer: sync,
          startService: start,
        },
        {
          onRegStart: () => callOrder.push("regStart"),
          onRegEnd: () => callOrder.push("regEnd"),
        },
      ),
    ).rejects.toThrow("reg failed");

    expect(callOrder).toEqual(["regStart", "regEnd"]);
    expect(start).not.toHaveBeenCalled();
  });
});
