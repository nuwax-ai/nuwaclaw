import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

let tmpHome: string;

vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof os>();
  return { ...actual, homedir: () => tmpHome };
});

describe("resolveRefSessionReminder", () => {
  beforeEach(() => {
    tmpHome = fs.mkdtempSync(
      path.join(os.tmpdir(), "nuwaclaw-refsession-test-"),
    );
    vi.resetModules();
  });

  afterEach(() => {
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  it("returns an empty string when --ref-session is not given", async () => {
    const { resolveRefSessionReminder } =
      await import("../src/commands/chat.js");
    expect(await resolveRefSessionReminder(undefined)).toBe("");
  });

  it("rejects a value with no ':' separator", async () => {
    const { resolveRefSessionReminder } =
      await import("../src/commands/chat.js");
    await expect(resolveRefSessionReminder("no-colon-here")).rejects.toThrow(
      /engine.*sessionId/,
    );
  });

  it("rejects an engine that is neither claude nor codex", async () => {
    const { resolveRefSessionReminder } =
      await import("../src/commands/chat.js");
    await expect(resolveRefSessionReminder("gemini:abc")).rejects.toThrow(
      /claude 或 codex/,
    );
  });

  it("rejects a sessionId that isn't found locally for that engine", async () => {
    const { resolveRefSessionReminder } =
      await import("../src/commands/chat.js");
    await expect(
      resolveRefSessionReminder("claude:does-not-exist"),
    ).rejects.toThrow(/does-not-exist/);
  });

  it("builds a reminder pointing at `sessions summary` with the matched session's cwd, for a session that exists locally", async () => {
    const projectDir = path.join(tmpHome, ".claude", "projects", "-p");
    fs.mkdirSync(projectDir, { recursive: true });
    fs.writeFileSync(
      path.join(projectDir, "s1.jsonl"),
      JSON.stringify({
        type: "user",
        sessionId: "s1",
        cwd: "/p",
        message: { role: "user", content: "hi" },
      }) + "\n",
    );

    const { resolveRefSessionReminder } =
      await import("../src/commands/chat.js");
    const reminder = await resolveRefSessionReminder("claude:s1");
    expect(reminder).toContain("<system-reminder>");
    expect(reminder).toContain("claude:s1");
    expect(reminder).toContain("cwd=/p");
    expect(reminder).toContain(
      "nuwaclaw sessions summary --engine claude --session-id s1 --json",
    );
    expect(reminder.endsWith("\n\n")).toBe(true);
  });

  it("splits only on the first ':' so sessionId values are never truncated", async () => {
    // Real sessionIds are plain UUIDs with no ':', but the parser must not
    // assume that — verify it doesn't silently mangle a ':'-containing id.
    const projectDir = path.join(
      tmpHome,
      ".codex",
      "sessions",
      "2026",
      "07",
      "07",
    );
    fs.mkdirSync(projectDir, { recursive: true });
    fs.writeFileSync(
      path.join(projectDir, "rollout-x.jsonl"),
      JSON.stringify({
        type: "session_meta",
        payload: { session_id: "weird:id", cwd: "/q" },
      }) + "\n",
    );
    const { resolveRefSessionReminder } =
      await import("../src/commands/chat.js");
    const reminder = await resolveRefSessionReminder("codex:weird:id");
    expect(reminder).toContain("--session-id weird:id");
  });
});
