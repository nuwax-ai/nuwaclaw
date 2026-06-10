import { describe, expect, it } from "vitest";
import {
  normalizePermissionGatedToolUpdate,
  type PermissionGatedToolInputCache,
} from "./permissionGatedToolUpdate";

const rawInput = {
  schemaVersion: "custom.interactive.v1",
  requestId: "interactive-after-permission",
  revision: 1,
  title: "Need input",
  ui: { version: "nuwax.interaction.v1", presentation: "inline" },
};

describe("normalizePermissionGatedToolUpdate", () => {
  it("delays permission-gated interactive tool calls until the completed result", () => {
    const cache = new Map<string, PermissionGatedToolInputCache>();
    const result = normalizePermissionGatedToolUpdate(
      {
        _meta: {
          claudeCode: { toolName: "custom_interactive_tool" },
        },
        sessionUpdate: "tool_call",
        toolCallId: "tool-call-interactive-1",
        title: "custom_interactive_tool",
        status: "pending",
        rawInput,
      } as any,
      cache,
    );

    expect(result.delay).toBe(true);
    expect(cache.get("tool-call-interactive-1")).toEqual({
      rawInput,
      title: "custom_interactive_tool",
    });
  });

  it("adds cached rawInput to completed interactive tool results", () => {
    const cache = new Map<string, PermissionGatedToolInputCache>([
      [
        "tool-call-interactive-2",
        { rawInput, title: "custom_interactive_tool" },
      ],
    ]);
    const rawOutput = JSON.stringify({
      status: "pending",
      requestId: "interactive-after-permission",
      revision: 1,
    });
    const result = normalizePermissionGatedToolUpdate(
      {
        _meta: {
          claudeCode: { toolName: "custom_interactive_tool" },
        },
        sessionUpdate: "tool_call_update",
        toolCallId: "tool-call-interactive-2",
        status: "completed",
        rawOutput,
      } as any,
      cache,
    );

    expect(result).toMatchObject({
      delay: false,
      update: {
        toolCallId: "tool-call-interactive-2",
        status: "completed",
        title: "custom_interactive_tool",
        rawInput,
        rawOutput,
      },
    });
    expect(cache.has("tool-call-interactive-2")).toBe(false);
  });

  it("supports snake_case raw input/output fields", () => {
    const cache = new Map<string, PermissionGatedToolInputCache>();
    const pending = normalizePermissionGatedToolUpdate(
      {
        sessionUpdate: "tool_call_update",
        tool_call_id: "tool-call-interactive-3",
        status: "in_progress",
        raw_input: rawInput,
      } as any,
      cache,
    );
    const completed = normalizePermissionGatedToolUpdate(
      {
        sessionUpdate: "tool_call_update",
        tool_call_id: "tool-call-interactive-3",
        status: "completed",
        raw_output: "{}",
      } as any,
      cache,
    );

    expect(pending.delay).toBe(true);
    expect(completed).toMatchObject({
      delay: false,
      update: {
        tool_call_id: "tool-call-interactive-3",
        rawInput,
      },
    });
  });

  it("does not delay non-interactive tools", () => {
    const cache = new Map<string, PermissionGatedToolInputCache>();
    const update = {
      _meta: { claudeCode: { toolName: "Bash" } },
      sessionUpdate: "tool_call",
      toolCallId: "tool-call-bash",
      title: "Terminal",
      status: "pending",
      rawInput: { command: "pwd" },
    } as any;

    expect(normalizePermissionGatedToolUpdate(update, cache)).toEqual({
      update,
      delay: false,
    });
    expect(cache.size).toBe(0);
  });

  it("infers the title when releasing cached completed results", () => {
    const cache = new Map<string, PermissionGatedToolInputCache>();
    normalizePermissionGatedToolUpdate(
      {
        _meta: {
          claudeCode: { toolName: "mcp__ask-question__nuwax_ask_question" },
        },
        sessionUpdate: "tool_call_update",
        toolCallId: "tool-call-interactive-4",
        rawInput,
      } as any,
      cache,
    );

    const completed = normalizePermissionGatedToolUpdate(
      {
        _meta: {
          claudeCode: { toolName: "mcp__ask-question__nuwax_ask_question" },
        },
        sessionUpdate: "tool_call_update",
        toolCallId: "tool-call-interactive-4",
        status: "completed",
        rawOutput: "{}",
      } as any,
      cache,
    );

    expect(completed).toMatchObject({
      delay: false,
      update: {
        toolCallId: "tool-call-interactive-4",
        title: "mcp__ask-question__nuwax_ask_question",
        rawInput,
      },
    });
  });
});
