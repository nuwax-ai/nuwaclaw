import { describe, expect, it } from "vitest";
import {
  classifySessionUpdate,
  normalizePlanEntries,
} from "../src/sessionUpdate.js";

describe("normalizePlanEntries", () => {
  it("keeps canonical ACP entries untouched", () => {
    expect(
      normalizePlanEntries([
        {
          content: "Analyze the codebase",
          priority: "high",
          status: "in_progress",
        },
      ]),
    ).toEqual([
      { content: "Analyze the codebase", priority: "high", status: "in_progress" },
    ]);
  });

  it("coerces unknown status/priority to safe defaults", () => {
    expect(
      normalizePlanEntries([
        { content: "Legacy", priority: "urgent", status: "failed" },
      ]),
    ).toEqual([{ content: "Legacy", priority: "medium", status: "pending" }]);
  });

  it("drops non-object members and tolerates non-arrays", () => {
    expect(normalizePlanEntries(["oops", null, { content: "ok" }])).toEqual([
      { content: "ok", priority: "medium", status: "pending" },
    ]);
    expect(normalizePlanEntries(undefined)).toEqual([]);
    expect(normalizePlanEntries("plan")).toEqual([]);
  });
});

describe("classifySessionUpdate", () => {
  it("classifies plan updates with full replacement entries", () => {
    const result = classifySessionUpdate({
      sessionUpdate: "plan",
      entries: [{ content: "Step 1", priority: "high", status: "completed" }],
    });
    expect(result.kind).toBe("plan");
    expect(result.plan).toEqual({
      entries: [
        { content: "Step 1", priority: "high", status: "completed" },
      ],
      removed: false,
    });
  });

  it("classifies plan_update the same as plan", () => {
    const result = classifySessionUpdate({
      sessionUpdate: "plan_update",
      entries: [],
    });
    expect(result.plan).toEqual({ entries: [], removed: false });
  });

  it("classifies plan_removed", () => {
    const result = classifySessionUpdate({ sessionUpdate: "plan_removed" });
    expect(result.plan).toEqual({ entries: [], removed: true });
  });

  it("classifies current_mode_update", () => {
    const result = classifySessionUpdate({
      sessionUpdate: "current_mode_update",
      currentModeId: "plan",
    });
    expect(result.modeChange).toEqual({ modeId: "plan" });
  });

  it("tolerates legacy modeId spelling in current_mode_update", () => {
    const result = classifySessionUpdate({
      sessionUpdate: "current_mode_update",
      modeId: "plan",
    });
    expect(result.modeChange).toEqual({ modeId: "plan" });
  });

  it("tolerates current_mode_update without a mode id", () => {
    const result = classifySessionUpdate({ sessionUpdate: "current_mode_update" });
    expect(result.modeChange).toEqual({ modeId: null });
  });

  it("passes unrelated kinds through with kind only", () => {
    expect(classifySessionUpdate({ sessionUpdate: "agent_message_chunk" })).toEqual(
      { kind: "agent_message_chunk" },
    );
    expect(classifySessionUpdate({})).toEqual({ kind: "unknown" });
  });
});
