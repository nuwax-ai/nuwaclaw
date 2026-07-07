import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
} from "vitest";
import { startServeHttp } from "../src/core/serve/server.js";

// Deterministically forces engine.resolve() to fail without needing a real
// network call or a specific machine's installed tools: temporarily hide
// every PATH entry so `which claude` can't find anything.
let savedPath: string | undefined;
beforeEach(() => {
  savedPath = process.env.PATH;
  process.env.PATH = "/nonexistent-nuwaclaw-test-path";
});
afterEach(() => {
  process.env.PATH = savedPath;
});

describe("serve HTTP server", () => {
  let handle: ReturnType<typeof startServeHttp>;
  beforeAll(async () => {
    handle = startServeHttp({
      port: 0,
      host: "127.0.0.1",
      engine: "claude",
      cwd: "/tmp",
      permissionMode: "yolo",
    });
    // port: 0 asks the OS for a free port; listen() is async, so wait for it
    // before any test reads server.address() for the real port number.
    await new Promise<void>((resolve) =>
      handle.server.once("listening", resolve),
    );
  });

  afterAll(async () => {
    await handle.stop();
  });

  function url(pathname: string): string {
    const address = handle.server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    return `http://127.0.0.1:${port}${pathname}`;
  }

  it("/health responds without requiring the secret", async () => {
    const res = await fetch(url("/health"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });

  it("rejects requests missing the X-Nuwax-Internal-Secret header", async () => {
    const res = await fetch(url("/computer/agent/status"));
    expect(res.status).toBe(401);
  });

  it("rejects requests with the wrong secret", async () => {
    const res = await fetch(url("/computer/agent/status"), {
      headers: { "X-Nuwax-Internal-Secret": "wrong" },
    });
    expect(res.status).toBe(401);
  });

  it("accepts the correct secret and lists sessions", async () => {
    const res = await fetch(url("/computer/agent/status"), {
      headers: { "X-Nuwax-Internal-Secret": handle.secret },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ sessions: [] });
  });

  it("rejects /computer/chat with no prompt", async () => {
    const res = await fetch(url("/computer/chat"), {
      method: "POST",
      headers: {
        "X-Nuwax-Internal-Secret": handle.secret,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it("returns 404 for progress on an unknown session", async () => {
    const res = await fetch(url("/computer/progress/does-not-exist"), {
      headers: { "X-Nuwax-Internal-Secret": handle.secret },
    });
    expect(res.status).toBe(404);
  });

  it("surfaces engine resolution failure as a 502 and doesn't leave a zombie session", async () => {
    const res = await fetch(url("/computer/chat"), {
      method: "POST",
      headers: {
        "X-Nuwax-Internal-Secret": handle.secret,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ prompt: "hi" }),
    });
    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/claude/);

    const statusRes = await fetch(url("/computer/agent/status"), {
      headers: { "X-Nuwax-Internal-Secret": handle.secret },
    });
    expect(await statusRes.json()).toEqual({ sessions: [] });
  });

  it("returns 404 when stopping an unknown session", async () => {
    const res = await fetch(url("/computer/agent/stop"), {
      method: "POST",
      headers: {
        "X-Nuwax-Internal-Secret": handle.secret,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ session_id: "does-not-exist" }),
    });
    expect(res.status).toBe(404);
  });
});
