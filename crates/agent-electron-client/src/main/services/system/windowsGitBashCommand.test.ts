import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  formatBashCommandLine,
  isGitBashInvocation,
  isKnownCommandInterpreter,
  quoteBashWord,
  tokenLooksLikeScriptFile,
  commandNeedsShellInterpreter,
  wrapWindowsCommandWithGitBash,
} from "./windowsGitBashCommand";

const mockGetBundledGitBash = vi.fn(() => "C:\\resources\\git\\bin\\bash.exe");

vi.mock("./binaryLocator", () => ({
  getBundledGitBashPath: () => mockGetBundledGitBash(),
}));

vi.mock("./platformAdapter", () => ({
  createPlatformAdapter: vi.fn(() => ({
    isWindows: true,
  })),
}));

vi.mock("electron-log", () => ({
  default: {
    warn: vi.fn(),
    info: vi.fn(),
  },
}));

import log from "electron-log";

describe("windowsGitBashCommand", () => {
  const originalPlatform = process.platform;

  beforeEach(() => {
    mockGetBundledGitBash.mockReturnValue("C:\\resources\\git\\bin\\bash.exe");
    vi.mocked(log.warn).mockClear();
    Object.defineProperty(process, "platform", {
      value: "win32",
      configurable: true,
    });
  });

  afterEach(() => {
    Object.defineProperty(process, "platform", {
      value: originalPlatform,
      configurable: true,
    });
  });

  it("wraps .sh script paths with bundled bash -c", () => {
    const wrapped = wrapWindowsCommandWithGitBash(
      "./scripts/update-config.sh",
      [],
    );
    expect(wrapped.command).toBe("C:\\resources\\git\\bin\\bash.exe");
    expect(wrapped.args).toEqual(["-c", "./scripts/update-config.sh"]);
    expect(wrapped.gitBashWrapped).toBe(true);
  });

  it("wraps command plus args into a single bash -c line", () => {
    const wrapped = wrapWindowsCommandWithGitBash("npm", ["test"]);
    expect(wrapped.args).toEqual(["-c", "npm test"]);
  });

  it("quotes args that contain spaces", () => {
    expect(formatBashCommandLine("echo", ["hello world"])).toBe(
      "echo 'hello world'",
    );
  });

  it("quotes executable paths that contain spaces when args are present", () => {
    expect(
      formatBashCommandLine("C:\\Program Files\\node\\node.exe", ["script.js"]),
    ).toBe("'C:\\Program Files\\node\\node.exe' script.js");
    const wrapped = wrapWindowsCommandWithGitBash(
      "C:\\Program Files\\node\\node.exe",
      ["script.js"],
    );
    expect(wrapped.args[1]).toBe(
      "'C:\\Program Files\\node\\node.exe' script.js",
    );
  });

  it("exports quoteBashWord for simple tokens without quotes", () => {
    expect(quoteBashWord("npm")).toBe("npm");
    expect(quoteBashWord("hello world")).toBe("'hello world'");
  });

  it("keeps existing bash -c invocations but swaps shell path", () => {
    expect(
      isGitBashInvocation("C:\\Windows\\System32\\bash.exe", ["-c", "pwd"]),
    ).toBe(true);
    const wrapped = wrapWindowsCommandWithGitBash(
      "C:\\Windows\\System32\\bash.exe",
      ["-c", "./scripts/foo.sh"],
    );
    expect(wrapped.command).toBe("C:\\resources\\git\\bin\\bash.exe");
    expect(wrapped.args).toEqual(["-c", "./scripts/foo.sh"]);
  });

  it("warns when Git Bash is missing and command is a shell script", () => {
    mockGetBundledGitBash.mockReturnValue("");
    const wrapped = wrapWindowsCommandWithGitBash("./scripts/foo.sh", []);
    expect(wrapped.command).toBe("./scripts/foo.sh");
    expect(wrapped.gitBashWrapped).toBe(false);
    expect(log.warn).toHaveBeenCalled();
  });

  it("warns for .ps1 and .js used as direct executable without bash", () => {
    mockGetBundledGitBash.mockReturnValue("");
    wrapWindowsCommandWithGitBash("./deploy.ps1", []);
    wrapWindowsCommandWithGitBash("./app.js", []);
    expect(log.warn).toHaveBeenCalledTimes(2);
  });

  it("does not warn when interpreter prefixes script path", () => {
    mockGetBundledGitBash.mockReturnValue("");
    wrapWindowsCommandWithGitBash("node", ["app.js"]);
    wrapWindowsCommandWithGitBash("powershell.exe", ["-File", "deploy.ps1"]);
    expect(log.warn).not.toHaveBeenCalled();
  });

  describe("commandNeedsShellInterpreter", () => {
    it("detects script extensions on command token", () => {
      expect(tokenLooksLikeScriptFile("./a.ps1")).toBe(true);
      expect(tokenLooksLikeScriptFile("run.bat")).toBe(true);
      expect(tokenLooksLikeScriptFile("npm")).toBe(false);
    });

    it("treats known interpreters as safe even with script args", () => {
      expect(isKnownCommandInterpreter("node.exe")).toBe(true);
      expect(commandNeedsShellInterpreter("python", ["main.py"])).toBe(false);
    });

    it("flags script path in args when command is not an interpreter", () => {
      expect(commandNeedsShellInterpreter("./wrapper", ["script.js"])).toBe(
        true,
      );
    });
  });

  it("does not warn when Git Bash is missing for non-script commands", () => {
    mockGetBundledGitBash.mockReturnValue("");
    wrapWindowsCommandWithGitBash("npm", ["test"]);
    expect(log.warn).not.toHaveBeenCalled();
  });
});
