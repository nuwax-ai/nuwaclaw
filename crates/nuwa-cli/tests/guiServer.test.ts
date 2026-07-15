import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

let tmpHome: string;

vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof os>();
  return { ...actual, homedir: () => tmpHome };
});

describe("buildGuiAgentMcpServer", () => {
  beforeEach(() => {
    tmpHome = fs.mkdtempSync(
      path.join(os.tmpdir(), "nuwa-cli-guiserver-test-"),
    );
    vi.resetModules();
  });

  afterEach(() => {
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  it("resolves via --gui-mcp-path pointing directly at an entry file", async () => {
    const entry = path.join(tmpHome, "fake-entry.js");
    fs.writeFileSync(entry, "// fake");
    const { buildGuiAgentMcpServer } =
      await import("../src/core/mcp/guiServer.js");
    const server = buildGuiAgentMcpServer({ devPath: entry });
    expect(server).toMatchObject({
      name: "gui-agent",
      command: process.execPath,
      args: [entry, "--transport", "stdio"],
    });
  });

  it("resolves via --gui-mcp-path pointing at a package directory (appends dist/index.js)", async () => {
    const pkgDir = path.join(tmpHome, "pkg");
    fs.mkdirSync(path.join(pkgDir, "dist"), { recursive: true });
    fs.writeFileSync(path.join(pkgDir, "dist", "index.js"), "// fake");
    const { buildGuiAgentMcpServer } =
      await import("../src/core/mcp/guiServer.js");
    const server = buildGuiAgentMcpServer({ devPath: pkgDir });
    expect(server.command).toBe(process.execPath);
    expect((server as { args: string[] }).args[0]).toBe(
      path.join(pkgDir, "dist", "index.js"),
    );
  });

  it("throws a clear error when --gui-mcp-path doesn't exist", async () => {
    const { buildGuiAgentMcpServer } =
      await import("../src/core/mcp/guiServer.js");
    expect(() =>
      buildGuiAgentMcpServer({ devPath: path.join(tmpHome, "nope") }),
    ).toThrow(/gui-mcp-path/);
  });

  it("includes GUI_AGENT_API_KEY only when an apiKey is provided", async () => {
    const entry = path.join(tmpHome, "fake-entry.js");
    fs.writeFileSync(entry, "// fake");
    const { buildGuiAgentMcpServer } =
      await import("../src/core/mcp/guiServer.js");

    const withoutKey = buildGuiAgentMcpServer({ devPath: entry });
    expect((withoutKey as { env: unknown[] }).env).toEqual([]);

    const withKey = buildGuiAgentMcpServer({
      devPath: entry,
      apiKey: "sk-test",
    });
    expect((withKey as { env: unknown[] }).env).toEqual([
      { name: "GUI_AGENT_API_KEY", value: "sk-test" },
    ]);
  });

  it("resolves an already-installed package under ~/.nuwa-cli/tools without needing devPath", async () => {
    const installed = path.join(
      tmpHome,
      ".nuwa-cli",
      "tools",
      "node_modules",
      "agent-gui-server",
      "dist",
      "index.js",
    );
    fs.mkdirSync(path.dirname(installed), { recursive: true });
    fs.writeFileSync(installed, "// fake");
    const { buildGuiAgentMcpServer } =
      await import("../src/core/mcp/guiServer.js");
    const server = buildGuiAgentMcpServer({});
    expect((server as { args: string[] }).args[0]).toBe(installed);
  });
});
