import path from "node:path";
import { pathToFileURL } from "node:url";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";

const testFileDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testFileDir, "..", "..");
const modulePath = path.join(
  projectRoot,
  "scripts",
  "mcp",
  "sandboxed-bash-security.mjs",
);

type SecurityModule = {
  buildSandboxHelperEnv: (
    baseEnv: Record<string, string>,
    sandboxPath?: string,
  ) => Record<string, string>;
  resolveSandboxWorkingDirectory: (
    requestedCwd: string,
    sandboxMode: string,
    writableRoots: string[],
  ) => string;
};

let securityMod: SecurityModule;

beforeAll(async () => {
  securityMod = (await import(pathToFileURL(modulePath).href)) as SecurityModule;
});

describe("sandboxed-bash security helpers", () => {
  it("should filter sensitive env vars and keep only safe env keys", () => {
    const env = securityMod.buildSandboxHelperEnv(
      {
        PATH: "C:\\Windows\\System32",
        TEMP: "C:\\Temp",
        HOME: "C:\\Users\\demo",
        ANTHROPIC_API_KEY: "secret-anthropic",
        OPENAI_API_KEY: "secret-openai",
      },
      "",
    );

    expect(env.PATH).toBe("C:\\Windows\\System32");
    expect(env.TEMP).toBe("C:\\Temp");
    expect(env.HOME).toBe("C:\\Users\\demo");
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(env.OPENAI_API_KEY).toBeUndefined();
  });

  it("should prepend sandbox tool path to PATH", () => {
    const env = securityMod.buildSandboxHelperEnv(
      {
        PATH: "C:\\Windows\\System32",
      },
      "C:\\sandbox\\bin",
    );

    expect(env.PATH.startsWith("C:\\sandbox\\bin;")).toBe(true);
  });

  it("should fallback cwd to first writable root when outside workspace", () => {
    const root = path.resolve("/workspace/project");
    const outside = path.resolve("/outside/path");
    const cwd = securityMod.resolveSandboxWorkingDirectory(
      outside,
      "workspace-write",
      [root],
    );
    expect(cwd).toBe(root);
  });

  it("should keep cwd unchanged when already inside writable root", () => {
    const root = path.resolve("/workspace/project");
    const inside = path.resolve("/workspace/project/subdir");
    const cwd = securityMod.resolveSandboxWorkingDirectory(
      inside,
      "workspace-write",
      [root],
    );
    expect(cwd).toBe(inside);
  });
});

