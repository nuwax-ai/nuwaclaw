import { describe, expect, it, vi } from "vitest";
import {
  applyMcpServerDraft,
  parseEnvText,
  parseServerFromJson,
  resolveMcpEditorPayload,
  serializeEnvToText,
} from "./mcpServerEditorUtils";

vi.mock("../../services/core/i18n", () => ({
  t: (key: string) => key,
}));

const context7Json = JSON.stringify({
  context7: {
    command: "npx",
    args: ["-y", "@upstash/context7-mcp"],
    env: { CONTEXT7_API_KEY: "YOUR_API_KEY" },
    enabled: true,
  },
});

describe("parseEnvText", () => {
  it("treats empty text as no env", () => {
    expect(parseEnvText("")).toEqual({ ok: true, env: undefined });
    expect(parseEnvText("   ")).toEqual({ ok: true, env: undefined });
  });

  it("parses Record<string, string> like openui config", () => {
    const result = parseEnvText(
      JSON.stringify({
        NUWAX_OPENUI_BASE_URL: "http://127.0.0.1:8787",
      }),
    );
    expect(result).toEqual({
      ok: true,
      env: { NUWAX_OPENUI_BASE_URL: "http://127.0.0.1:8787" },
    });
  });

  it("rejects non-object or non-string values", () => {
    expect(parseEnvText("[]").ok).toBe(false);
    expect(parseEnvText('{"A":1}').ok).toBe(false);
    expect(parseEnvText("{ not json").ok).toBe(false);
  });

  it("serializeEnvToText omits empty env", () => {
    expect(serializeEnvToText(undefined)).toBe("");
    expect(serializeEnvToText({})).toBe("");
    expect(serializeEnvToText({ A: "1" })).toContain("A");
  });
});

describe("parseServerFromJson", () => {
  it("parses format A with server key as serverId", () => {
    const result = parseServerFromJson(context7Json);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.serverId).toBe("context7");
    expect(result.entry).toMatchObject({
      command: "npx",
      args: ["-y", "@upstash/context7-mcp"],
      env: { CONTEXT7_API_KEY: "YOUR_API_KEY" },
      enabled: true,
    });
  });

  it("parses format B mcpServers wrapper", () => {
    const result = parseServerFromJson(
      JSON.stringify({
        mcpServers: {
          myserver: { command: "node", args: ["server.js"] },
        },
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.serverId).toBe("myserver");
  });

  it("rejects invalid JSON", () => {
    const result = parseServerFromJson("{ not json");
    expect(result.ok).toBe(false);
  });
});

describe("resolveMcpEditorPayload", () => {
  it("uses JSON key as serverId in create mode", () => {
    const result = resolveMcpEditorPayload({
      editorTab: "json",
      jsonText: context7Json,
      isEdit: false,
      formPayload: () => ({
        ok: false,
        error: "Claw.MCP.addServer.idRequired",
      }),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.serverId).toBe("context7");
  });

  it("uses JSON key as serverId in edit mode (rename support)", () => {
    const result = resolveMcpEditorPayload({
      editorTab: "json",
      jsonText: JSON.stringify({
        "new-id": {
          command: "npx",
          args: ["-y", "@upstash/context7-mcp"],
        },
      }),
      isEdit: true,
      editingServerId: "original-id",
      formPayload: () => ({
        ok: false,
        error: "Claw.MCP.addServer.idRequired",
      }),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.serverId).toBe("new-id");
  });

  it("uses form payload on form tab", () => {
    const result = resolveMcpEditorPayload({
      editorTab: "form",
      jsonText: "",
      isEdit: false,
      formPayload: () => ({
        ok: true,
        serverId: "form-id",
        entry: { command: "cmd", args: [] },
      }),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.serverId).toBe("form-id");
  });
});

describe("applyMcpServerDraft", () => {
  it("renames server by removing previous key", () => {
    const next = applyMcpServerDraft(
      {
        mcpServers: {
          old: { command: "cmd", args: [] },
          other: { command: "x", args: [] },
        },
      },
      "new",
      { command: "cmd", args: ["updated"] },
      "old",
    );
    expect(next.mcpServers).toEqual({
      new: { command: "cmd", args: ["updated"] },
      other: { command: "x", args: [] },
    });
    expect(next.mcpServers.old).toBeUndefined();
  });
});
