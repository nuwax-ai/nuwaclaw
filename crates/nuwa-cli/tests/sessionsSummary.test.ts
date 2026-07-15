import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import type { Command } from "commander";

let tmpHome: string;

vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof os>();
  return { ...actual, homedir: () => tmpHome };
});

function fakeCommand(opts: Record<string, unknown>): Command {
  return { optsWithGlobals: () => opts } as unknown as Command;
}

describe("sessionsSummaryCommand", () => {
  beforeEach(() => {
    tmpHome = fs.mkdtempSync(
      path.join(os.tmpdir(), "nuwa-cli-sessions-summary-test-"),
    );
    vi.resetModules();
  });

  afterEach(() => {
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  it("reads --engine/--session-id/--limit from optsWithGlobals (not the raw action arg) — regression for the commander parent/child same-flag collision", async () => {
    const projectDir = path.join(tmpHome, ".claude", "projects", "-p");
    fs.mkdirSync(projectDir, { recursive: true });
    fs.writeFileSync(
      path.join(projectDir, "s1.jsonl"),
      [
        JSON.stringify({
          type: "user",
          sessionId: "s1",
          cwd: "/p",
          message: { role: "user", content: "你好" },
        }),
        JSON.stringify({
          type: "assistant",
          sessionId: "s1",
          cwd: "/p",
          message: {
            role: "assistant",
            content: [{ type: "text", text: "你好，有什么可以帮你的" }],
          },
        }),
      ].join("\n") + "\n",
    );

    const { sessionsSummaryCommand } =
      await import("../src/commands/sessions.js");
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    // The action's own first arg is deliberately left empty/wrong on purpose —
    // commander attributes a parent-and-child shared flag name to the parent,
    // so the real values must come from optsWithGlobals(), not this arg.
    await sessionsSummaryCommand(
      {},
      fakeCommand({ engine: "claude", sessionId: "s1", limit: "1" }),
    );

    expect(logSpy).toHaveBeenCalledTimes(1);
    const printed = JSON.parse(logSpy.mock.calls[0][0] as string);
    expect(printed).toMatchObject({
      engine: "claude",
      sessionId: "s1",
      cwd: "/p",
      hasMore: true,
      messages: [{ role: "assistant", text: "你好，有什么可以帮你的" }],
    });
    logSpy.mockRestore();
  });

  it("errors clearly when --engine is missing or invalid", async () => {
    const { sessionsSummaryCommand } =
      await import("../src/commands/sessions.js");
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await sessionsSummaryCommand({}, fakeCommand({ sessionId: "s1" }));
    expect(process.exitCode).toBe(1);
    process.exitCode = 0;
    errSpy.mockRestore();
  });

  it("errors clearly when the sessionId isn't found locally", async () => {
    const { sessionsSummaryCommand } =
      await import("../src/commands/sessions.js");
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await sessionsSummaryCommand(
      {},
      fakeCommand({ engine: "claude", sessionId: "does-not-exist" }),
    );
    expect(process.exitCode).toBe(1);
    expect(errSpy).toHaveBeenCalledWith(
      expect.stringContaining("does-not-exist"),
    );
    process.exitCode = 0;
    errSpy.mockRestore();
  });
});
