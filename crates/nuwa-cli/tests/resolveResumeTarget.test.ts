import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

let tmpHome: string;

vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof os>();
  return { ...actual, homedir: () => tmpHome };
});

const selectMock = vi.fn();
const isCancelMock = vi.fn(() => false);
vi.mock("@clack/prompts", () => ({
  select: (...args: unknown[]) => selectMock(...args),
  isCancel: (...args: unknown[]) => isCancelMock(...args),
}));

function seedClaudeSession(id: string, cwd: string, title: string) {
  const dir = path.join(tmpHome, ".claude", "projects", "-p");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, `${id}.jsonl`),
    JSON.stringify({
      type: "user",
      sessionId: id,
      cwd,
      message: { role: "user", content: title },
    }) + "\n",
  );
}

describe("resolveResumeTarget", () => {
  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "nuwa-cli-resume-test-"));
    vi.resetModules();
    selectMock.mockReset();
    isCancelMock.mockReset().mockReturnValue(false);
  });

  afterEach(() => {
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  it("returns null when --resume wasn't passed", async () => {
    const { resolveResumeTarget } =
      await import("../src/commands/resolveResumeTarget.js");
    expect(await resolveResumeTarget(undefined, "claude")).toBeNull();
  });

  it("resolves the matching session's cwd for an explicit sessionId", async () => {
    seedClaudeSession("abc", "/Users/apple/project-a", "hi");
    const { resolveResumeTarget } =
      await import("../src/commands/resolveResumeTarget.js");
    const target = await resolveResumeTarget("abc", "claude");
    expect(target).toEqual({ sessionId: "abc", cwd: "/Users/apple/project-a" });
  });

  it("throws a clear error for an explicit sessionId that isn't in local history", async () => {
    seedClaudeSession("abc", "/Users/apple/project-a", "hi");
    const { resolveResumeTarget } =
      await import("../src/commands/resolveResumeTarget.js");
    await expect(
      resolveResumeTarget("does-not-exist", "claude"),
    ).rejects.toThrow(/does-not-exist/);
  });

  it("shows an interactive picker when --resume is bare (true) and returns the picked session", async () => {
    seedClaudeSession("abc", "/Users/apple/project-a", "first");
    seedClaudeSession("def", "/Users/apple/project-b", "second");
    selectMock.mockResolvedValueOnce("def");
    const { resolveResumeTarget } =
      await import("../src/commands/resolveResumeTarget.js");
    const target = await resolveResumeTarget(true, "claude");
    expect(target).toEqual({ sessionId: "def", cwd: "/Users/apple/project-b" });
  });

  it("throws when --resume is bare but there is no local history to pick from", async () => {
    const { resolveResumeTarget } =
      await import("../src/commands/resolveResumeTarget.js");
    await expect(resolveResumeTarget(true, "claude")).rejects.toThrow(
      /未找到任何本地/,
    );
  });

  it("exits cleanly (no error thrown) when the user cancels the picker", async () => {
    seedClaudeSession("abc", "/Users/apple/project-a", "hi");
    const cancelSymbol = Symbol("cancel");
    selectMock.mockResolvedValueOnce(cancelSymbol);
    isCancelMock.mockReturnValueOnce(true);
    const exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation(() => undefined as never);
    const { resolveResumeTarget } =
      await import("../src/commands/resolveResumeTarget.js");
    await resolveResumeTarget(true, "claude");
    expect(exitSpy).toHaveBeenCalledWith(0);
    exitSpy.mockRestore();
  });
});
