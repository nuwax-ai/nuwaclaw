import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

let tmpHome: string;

vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof os>();
  return { ...actual, homedir: () => tmpHome };
});

describe("config get/set", () => {
  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "nuwa-cli-config-test-"));
    vi.resetModules();
  });

  afterEach(() => {
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  it("configSetCommand('domain', ...) normalizes and persists the domain", async () => {
    const { configSetCommand } = await import("../src/commands/config.js");
    const { readCredentials } = await import("../src/core/auth/credentials.js");
    await configSetCommand("domain", "example.com");
    expect(readCredentials().domain).toBe("https://example.com");
  });

  it("configSetCommand rejects an unknown key without touching the file", async () => {
    const { configSetCommand } = await import("../src/commands/config.js");
    const { readCredentials } = await import("../src/core/auth/credentials.js");
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await configSetCommand("nonsense", "value");
    expect(readCredentials()).toEqual({});
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining("nonsense"));
    expect(process.exitCode).toBe(1);
    process.exitCode = 0;
    errSpy.mockRestore();
  });

  it("configGetCommand() with no key prints all three fields without throwing", async () => {
    const { configSetCommand, configGetCommand } =
      await import("../src/commands/config.js");
    const { updateCredentials } =
      await import("../src/core/auth/credentials.js");
    await configSetCommand("domain", "example.com");
    await configSetCommand("username", "alice");
    updateCredentials({ computerName: "我的电脑001" });
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await configGetCommand();
    const printed = logSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(printed).toContain("example.com");
    expect(printed).toContain("alice");
    expect(printed).toContain("computer-name: 我的电脑001");
    logSpy.mockRestore();
  });
});
