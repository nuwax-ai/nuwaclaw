import { describe, it, expect } from "vitest";
import {
  filterEnabledMcpServers,
  mergeMcpServerConfigs,
  mergeRemoteAndLocalMcpConfigs,
} from "./mcpServerMerge";
import type { McpServerEntry } from "../packages/mcp";

describe("mergeMcpServerConfigs", () => {
  it("later layer wins on same server key", () => {
    const remote: Record<string, McpServerEntry> = {
      "ask-question": {
        command: "npx",
        args: ["-y", "nuwax-ask-question-mcp@latest"],
      },
    };
    const local: Record<string, McpServerEntry> = {
      "ask-question": {
        command: "node",
        args: ["/local/ask-mcp.js"],
        enabled: true,
      },
    };
    const merged = mergeRemoteAndLocalMcpConfigs(remote, local);
    expect(merged["ask-question"]).toEqual({
      command: "node",
      args: ["/local/ask-mcp.js"],
      enabled: true,
    });
  });

  it("dedupes by key across layers (no duplicate ask-question)", () => {
    const defaults: Record<string, McpServerEntry> = {
      "ask-question": { command: "npx", args: ["-y", "pkg@latest"] },
    };
    const remote: Record<string, McpServerEntry> = {
      "ask-question": { command: "npx", args: ["-y", "remote-pkg@latest"] },
      whois: { command: "npx", args: ["-y", "whois"] },
    };
    const merged = mergeMcpServerConfigs(defaults, remote);
    expect(Object.keys(merged).sort()).toEqual(["ask-question", "whois"]);
    expect(merged["ask-question"]?.args).toEqual(["-y", "remote-pkg@latest"]);
  });

  it("keeps distinct keys from all layers", () => {
    const merged = mergeMcpServerConfigs(
      { a: { command: "cmd", args: [] } },
      { b: { command: "cmd", args: ["b"] } },
    );
    expect(Object.keys(merged).sort()).toEqual(["a", "b"]);
  });
});

describe("filterEnabledMcpServers", () => {
  it("drops enabled === false", () => {
    const filtered = filterEnabledMcpServers({
      on: { command: "c", args: [], enabled: true },
      off: { command: "c", args: [], enabled: false },
      defaultOn: { command: "c", args: [] },
    });
    expect(Object.keys(filtered).sort()).toEqual(["defaultOn", "on"]);
  });
});
