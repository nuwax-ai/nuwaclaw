import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

function writeJsonl(filePath: string, lines: unknown[]): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(
    filePath,
    lines.map((l) => JSON.stringify(l)).join("\n") + "\n",
  );
}

describe("parseClaudeTranscript", () => {
  it("extracts plain-string user turns and text+tool_use assistant turns, dropping thinking blocks", async () => {
    const dir = fs.mkdtempSync(
      path.join(os.tmpdir(), "nuwa-cli-transcript-test-"),
    );
    const file = path.join(dir, "s1.jsonl");
    writeJsonl(file, [
      {
        type: "user",
        message: { role: "user", content: "分析一下现状" },
      },
      {
        type: "assistant",
        message: {
          role: "assistant",
          content: [
            { type: "thinking", thinking: "让我想想", signature: "x" },
            { type: "text", text: "好的，我先看看代码。" },
            {
              type: "tool_use",
              id: "t1",
              name: "Read",
              input: { file_path: "/a.ts" },
            },
          ],
        },
      },
      {
        type: "user",
        message: {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "t1",
              content: [{ type: "text", text: "file contents..." }],
            },
          ],
        },
      },
      {
        type: "assistant",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "看完了，问题在这里。" }],
        },
      },
      { type: "mode", mode: "default" },
    ]);

    const { parseClaudeTranscript } =
      await import("../src/core/sessions/transcript.js");
    const { messages, hasMore } = await parseClaudeTranscript(file);

    expect(hasMore).toBe(false);
    expect(messages).toEqual([
      { role: "user", text: "分析一下现状" },
      {
        role: "assistant",
        text: "好的，我先看看代码。",
        toolCalls: ["Read"],
      },
      { role: "assistant", text: "看完了，问题在这里。" },
    ]);
  });

  it("drops a user turn that is purely a tool_result with no real text", async () => {
    const dir = fs.mkdtempSync(
      path.join(os.tmpdir(), "nuwa-cli-transcript-test-"),
    );
    const file = path.join(dir, "s2.jsonl");
    writeJsonl(file, [
      {
        type: "user",
        message: {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "t1",
              content: [{ type: "text", text: "output" }],
            },
          ],
        },
      },
    ]);
    const { parseClaudeTranscript } =
      await import("../src/core/sessions/transcript.js");
    const { messages } = await parseClaudeTranscript(file);
    expect(messages).toEqual([]);
  });

  it("applies limit (keeps the most recent N) and order", async () => {
    const dir = fs.mkdtempSync(
      path.join(os.tmpdir(), "nuwa-cli-transcript-test-"),
    );
    const file = path.join(dir, "s3.jsonl");
    writeJsonl(file, [
      { type: "user", message: { role: "user", content: "第一条" } },
      { type: "user", message: { role: "user", content: "第二条" } },
      { type: "user", message: { role: "user", content: "第三条" } },
    ]);
    const { parseClaudeTranscript } =
      await import("../src/core/sessions/transcript.js");

    const limited = await parseClaudeTranscript(file, { limit: 2 });
    expect(limited.hasMore).toBe(true);
    expect(limited.messages.map((m) => m.text)).toEqual(["第二条", "第三条"]);

    const desc = await parseClaudeTranscript(file, {
      limit: 2,
      order: "desc",
    });
    expect(desc.messages.map((m) => m.text)).toEqual(["第三条", "第二条"]);
  });

  it("does not crash on malformed lines and skips lines with no message field", async () => {
    const dir = fs.mkdtempSync(
      path.join(os.tmpdir(), "nuwa-cli-transcript-test-"),
    );
    const file = path.join(dir, "s4.jsonl");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      file,
      [
        "not json at all",
        JSON.stringify({ type: "queue-operation", operation: "enqueue" }),
        JSON.stringify({
          type: "user",
          message: { role: "user", content: "还活着" },
        }),
      ].join("\n") + "\n",
    );
    const { parseClaudeTranscript } =
      await import("../src/core/sessions/transcript.js");
    const { messages } = await parseClaudeTranscript(file);
    expect(messages).toEqual([{ role: "user", text: "还活着" }]);
  });
});

describe("parseCodexTranscript", () => {
  it("extracts user/assistant message text, drops developer role, maps function_call/custom_tool_call to toolCalls", async () => {
    const dir = fs.mkdtempSync(
      path.join(os.tmpdir(), "nuwa-cli-transcript-test-"),
    );
    const file = path.join(dir, "rollout-1.jsonl");
    writeJsonl(file, [
      { type: "session_meta", payload: { session_id: "k1", cwd: "/p" } },
      {
        type: "response_item",
        payload: {
          type: "message",
          role: "developer",
          content: [{ type: "input_text", text: "<permissions instructions>" }],
        },
      },
      {
        type: "response_item",
        payload: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "帮我修一下这个 bug" }],
        },
      },
      {
        type: "response_item",
        payload: {
          type: "reasoning",
          summary: [],
          encrypted_content: "abc",
        },
      },
      {
        type: "response_item",
        payload: {
          type: "function_call",
          name: "exec_command",
          arguments: '{"cmd":"pwd"}',
          call_id: "call_1",
        },
      },
      {
        type: "response_item",
        payload: {
          type: "function_call_output",
          call_id: "call_1",
          output: "/p",
        },
      },
      {
        type: "response_item",
        payload: {
          type: "custom_tool_call",
          name: "apply_patch",
          input: "*** Begin Patch",
          call_id: "call_2",
        },
      },
      {
        type: "response_item",
        payload: {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: "修好了。" }],
        },
      },
      { type: "turn_context", payload: { cwd: "/p" } },
    ]);

    const { parseCodexTranscript } =
      await import("../src/core/sessions/transcript.js");
    const { messages, hasMore } = await parseCodexTranscript(file);

    expect(hasMore).toBe(false);
    expect(messages).toEqual([
      { role: "user", text: "帮我修一下这个 bug" },
      { role: "assistant", text: "", toolCalls: ["exec_command"] },
      { role: "assistant", text: "", toolCalls: ["apply_patch"] },
      { role: "assistant", text: "修好了。" },
    ]);
  });

  it("does not crash on malformed lines", async () => {
    const dir = fs.mkdtempSync(
      path.join(os.tmpdir(), "nuwa-cli-transcript-test-"),
    );
    const file = path.join(dir, "rollout-2.jsonl");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      file,
      [
        "not json",
        JSON.stringify({
          type: "response_item",
          payload: {
            type: "message",
            role: "user",
            content: [{ type: "input_text", text: "还活着" }],
          },
        }),
      ].join("\n") + "\n",
    );
    const { parseCodexTranscript } =
      await import("../src/core/sessions/transcript.js");
    const { messages } = await parseCodexTranscript(file);
    expect(messages).toEqual([{ role: "user", text: "还活着" }]);
  });
});
