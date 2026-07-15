import { describe, it, expect } from "vitest";
import * as path from "node:path";
import * as url from "node:url";
import { withEngineConnection } from "../src/core/acp/connection.js";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const fixturePath = path.join(__dirname, "fixtures", "mock-acp-agent.mjs");

function spawnTarget() {
  return {
    command: process.execPath,
    args: [fixturePath],
    env: process.env,
    cwd: process.cwd(),
  };
}

describe("withEngineConnection", () => {
  it("initializes, starts a session, and streams agent_message_chunk text", async () => {
    const chunks: string[] = [];
    const result = await withEngineConnection(
      spawnTarget(),
      { permissionMode: "yolo", onAgentText: (t) => chunks.push(t) },
      async (ctx) => {
        const session = await ctx.buildSession(process.cwd()).start();
        await session.prompt("hi");
        return session.sessionId;
      },
    );
    expect(result).toMatch(/^mock-session-/);
    expect(chunks.join("")).toBe("Hello, world!");
  });

  it("routes a session/request_permission call through the permission handler (yolo picks allow_always)", async () => {
    const chunks: string[] = [];
    await withEngineConnection(
      spawnTarget(),
      { permissionMode: "yolo", onAgentText: (t) => chunks.push(t) },
      async (ctx) => {
        const session = await ctx.buildSession(process.cwd()).start();
        await session.prompt("trigger-permission");
      },
    );
    expect(chunks.join("")).toBe("decision:allow-always");
  });

  it("denies and reports the reject option in deny-noninteractive mode", async () => {
    const chunks: string[] = [];
    await withEngineConnection(
      spawnTarget(),
      {
        permissionMode: "deny-noninteractive",
        onAgentText: (t) => chunks.push(t),
      },
      async (ctx) => {
        const session = await ctx.buildSession(process.cwd()).start();
        await session.prompt("trigger-permission");
      },
    );
    expect(chunks.join("")).toBe("decision:reject-once");
  });

  it("rejects the op promise when the engine process exits non-zero", async () => {
    await expect(
      withEngineConnection(
        spawnTarget(),
        { permissionMode: "yolo", onAgentText: () => {} },
        async (ctx) => {
          const session = await ctx.buildSession(process.cwd()).start();
          await session.prompt("trigger-error");
        },
      ),
    ).rejects.toThrow(/异常退出/);
  });

  it("replays history via session/load and delivers it as agent text", async () => {
    const chunks: string[] = [];
    await withEngineConnection(
      spawnTarget(),
      { permissionMode: "yolo", onAgentText: (t) => chunks.push(t) },
      async (ctx) => {
        await ctx.request("session/load", {
          sessionId: "some-existing-id",
          cwd: process.cwd(),
          mcpServers: [],
        });
      },
    );
    expect(chunks.join("")).toBe("(replayed history)");
  });

  it("interrupts a hung prompt when the abort signal fires (and tears down the engine)", async () => {
    const controller = new AbortController();
    const result = withEngineConnection(
      spawnTarget(),
      { permissionMode: "yolo", onAgentText: () => {} },
      async (ctx) => {
        const session = await ctx.buildSession(process.cwd()).start();
        await session.prompt("trigger-hang"); // mock never responds to this
        return "unreachable";
      },
      controller.signal,
    );
    // Let initialize + session/new + session/prompt round-trip, then abort.
    await new Promise((resolve) => setTimeout(resolve, 200));
    controller.abort();
    await expect(result).rejects.toThrow(/已被中止/);
  });
});
