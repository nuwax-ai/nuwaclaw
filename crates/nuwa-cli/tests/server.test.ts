import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
} from "vitest";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs";
import { startServeHttp } from "../src/core/serve/server.js";

// Deterministically forces engine.resolve() to fail without needing a real
// network call or a specific machine's installed tools: temporarily hide
// every PATH entry so `which claude` can't find anything.
let savedPath: string | undefined;
beforeEach(() => {
  savedPath = process.env.PATH;
  process.env.PATH = "/nonexistent-nuwa-cli-test-path";
});
afterEach(() => {
  process.env.PATH = savedPath;
});

describe("serve HTTP server", () => {
  let handle: ReturnType<typeof startServeHttp>;
  const serverCwd = path.join(os.tmpdir(), "nuwa-cli-server-test-workspaces");
  const workspaceUser = "nuwa-cli-test-user";
  const agentWorkDir = "nuwa-cli-test-agent-work-dir";
  const workspaceProject = "nuwa-cli-test-project-id";
  const workspacePath = path.join(serverCwd, workspaceProject);

  beforeAll(async () => {
    // Isolate the serve lock so the test's server doesn't clobber a real
    // `nuwa-cli serve` lock on the dev machine (startServeHttp writes one on
    // listen, stop() clears it).
    process.env.NUWACLAW_SERVE_LOCK_PATH = path.join(
      os.tmpdir(),
      "nuwa-cli-server-test.lock",
    );
    process.env.NUWACLAW_DEBUG_LOG_PATH = path.join(
      os.tmpdir(),
      "nuwa-cli-server-test-debug.log",
    );
    fs.mkdirSync(serverCwd, { recursive: true });
    handle = startServeHttp({
      port: 0,
      host: "127.0.0.1",
      engine: "claude",
      cwd: serverCwd,
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
    fs.rmSync(serverCwd, { recursive: true, force: true });
    if (process.env.NUWACLAW_DEBUG_LOG_PATH) {
      fs.rmSync(process.env.NUWACLAW_DEBUG_LOG_PATH, { force: true });
    }
    delete process.env.NUWACLAW_SERVE_LOCK_PATH;
    delete process.env.NUWACLAW_DEBUG_LOG_PATH;
  });

  function url(pathname: string): string {
    const address = handle.server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    return `http://127.0.0.1:${port}${pathname}`;
  }

  it("/health responds without requiring the secret", async () => {
    const res = await fetch(url("/health"));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      status: "ok",
      engine: "claude",
    });
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
    expect(await res.json()).toMatchObject({
      code: "0000",
      data: { sessions: [] },
      sessions: [],
      success: true,
    });
  });

  it("accepts bearer auth for non-SSE routes", async () => {
    const res = await fetch(url("/computer/agent/status"), {
      headers: { Authorization: `Bearer ${handle.secret}` },
    });
    expect(res.status).toBe(200);
  });

  it("accepts query auth for non-SSE routes", async () => {
    const res = await fetch(
      url(`/computer/agent/status?apiKey=${encodeURIComponent(handle.secret)}`),
    );
    expect(res.status).toBe(200);
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

  it("returns an idle SSE end event for progress on an unknown session", async () => {
    const res = await fetch(url("/computer/progress/does-not-exist"), {
      headers: { "X-Nuwax-Internal-Secret": handle.secret },
    });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("event: end_turn");
  });

  it("allows unauthenticated Electron-compatible progress SSE connections", async () => {
    const res = await fetch(url("/computer/progress/does-not-exist"));
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("Agent has no task in progress");
  });

  it("rewrites Electron-compatible /devcomputer/progress SSE paths", async () => {
    const res = await fetch(url("/devcomputer/progress/does-not-exist"));
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("event: end_turn");
  });

  it("rejects an explicit missing workspace cwd before starting an engine", async () => {
    const missing = path.join(os.tmpdir(), "nuwa-cli-missing-workspace-cwd");
    fs.rmSync(missing, { recursive: true, force: true });

    const res = await fetch(url("/computer/chat"), {
      method: "POST",
      headers: {
        "X-Nuwax-Internal-Secret": handle.secret,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ prompt: "hi", cwd: missing }),
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      code: "VALIDATION_ERROR",
      success: false,
    });
  });

  it("creates a CLI-owned project workspace from project_id under the active workspace root", async () => {
    fs.rmSync(workspacePath, { recursive: true, force: true });

    const res = await fetch(url("/computer/chat"), {
      method: "POST",
      headers: {
        "X-Nuwax-Internal-Secret": handle.secret,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        prompt: "hi",
        user_id: workspaceUser,
        agent_work_dir: agentWorkDir,
        project_id: workspaceProject,
      }),
    });

    expect(res.status).toBe(502);
    expect(fs.existsSync(workspacePath)).toBe(true);
  });

  it("uses an explicitly configured cwd as the project directory itself", async () => {
    const projectDir = path.join(serverCwd, "explicit-project-dir");
    fs.mkdirSync(projectDir, { recursive: true });
    const explicit = startServeHttp({
      port: 0,
      host: "127.0.0.1",
      engine: "claude",
      cwd: projectDir,
      cwdIsProject: true,
      permissionMode: "yolo",
    });
    await new Promise<void>((resolve) =>
      explicit.server.once("listening", resolve),
    );
    const address = explicit.server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    const res = await fetch(`http://127.0.0.1:${port}/computer/chat`, {
      method: "POST",
      headers: {
        "X-Nuwax-Internal-Secret": explicit.secret,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        prompt: "hi",
        user_id: workspaceUser,
        project_id: "should-not-be-appended",
      }),
    });
    await explicit.stop();

    expect(res.status).toBe(502);
    expect(fs.existsSync(path.join(projectDir, "should-not-be-appended"))).toBe(
      false,
    );
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
    expect(await statusRes.json()).toMatchObject({
      code: "0000",
      data: { sessions: [] },
      sessions: [],
    });
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

  it("supports Electron-style POST /computer/agent/status", async () => {
    const res = await fetch(url("/computer/agent/status"), {
      method: "POST",
      headers: {
        "X-Nuwax-Internal-Secret": handle.secret,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ user_id: "u1", project_id: "p1" }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      code: "0000",
      data: {
        user_id: "u1",
        project_id: "p1",
        is_alive: false,
        session_id: null,
      },
    });
  });

  it("supports idempotent Electron-style session cancel", async () => {
    const res = await fetch(url("/computer/agent/session/cancel"), {
      method: "POST",
      headers: {
        "X-Nuwax-Internal-Secret": handle.secret,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ user_id: "u1", project_id: "p1" }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      code: "0000",
      data: { success: true },
    });
  });

  it("accepts notify-resolved as a no-op in headless CLI mode", async () => {
    const res = await fetch(url("/computer/notify-resolved"), {
      method: "POST",
      headers: {
        "X-Nuwax-Internal-Secret": handle.secret,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ok: true }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      code: "0000",
      data: { success: true, ignored: true },
    });
  });

  it("allows unauthenticated computer routes when Electron-compatible tunnel mode is enabled", async () => {
    const compat = startServeHttp({
      port: 0,
      host: "127.0.0.1",
      engine: "claude",
      cwd: "/tmp",
      permissionMode: "yolo",
      allowUnauthenticatedComputerRoutes: true,
    });
    await new Promise<void>((resolve) =>
      compat.server.once("listening", resolve),
    );
    const address = compat.server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    const compatUrl = (pathname: string) =>
      `http://127.0.0.1:${port}${pathname}`;

    try {
      const statusRes = await fetch(compatUrl("/computer/agent/status"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: "u1", project_id: "p1" }),
      });
      expect(statusRes.status).toBe(200);

      const chatRes = await fetch(compatUrl("/devcomputer/chat"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: "hi", user_id: "u1", project_id: "p1" }),
      });
      expect(chatRes.status).toBe(502);
    } finally {
      await compat.stop();
    }
  });
});
