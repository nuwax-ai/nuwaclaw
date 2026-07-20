import { describe, expect, it } from "vitest";
import {
  buildBundledBashExportBlock,
  collectBundledDevPathEntries,
  isBundledPathSegment,
  pickTtydBundledEnv,
  toBashEnvScript,
  toBashExportLines,
  toPowerShellEnvScript,
  toWindowsPowerShellFileContent,
} from "./ttydBundledEnvExport";

describe("ttydBundledEnvExport", () => {
  it("picks only ttyd-relevant keys", () => {
    const picked = pickTtydBundledEnv({
      PATH: "/a:/b",
      NODE_PATH: "/node_modules",
      UV_TOOL_DIR: "/uv/tools",
      PNPM_HOME: "/pnpm/home",
      NPM_CONFIG_REGISTRY: "https://registry.example.com",
      NUWAXCODE_RIPGREP_DIR: "/rg",
      HOME: "/should-not-be-exported",
      RANDOM: "x",
    });

    expect(picked.PATH).toBe("/a:/b");
    expect(picked.NODE_PATH).toBe("/node_modules");
    expect(picked.UV_TOOL_DIR).toBe("/uv/tools");
    expect(picked.PNPM_HOME).toBe("/pnpm/home");
    expect(picked.NPM_CONFIG_REGISTRY).toBe("https://registry.example.com");
    expect(picked.NUWAXCODE_RIPGREP_DIR).toBe("/rg");
    expect(picked.HOME).toBeUndefined();
    expect(picked.RANDOM).toBeUndefined();
  });

  it("picks NUWACLAW_RUNTIME when set", () => {
    const picked = pickTtydBundledEnv({
      NUWACLAW_RUNTIME: "1",
      HOME: "/should-not-be-exported",
    });
    expect(picked.NUWACLAW_RUNTIME).toBe("1");
  });

  it("toBashExportLines omits PATH when requested", () => {
    const lines = toBashExportLines(
      { PATH: "/a", PNPM_HOME: "/pnpm" },
      { omitKeys: ["PATH"] },
    );
    expect(lines.some((l) => l.startsWith("export PATH="))).toBe(false);
    expect(lines.some((l) => l.startsWith("export PNPM_HOME="))).toBe(true);
  });

  it("isBundledPathSegment matches ttyd and electron node paths", () => {
    expect(
      isBundledPathSegment("C:\\app\\resources\\ttyd\\bin\\ttyd.exe"),
    ).toBe(true);
    expect(
      isBundledPathSegment(
        "C:\\app\\resources\\app.asar.unpacked\\node_modules\\electron\\dist\\node_modules\\bin",
      ),
    ).toBe(true);
    expect(isBundledPathSegment("C:\\Program Files\\nodejs")).toBe(false);
  });

  it("collectBundledDevPathEntries scans PATH for bundled segments", () => {
    const entries = collectBundledDevPathEntries({
      PATH: "C:\\app\\resources\\ttyd\\bin;C:\\Program Files\\nodejs",
    });
    expect(entries).toContain("C:\\app\\resources\\ttyd\\bin");
    expect(entries).not.toContain("C:\\Program Files\\nodejs");
  });

  it("buildBundledBashExportBlock rebuilds PATH with POSIX colon separator", () => {
    const block = buildBundledBashExportBlock(
      {
        NUWAXCODE_NODE_DIR: "C:\\app\\resources\\node\\bin",
        PATH: "C:\\app\\resources\\node\\bin;C:\\Program Files\\nodejs",
        PNPM_HOME: "C:\\pnpm",
      },
      {
        rebuildPath: true,
        toPosixPath: (p) =>
          p.replace(/\\/g, "/").replace(/^([A-Za-z]):/, "/$1"),
      },
    );
    expect(block).not.toContain("export PATH='C:");
    expect(block).toContain("export PNPM_HOME=");
    expect(block).toMatch(/export PATH="[^"]+:\$PATH"/);
  });

  it("buildBundledBashExportBlock exports PATH directly when rebuildPath is false", () => {
    const block = buildBundledBashExportBlock(
      { PATH: "/a:/b", PNPM_HOME: "/pnpm" },
      { rebuildPath: false },
    );
    expect(block).toContain("export PATH='/a:/b'");
    expect(block).toContain("export PNPM_HOME='/pnpm'");
  });

  it("renders bash env script with export lines", () => {
    const script = toBashEnvScript(
      pickTtydBundledEnv({
        PATH: "/a:/b",
        UV_INDEX_URL: "https://pypi.example.com/simple",
      }),
    );
    expect(script).toContain("#!/bin/bash");
    expect(script).toContain("export PATH=");
    expect(script).toContain("export UV_INDEX_URL=");
  });

  it("renders powershell env script with $env assignments", () => {
    const script = toPowerShellEnvScript(
      pickTtydBundledEnv({
        PATH: "C:\\a;C:\\b",
        PNPM_HOME: "C:\\pnpm",
      }),
    );
    expect(script).toContain("$env:PATH =");
    expect(script).toContain("$env:PNPM_HOME =");
  });

  it("normalizes LF-only PowerShell scripts to CRLF", () => {
    const script = `if (Test-Path -LiteralPath $envScript -PathType Leaf) {
    . $envScript
}`;
    const normalized = toWindowsPowerShellFileContent(script);
    expect(normalized).not.toMatch(/(?<!\r)\n/);
    expect(normalized).toContain("    . $envScript\r\n");
  });
});
