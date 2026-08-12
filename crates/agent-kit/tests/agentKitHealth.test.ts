import { describe, it, expect, vi } from "vitest";
import {
  isLanproxyTunnelEnvelopeHealthy,
  waitForFileServerHealth,
  waitForLanproxyTunnel,
  confirmProcessHealthy,
  delay,
} from "../src/index.js";

// Minimal Response-like shape — only `.ok` and `.json()` are consumed.
function mockResponse(body: unknown, ok = true): Response {
  return { ok, json: async () => body } as unknown as Response;
}

describe("agent-kit health primitives", () => {
  describe("isLanproxyTunnelEnvelopeHealthy (pure)", () => {
    it.each([
      ["code 0000", { code: "0000" }],
      ["success true", { success: true }],
      ["data.online true", { data: { online: true } }],
    ])("healthy: %s", (_label, env) => {
      expect(isLanproxyTunnelEnvelopeHealthy(env)).toBe(true);
    });
    it.each([
      ["wrong code", { code: "1", success: false }],
      ["empty", {}],
      ["online false", { data: { online: false } }],
    ])("not healthy: %s", (_label, env) => {
      expect(isLanproxyTunnelEnvelopeHealthy(env)).toBe(false);
    });
  });

  describe("waitForFileServerHealth", () => {
    it("returns healthy on first ok", async () => {
      const f = vi.fn(async () => mockResponse({ status: "ok" })) as unknown as typeof fetch;
      const r = await waitForFileServerHealth({
        port: 60015,
        fetchImpl: f,
        intervalMs: 1,
        timeoutMs: 100,
      });
      expect(r.healthy).toBe(true);
      expect(f).toHaveBeenCalledTimes(1);
    });

    it("polls until timeout when never ok", async () => {
      const f = vi.fn(async () => mockResponse({}, false)) as unknown as typeof fetch;
      const r = await waitForFileServerHealth({
        port: 60015,
        fetchImpl: f,
        intervalMs: 1,
        timeoutMs: 30,
        perRequestTimeoutMs: 1000,
      });
      expect(r.healthy).toBe(false);
      expect(f.mock.calls.length).toBeGreaterThan(1);
    });

    it("stops early on abort", async () => {
      const f = vi.fn(async () => mockResponse({}, false)) as unknown as typeof fetch;
      const ac = new AbortController();
      const p = waitForFileServerHealth({
        port: 60015,
        fetchImpl: f,
        intervalMs: 5,
        timeoutMs: 1000,
        signal: ac.signal,
      });
      ac.abort();
      const r = await p;
      expect(r.healthy).toBe(false);
    });
  });

  describe("waitForLanproxyTunnel", () => {
    it("returns healthy on a valid envelope and hits the right URL", async () => {
      const f = vi.fn(async () => mockResponse({ code: "0000" })) as unknown as typeof fetch;
      const r = await waitForLanproxyTunnel({
        domain: "https://x.example.com/",
        configKey: "k1",
        fetchImpl: f,
        intervalMs: 1,
        timeoutMs: 100,
      });
      expect(r.healthy).toBe(true);
      expect(String(f.mock.calls[0][0])).toMatch(
        /x\.example\.com\/api\/sandbox\/config\/health\/k1/,
      );
    });
  });

  describe("confirmProcessHealthy", () => {
    it("true when alive before and after stabilize", async () => {
      const isAlive = vi.fn(() => true);
      const r = await confirmProcessHealthy({
        pid: 123,
        stabilizeMs: 5,
        isAlive,
      });
      expect(r).toBe(true);
      expect(isAlive.mock.calls.length).toBeGreaterThanOrEqual(2);
    });

    it("false when the process dies during stabilize", async () => {
      let alive = true;
      const isAlive = vi.fn(() => alive);
      const p = confirmProcessHealthy({ pid: 123, stabilizeMs: 10, isAlive });
      alive = false;
      expect(await p).toBe(false);
    });
  });

  it("delay resolves immediately on abort", async () => {
    const ac = new AbortController();
    const p = delay(1000, ac.signal);
    ac.abort();
    await expect(p).resolves.toBeUndefined();
  });
});
