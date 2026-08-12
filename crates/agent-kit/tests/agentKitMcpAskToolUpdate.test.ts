import { describe, expect, it } from "vitest";
import { normalizeMcpAskToolUpdate } from "../src/mcpAskToolUpdate.js";

const canonicalInput = {
  toolName: "nuwax_ask_question",
  schemaVersion: "nuwax.mcp_ask.v2",
  requestId: "ask_demo_1",
  revision: 1,
  sessionId: "demo-session",
  title: "ask-question 演示",
  ui: {
    version: "nuwax.interaction.v2",
    presentation: "inline",
    title: "ask-question 演示",
    fields: [{ name: "choice", title: "请选择", widget: "radio" }],
  },
};

describe("normalizeMcpAskToolUpdate", () => {
  it("unwraps Codex MCP arguments for the initial tool_call", () => {
    const update = normalizeMcpAskToolUpdate({
      sessionUpdate: "tool_call",
      toolCallId: "call-codex",
      title: "mcp.ask-question.nuwax_ask_question",
      rawInput: {
        server: "ask-question",
        tool: "nuwax_ask_question",
        arguments: { ...canonicalInput, toolName: undefined },
      },
    });

    expect(update.rawInput).toMatchObject(canonicalInput);
  });

  it("prefers Codex completed structuredContent.input", () => {
    const update = normalizeMcpAskToolUpdate({
      sessionUpdate: "tool_call_update",
      toolCallId: "call-codex",
      status: "completed",
      rawInput: {
        server: "ask-question",
        tool: "nuwax_ask_question",
        arguments: { requestId: "agent-shape" },
      },
      rawOutput: {
        result: {
          structuredContent: { status: "pending", input: canonicalInput },
        },
      },
    });

    expect(update.rawInput).toEqual(canonicalInput);
  });

  it("extracts Claude MCP canonical input from JSON rawOutput", () => {
    const update = normalizeMcpAskToolUpdate({
      sessionUpdate: "tool_call_update",
      toolCallId: "call-claude",
      status: "completed",
      _meta: {
        claudeCode: {
          toolName: "mcp__ask-question__nuwax_ask_question",
        },
      },
      rawOutput: JSON.stringify({ status: "pending", input: canonicalInput }),
    });

    expect(update.rawInput).toEqual(canonicalInput);
  });

  it("stamps omitted v2 discriminator fields on Claude initial input", () => {
    const { toolName: _toolName, schemaVersion: _schemaVersion, ui, ...input } =
      canonicalInput;
    const { version: _version, ...uiWithoutVersion } = ui;
    const update = normalizeMcpAskToolUpdate({
      sessionUpdate: "tool_call",
      toolCallId: "call-claude",
      title: "mcp__ask-question__nuwax_ask_question",
      rawInput: { ...input, ui: uiWithoutVersion },
    });

    expect(update.rawInput).toMatchObject(canonicalInput);
  });

  it("keeps snake_case raw_input in sync", () => {
    const update = normalizeMcpAskToolUpdate({
      sessionUpdate: "tool_call",
      tool_call_id: "call-snake",
      title: "mcp__ask-question__nuwax_ask_question",
      raw_input: { ...canonicalInput, toolName: undefined },
    });

    expect(update.raw_input).toMatchObject(canonicalInput);
    expect(update.rawInput).toEqual(update.raw_input);
  });

  it("does not mutate unrelated tool updates", () => {
    const original = {
      sessionUpdate: "tool_call",
      toolCallId: "call-bash",
      title: "Bash",
      rawInput: { command: "pnpm test" },
    };

    expect(normalizeMcpAskToolUpdate(original)).toBe(original);
  });
});
