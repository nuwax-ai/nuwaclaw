import { describe, it, expect, vi, beforeEach } from "vitest";
import type { DoctorCheckResult } from "../src/core/detect/doctorChecks.js";

const runAllDoctorChecksMock = vi.fn<() => DoctorCheckResult[]>();
vi.mock("../src/core/detect/doctorChecks.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../src/core/detect/doctorChecks.js")>();
  return {
    ...actual,
    runAllDoctorChecks: () => runAllDoctorChecksMock(),
  };
});

function check(
  id: string,
  ok: boolean,
  severity?: "required" | "info",
): DoctorCheckResult {
  return { id, label: id, ok, detail: id, severity };
}

describe("doctorCommand exit code", () => {
  beforeEach(() => {
    vi.resetModules();
    runAllDoctorChecksMock.mockReset();
    process.exitCode = 0;
  });

  it("exits 0 when only optional/info checks fail (e.g. uv missing, Nuwax not logged in) as long as an engine is usable", async () => {
    runAllDoctorChecksMock.mockReturnValue([
      check("node", true, "required"),
      check("claude", true),
      check("codex", false),
      check("uv", false, "info"),
      check("tcc", true, "info"),
      check("nuwax-login", false, "info"),
      check("local-sessions", true, "info"),
    ]);
    const { doctorCommand } = await import("../src/commands/doctor.js");
    await doctorCommand();
    expect(process.exitCode).toBe(0);
  });

  it("exits 1 when a required check (node version) fails", async () => {
    runAllDoctorChecksMock.mockReturnValue([
      check("node", false, "required"),
      check("claude", true),
      check("codex", true),
    ]);
    const { doctorCommand } = await import("../src/commands/doctor.js");
    await doctorCommand();
    expect(process.exitCode).toBe(1);
  });

  it("exits 1 when neither claude nor codex is usable, even though each is individually only 'info'", async () => {
    runAllDoctorChecksMock.mockReturnValue([
      check("node", true, "required"),
      check("claude", false),
      check("codex", false),
    ]);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const { doctorCommand } = await import("../src/commands/doctor.js");
    await doctorCommand();
    expect(process.exitCode).toBe(1);
    const printed = logSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(printed).toContain("没有可用的引擎");
    logSpy.mockRestore();
  });

  it("exits 0 when only one of claude/codex is available", async () => {
    runAllDoctorChecksMock.mockReturnValue([
      check("node", true, "required"),
      check("claude", true),
      check("codex", false),
    ]);
    const { doctorCommand } = await import("../src/commands/doctor.js");
    await doctorCommand();
    expect(process.exitCode).toBe(0);
  });

  it("exits 0 and reports full pass when everything is ok", async () => {
    runAllDoctorChecksMock.mockReturnValue([
      check("node", true, "required"),
      check("claude", true),
      check("codex", true),
    ]);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const { doctorCommand } = await import("../src/commands/doctor.js");
    await doctorCommand();
    expect(process.exitCode).toBe(0);
    const printed = logSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(printed).toContain("环境检测全部通过");
    logSpy.mockRestore();
  });
});
