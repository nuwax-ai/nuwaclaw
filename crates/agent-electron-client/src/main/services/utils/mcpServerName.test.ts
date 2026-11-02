import { describe, it, expect } from "vitest";
import {
  sanitizeMcpServerName,
  peekAcpMcpServerName,
  allocateAcpMcpServerName,
  MCP_IDENTIFIER_PATTERN,
} from "./mcpServerName";

describe("sanitizeMcpServerName", () => {
  it("keeps ASCII names", () => {
    expect(sanitizeMcpServerName("chrome-devtools")).toBe("chrome-devtools");
  });

  it("replaces Chinese characters for LLM tool API compatibility", () => {
    const safe = sanitizeMcpServerName("A股股票查询");
    expect(MCP_IDENTIFIER_PATTERN.test(safe)).toBe(true);
    expect(safe).toBe("A");
  });

  it("falls back for all-non-ascii names", () => {
    expect(sanitizeMcpServerName("股票查询")).toBe("mcp_server");
  });
});

describe("peekAcpMcpServerName / allocateAcpMcpServerName", () => {
  it("resolves collisions with numeric suffix", () => {
    const used = new Set<string>(["A"]);
    expect(peekAcpMcpServerName("A股", used)).toBe("A_2");
  });

  it("allocate marks name as used", () => {
    const used = new Set<string>();
    const { name, sanitized } = allocateAcpMcpServerName("A股股票查询", used);
    expect(name).toBe("A");
    expect(sanitized).toBe(true);
    expect(used.has("A")).toBe(true);
  });
});
