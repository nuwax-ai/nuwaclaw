import { describe, expect, it, vi } from "vitest";
import * as path from "path";
import {
  resolveMacOsStrictMcpExecAllowlist,
  resolveMacOsStrictMcpResourceSubpaths,
} from "./macOsStrictMcpSandbox";

vi.mock("fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fs")>();
  return {
    ...actual,
    existsSync: (p: fs.PathLike) => {
      const s = String(p);
      return (
        s.includes("mcp-stdio-proxy") || s.includes("node") || s.includes("uv")
      );
    },
  };
});

vi.mock("@main/services/system/dependencies", () => ({
  getResourcesPath: vi.fn(() => "/mock/resources"),
  getNodeBinPathWithFallback: vi.fn(
    () => "/mock/resources/node/darwin-arm64/bin/node",
  ),
  getUvBinPath: vi.fn(() => "/mock/resources/uv/bin/uv"),
  getRipgrepBinPath: vi.fn(() => "/mock/resources/ripgrep/rg"),
}));

describe("macOsStrictMcpSandbox", () => {
  it("resolveMacOsStrictMcpExecAllowlist includes node and MCP proxy entry", () => {
    const list = resolveMacOsStrictMcpExecAllowlist();
    expect(list).toContain("/mock/resources/node/darwin-arm64/bin/node");
    expect(list).toContain(
      path.join("/mock/resources", "mcp-stdio-proxy", "dist", "index.js"),
    );
  });

  it("resolveMacOsStrictMcpResourceSubpaths includes proxy and node bundle dirs", () => {
    const subpaths = resolveMacOsStrictMcpResourceSubpaths();
    expect(subpaths).toContain(
      path.join("/mock/resources", "mcp-stdio-proxy", "dist"),
    );
    expect(subpaths.some((p) => p.includes("darwin-arm64"))).toBe(true);
  });
});
