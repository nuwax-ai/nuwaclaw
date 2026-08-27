/**
 * 单元测试: mapAcpUpdateToEvents — plan 家族与 current_mode_update 映射
 */

import { describe, expect, it } from "vitest";
import { mapAcpUpdateToEvents } from "./acpUpdateMapper";

describe("mapAcpUpdateToEvents plan family", () => {
  it("plan：全量 entries 规范化为 message.part.updated(type=plan)", () => {
    const { events } = mapAcpUpdateToEvents(
      "ses-plan",
      {
        sessionUpdate: "plan",
        entries: [
          { content: "分析代码", priority: "high", status: "completed" },
          { content: "实现方案", priority: "low", status: "in_progress" },
          // 非法字段回落安全默认值
          { content: "验证", priority: "urgent", status: "failed" },
        ],
      } as never,
      "test",
    );

    expect(events).toEqual([
      {
        event: "message.part.updated",
        payload: {
          sessionId: "ses-plan",
          type: "plan",
          entries: [
            { content: "分析代码", priority: "high", status: "completed" },
            { content: "实现方案", priority: "low", status: "in_progress" },
            { content: "验证", priority: "medium", status: "pending" },
          ],
        },
      },
    ]);
  });

  it("plan_update 与 plan 同构（客户端全量替换语义）", () => {
    const { events } = mapAcpUpdateToEvents(
      "ses-plan",
      { sessionUpdate: "plan_update", entries: [] } as never,
      "test",
    );
    expect(events[0].payload).toEqual({
      sessionId: "ses-plan",
      type: "plan",
      entries: [],
    });
  });

  it("plan_removed 映射为 message.part.removed", () => {
    const { events } = mapAcpUpdateToEvents(
      "ses-plan",
      { sessionUpdate: "plan_removed" } as never,
      "test",
    );
    expect(events).toEqual([
      {
        event: "message.part.removed",
        payload: { sessionId: "ses-plan", type: "plan" },
      },
    ]);
  });

  it("current_mode_update 映射为 session.updated(modeId)", () => {
    const { events } = mapAcpUpdateToEvents(
      "ses-plan",
      {
        sessionUpdate: "current_mode_update",
        currentModeId: "default",
      } as never,
      "test",
    );
    expect(events).toEqual([
      {
        event: "session.updated",
        payload: { sessionId: "ses-plan", modeId: "default" },
      },
    ]);
  });

  it("current_mode_update 缺 mode id 时以 null 下发", () => {
    const { events } = mapAcpUpdateToEvents(
      "ses-plan",
      { sessionUpdate: "current_mode_update" } as never,
      "test",
    );
    expect(events[0].payload).toEqual({
      sessionId: "ses-plan",
      modeId: null,
    });
  });
});
