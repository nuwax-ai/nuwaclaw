import { describe, it, expect, vi } from "vitest";
import {
  createPersistentBridge,
  type McpProxyLogger,
} from "../src/index.js";

const noopLogger: McpProxyLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
};

function mockBridge() {
  return {
    // Type the `start` param so createPersistentBridge's BridgeServers<B>
    // inference resolves to Record<string, unknown> (clean, no `any`).
    start: vi.fn(async (_servers: Record<string, unknown>) => undefined),
    stop: vi.fn(async () => undefined),
  };
}

describe("agent-kit createPersistentBridge", () => {
  it("creates the bridge on first ensureStarted and calls start", async () => {
    const b = mockBridge();
    const handle = createPersistentBridge({
      create: () => b,
      logger: noopLogger,
    });
    expect(handle.isRunning()).toBe(false);
    const r = await handle.ensureStarted({ a: { command: "x" } });
    expect(r).toBe(b);
    expect(b.start).toHaveBeenCalledTimes(1);
    expect(handle.isRunning()).toBe(true);
  });

  it("reuses the same bridge across ensureStarted calls", async () => {
    const b = mockBridge();
    let created = 0;
    const handle = createPersistentBridge({
      create: () => {
        created++;
        return b;
      },
      logger: noopLogger,
    });
    await handle.ensureStarted({ a: 1 });
    await handle.ensureStarted({ b: 2 });
    expect(b.start).toHaveBeenCalledTimes(2);
    expect(created).toBe(1);
  });

  it("forwards every ensureStarted to start — restart on change, no internal dedup", async () => {
    // agent-kit's contract (see proxyBridge.ts file note): ensureStarted always
    // forwards to bridge.start; the injected bridge must be idempotent/diff-aware.
    const b = mockBridge();
    const handle = createPersistentBridge({
      create: () => b,
      logger: noopLogger,
    });
    await handle.ensureStarted({ a: 1 });
    await handle.ensureStarted({ b: 2 }); // new servers → forwarded again
    expect(b.start).toHaveBeenCalledTimes(2);
    expect(b.start).toHaveBeenLastCalledWith({ b: 2 });
    expect(handle.isRunning()).toBe(true);
  });

  it("stops and returns null when servers is empty", async () => {
    const b = mockBridge();
    const handle = createPersistentBridge({
      create: () => b,
      logger: noopLogger,
    });
    await handle.ensureStarted({ a: 1 });
    const r = await handle.ensureStarted({});
    expect(r).toBeNull();
    expect(b.stop).toHaveBeenCalledTimes(1);
    expect(handle.isRunning()).toBe(false);
  });

  it("stop is idempotent and safe when not running", async () => {
    const b = mockBridge();
    const handle = createPersistentBridge({
      create: () => b,
      logger: noopLogger,
    });
    await handle.stop();
    await handle.ensureStarted({ a: 1 });
    await handle.stop();
    await handle.stop();
    expect(b.stop).toHaveBeenCalledTimes(1);
  });

  it("fires onStarted with server names, onStopped on stop", async () => {
    const b = mockBridge();
    const onStarted = vi.fn();
    const onStopped = vi.fn();
    const handle = createPersistentBridge({
      create: () => b,
      logger: noopLogger,
      onStarted,
      onStopped,
    });
    await handle.ensureStarted({ alpha: 1, beta: 2 });
    expect(onStarted).toHaveBeenCalledWith(["alpha", "beta"]);
    await handle.stop();
    expect(onStopped).toHaveBeenCalled();
  });

  it("fires onStopError and clears the bridge when stop throws", async () => {
    const b = {
      start: vi.fn(async () => undefined),
      stop: vi.fn(async () => {
        throw new Error("boom");
      }),
    };
    const onStopError = vi.fn();
    const handle = createPersistentBridge({
      create: () => b,
      logger: noopLogger,
      onStopError,
    });
    await handle.ensureStarted({ a: 1 });
    await handle.stop();
    expect(onStopError).toHaveBeenCalledWith(expect.any(Error));
    expect(handle.isRunning()).toBe(false);
  });
});
