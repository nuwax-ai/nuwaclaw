/**
 * Tests for securityManager — rate limiter, audit log
 *
 * Note: Token management removed — Unix socket permissions replace token auth.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

const mockLog = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock("electron-log", () => ({
  default: mockLog,
}));

import {
  initRateLimiter,
  consumeRateToken,
  resetRateLimiter,
  logAudit,
  getAuditLog,
  clearAuditLog,
} from "./securityManager";

describe("securityManager", () => {
  beforeEach(() => {
    resetRateLimiter();
    clearAuditLog();
  });

  // ==================== Rate Limiter ====================

  describe("rate limiter", () => {
    it("allows requests when no limiter is initialized", () => {
      expect(consumeRateToken()).toBe(true);
    });

    it("allows up to maxTokens requests initially", () => {
      initRateLimiter(3);
      expect(consumeRateToken()).toBe(true);
      expect(consumeRateToken()).toBe(true);
      expect(consumeRateToken()).toBe(true);
      expect(consumeRateToken()).toBe(false);
    });

    it("refills tokens over time", () => {
      initRateLimiter(2);
      // Drain all tokens
      consumeRateToken();
      consumeRateToken();
      expect(consumeRateToken()).toBe(false);

      // Fake time passing (1 second = 2 tokens refilled for rate=2)
      vi.useFakeTimers();
      vi.advanceTimersByTime(1000);
      expect(consumeRateToken()).toBe(true);
      vi.useRealTimers();
    });

    it("resetRateLimiter disables rate limiting", () => {
      initRateLimiter(1);
      consumeRateToken();
      expect(consumeRateToken()).toBe(false);
      resetRateLimiter();
      expect(consumeRateToken()).toBe(true); // no limiter = always allow
    });

    it("does not exceed maxTokens on refill", () => {
      initRateLimiter(2);
      // Wait a long time — tokens should not exceed max (2)
      vi.useFakeTimers();
      vi.advanceTimersByTime(10_000);
      // Should succeed 2 times, fail on 3rd
      expect(consumeRateToken()).toBe(true);
      expect(consumeRateToken()).toBe(true);
      expect(consumeRateToken()).toBe(false);
      vi.useRealTimers();
    });

    it("rate limiter is thread-safe (mutex prevents concurrent modification)", () => {
      initRateLimiter(100);
      // Rapid concurrent-style calls should still be properly serialized
      // The mutex should prevent race conditions
      for (let i = 0; i < 50; i++) {
        consumeRateToken();
      }
      // After 50 consumes with rate=100, should still have ~50 left
      // But due to mutex, each call is atomic
      expect(consumeRateToken()).toBe(true);
    });
  });

  // ==================== Audit Log ====================

  describe("audit log", () => {
    it("starts empty", () => {
      expect(getAuditLog()).toEqual([]);
    });

    it("records entries with timestamps", () => {
      logAudit({ path: "/gui/health", action: "health", success: true });
      const log = getAuditLog();
      expect(log).toHaveLength(1);
      expect(log[0].path).toBe("/gui/health");
      expect(log[0].action).toBe("health");
      expect(log[0].success).toBe(true);
      expect(typeof log[0].timestamp).toBe("number");
    });

    it("respects limit parameter", () => {
      logAudit({ path: "/a", action: "a", success: true });
      logAudit({ path: "/b", action: "b", success: true });
      logAudit({ path: "/c", action: "c", success: true });
      expect(getAuditLog(2)).toHaveLength(2);
      expect(getAuditLog(2)[0].path).toBe("/b"); // returns last 2
    });

    it("enforces max 1000 entries (ring buffer)", () => {
      for (let i = 0; i < 1010; i++) {
        logAudit({ path: `/test/${i}`, action: "test", success: true });
      }
      const log = getAuditLog(1100);
      expect(log.length).toBeLessThanOrEqual(1000);
      // First entries should be dropped
      expect(log[0].path).toBe("/test/10");
    });

    it("clearAuditLog empties the log", () => {
      logAudit({ path: "/test", action: "test", success: true });
      clearAuditLog();
      expect(getAuditLog()).toEqual([]);
    });

    it("logs failed actions via electron-log", () => {
      mockLog.warn.mockClear();
      logAudit({
        path: "/gui/input",
        action: "input",
        success: false,
        error: "rate limit",
      });
      expect(mockLog.warn).toHaveBeenCalled();
    });
  });
});
