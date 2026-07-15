import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

let tmpHome: string;

vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof os>();
  return { ...actual, homedir: () => tmpHome };
});

function writeClaudeSession(id: string, lines: unknown[]): void {
  const projectDir = path.join(tmpHome, ".claude", "projects", "-p");
  fs.mkdirSync(projectDir, { recursive: true });
  fs.writeFileSync(
    path.join(projectDir, `${id}.jsonl`),
    lines.map((line) => JSON.stringify(line)).join("\n") + "\n",
  );
}

describe("context commands", () => {
  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "nuwa-cli-context-test-"));
    vi.resetModules();
  });

  afterEach(() => {
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  it("context read prints normalized transcript JSON for a local session ref", async () => {
    writeClaudeSession("s1", [
      {
        type: "user",
        sessionId: "s1",
        cwd: "/p",
        message: { role: "user", content: "第一条" },
      },
      {
        type: "assistant",
        sessionId: "s1",
        cwd: "/p",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "第二条" }],
        },
      },
    ]);

    const { contextReadCommand } = await import("../src/commands/context.js");
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await contextReadCommand({ ref: "claude:s1", limit: "1" });

    const printed = JSON.parse(logSpy.mock.calls[0][0] as string);
    expect(printed).toMatchObject({
      source: { engine: "claude", sessionId: "s1", cwd: "/p" },
      messages: [{ role: "assistant", text: "第二条" }],
      hasMore: true,
    });
    logSpy.mockRestore();
  });

  it("context digest/handoff extract a compact rule-based package", async () => {
    writeClaudeSession("s2", [
      {
        type: "user",
        sessionId: "s2",
        cwd: "/repo",
        message: { role: "user", content: "目标：完善 src/cli.ts" },
      },
      {
        type: "assistant",
        sessionId: "s2",
        cwd: "/repo",
        message: {
          role: "assistant",
          content: [
            {
              type: "text",
              text: "结论：采用 context 命令。\nTODO：补 tests/context.test.ts。\n风险：不要绕过 ACP。",
            },
            { type: "tool_use", name: "Read", id: "t1", input: {} },
          ],
        },
      },
    ]);

    const { buildContextDigest, buildContextHandoff } =
      await import("../src/core/context/context.js");
    const digest = await buildContextDigest("claude:s2");
    expect(digest.source.cwd).toBe("/repo");
    expect(digest.changedFiles).toContain("src/cli.ts");
    expect(digest.toolCalls).toContain("Read");
    expect(digest.decisions[0]).toContain("context 命令");
    expect(digest.openTasks[0]).toContain("tests/context.test.ts");
    expect(digest.risks[0]).toContain("ACP");

    const handoff = await buildContextHandoff("claude:s2");
    expect(handoff.goal).toContain("src/cli.ts");
    expect(handoff.decisions).toEqual(digest.decisions);
    expect(handoff.recentMessages.length).toBe(2);
  });

  it("context list can emit JSON items", async () => {
    writeClaudeSession("s3", [
      {
        type: "user",
        sessionId: "s3",
        cwd: "/p",
        message: { role: "user", content: "hi" },
      },
    ]);

    const { contextListCommand } = await import("../src/commands/context.js");
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await contextListCommand({ json: true });

    const printed = JSON.parse(logSpy.mock.calls[0][0] as string);
    expect(printed.items).toHaveLength(1);
    expect(printed.items[0]).toMatchObject({
      engine: "claude",
      sessionId: "s3",
    });
    logSpy.mockRestore();
  });
});
