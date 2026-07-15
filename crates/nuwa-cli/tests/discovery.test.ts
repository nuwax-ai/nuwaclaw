import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

let tmpHome: string;

vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof os>();
  return { ...actual, homedir: () => tmpHome };
});

describe("session discovery", () => {
  beforeEach(() => {
    tmpHome = fs.mkdtempSync(
      path.join(os.tmpdir(), "nuwa-cli-discovery-test-"),
    );
    vi.resetModules();
  });

  afterEach(() => {
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  it("listClaudeSessions extracts sessionId/cwd/title from a real-shaped transcript, ignoring queue-operation preamble lines", async () => {
    const projectDir = path.join(
      tmpHome,
      ".claude",
      "projects",
      "-Users-apple-demo",
    );
    fs.mkdirSync(projectDir, { recursive: true });
    const lines = [
      JSON.stringify({
        type: "queue-operation",
        operation: "enqueue",
        sessionId: "s1",
      }),
      JSON.stringify({
        type: "user",
        sessionId: "s1",
        cwd: "/Users/apple/demo",
        message: { role: "user", content: "分析一下现状" },
      }),
      JSON.stringify({
        type: "assistant",
        sessionId: "s1",
        cwd: "/Users/apple/demo",
      }),
    ];
    fs.writeFileSync(
      path.join(projectDir, "s1.jsonl"),
      lines.join("\n") + "\n",
    );

    const { listClaudeSessions } =
      await import("../src/core/sessions/discovery.js");
    const sessions = await listClaudeSessions();
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({
      engine: "claude",
      sessionId: "s1",
      cwd: "/Users/apple/demo",
      title: "分析一下现状",
    });
  });

  it("listClaudeSessions falls back to a placeholder title when no plain-string user message is found within the scan budget", async () => {
    const projectDir = path.join(
      tmpHome,
      ".claude",
      "projects",
      "-Users-apple-demo",
    );
    fs.mkdirSync(projectDir, { recursive: true });
    fs.writeFileSync(
      path.join(projectDir, "s2.jsonl"),
      JSON.stringify({
        type: "assistant",
        sessionId: "s2",
        cwd: "/Users/apple/demo",
      }) + "\n",
    );
    const { listClaudeSessions } =
      await import("../src/core/sessions/discovery.js");
    const sessions = await listClaudeSessions();
    expect(sessions[0].title).toBe("(无标题)");
  });

  it("listClaudeSessions skips files with no discoverable sessionId/cwd", async () => {
    const projectDir = path.join(
      tmpHome,
      ".claude",
      "projects",
      "-Users-apple-demo",
    );
    fs.mkdirSync(projectDir, { recursive: true });
    fs.writeFileSync(
      path.join(projectDir, "broken.jsonl"),
      "not json at all\n",
    );
    const { listClaudeSessions } =
      await import("../src/core/sessions/discovery.js");
    expect(await listClaudeSessions()).toHaveLength(0);
  });

  it("listCodexSessions reads session_id/cwd from the session_meta header line", async () => {
    const dayDir = path.join(tmpHome, ".codex", "sessions", "2026", "07", "06");
    fs.mkdirSync(dayDir, { recursive: true });
    fs.writeFileSync(
      path.join(dayDir, "rollout-2026-07-06T00-00-00-abc.jsonl"),
      JSON.stringify({
        type: "session_meta",
        payload: { session_id: "codex-1", cwd: "/Users/apple/codex-demo" },
      }) + "\n",
    );
    const { listCodexSessions } =
      await import("../src/core/sessions/discovery.js");
    const sessions = await listCodexSessions();
    expect(sessions).toEqual([
      expect.objectContaining({
        engine: "codex",
        sessionId: "codex-1",
        cwd: "/Users/apple/codex-demo",
      }),
    ]);
  });

  it("listCodexSessions falls back to payload.id for pre-2026-07 sessions that lack session_id", async () => {
    const dayDir = path.join(tmpHome, ".codex", "sessions", "2026", "06", "03");
    fs.mkdirSync(dayDir, { recursive: true });
    fs.writeFileSync(
      path.join(dayDir, "rollout-2026-06-03T00-00-00-legacy.jsonl"),
      JSON.stringify({
        type: "session_meta",
        payload: { id: "legacy-id", cwd: "/Users/apple/old-project" },
      }) + "\n",
    );
    const { listCodexSessions } =
      await import("../src/core/sessions/discovery.js");
    const sessions = await listCodexSessions();
    expect(sessions[0]).toMatchObject({
      sessionId: "legacy-id",
      cwd: "/Users/apple/old-project",
    });
  });

  it("listLocalSessions merges both engines sorted by recency and respects the engine filter", async () => {
    const claudeDir = path.join(tmpHome, ".claude", "projects", "-p");
    fs.mkdirSync(claudeDir, { recursive: true });
    fs.writeFileSync(
      path.join(claudeDir, "c1.jsonl"),
      JSON.stringify({ sessionId: "c1", cwd: "/p", type: "assistant" }) + "\n",
    );
    const codexDir = path.join(
      tmpHome,
      ".codex",
      "sessions",
      "2026",
      "07",
      "07",
    );
    fs.mkdirSync(codexDir, { recursive: true });
    fs.writeFileSync(
      path.join(codexDir, "rollout-x.jsonl"),
      JSON.stringify({
        type: "session_meta",
        payload: { session_id: "k1", cwd: "/p" },
      }) + "\n",
    );

    const { listLocalSessions } =
      await import("../src/core/sessions/discovery.js");
    const all = await listLocalSessions();
    expect(all.map((s) => s.engine).sort()).toEqual(["claude", "codex"]);

    const claudeOnly = await listLocalSessions("claude");
    expect(claudeOnly).toHaveLength(1);
    expect(claudeOnly[0].engine).toBe("claude");
  });
});
