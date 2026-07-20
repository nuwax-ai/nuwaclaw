import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const testFileDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testFileDir, "..", "..");
const require = createRequire(import.meta.url);
const {
  parseArchFromElectronBuilderArgs,
  resolveTargetArch,
} = require(
  path.join(projectRoot, "scripts", "build", "run-build-electron.js"),
) as {
  parseArchFromElectronBuilderArgs: (argv: string[]) => string | null;
  resolveTargetArch: (
    argv: string[],
    env?: NodeJS.ProcessEnv,
    hostArch?: string,
  ) => string;
};

describe("run-build-electron target arch resolution", () => {
  it("parses --x64 and --arm64 from electron-builder args", () => {
    expect(parseArchFromElectronBuilderArgs(["--mac", "--x64"])).toBe("x64");
    expect(parseArchFromElectronBuilderArgs(["--arm64", "--mac"])).toBe(
      "arm64",
    );
    expect(parseArchFromElectronBuilderArgs(["--arch=x64", "--publish", "never"])).toBe(
      "x64",
    );
  });

  it("prefers workflow-provided TARGET_ARCH over electron-builder args", () => {
    expect(
      resolveTargetArch(["--mac", "--arm64"], { TARGET_ARCH: "x64" }, "arm64"),
    ).toBe("x64");
  });

  it("derives TARGET_ARCH from --x64 when workflow env is absent", () => {
    expect(resolveTargetArch(["--mac", "--x64"], {}, "arm64")).toBe("x64");
  });

  it("falls back to host arch for native local builds", () => {
    expect(resolveTargetArch(["--mac"], {}, "arm64")).toBe("arm64");
    expect(resolveTargetArch([], {}, "x64")).toBe("x64");
  });
});
