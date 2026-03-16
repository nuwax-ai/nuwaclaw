/**
 * Tests for securityManager — token, rate limiter, audit log
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const mockLog = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock('electron-log', () => ({
  default: mockLog,
}));

import {
  generateToken,
  getToken,
  validateToken,
  rotateToken,
  clearToken,
  initRateLimiter,
  consumeRateToken,
  resetRateLimiter,
  logAudit,
  getAuditLog,
  clearAuditLog,
} from './securityManager';

describe('securityManager', () => {
  beforeEach(() => {
    clearToken();
    resetRateLimiter();
    clearAuditLog();
  });

  // ==================== Token ====================

  describe('token management', () => {
    it('generateToken returns a UUID string', () => {
      const token = generateToken();
      expect(token).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    });

    it('getToken returns null before generation', () => {
      expect(getToken()).toBeNull();
    });

    it('getToken returns the current token after generation', () => {
      const token = generateToken();
      expect(getToken()).toBe(token);
    });

    it('rotateToken generates a new different token', () => {
      const first = generateToken();
      const second = rotateToken();
      expect(second).not.toBe(first);
      expect(getToken()).toBe(second);
    });

    it('clearToken sets token to null', () => {
      generateToken();
      clearToken();
      expect(getToken()).toBeNull();
    });
  });

  // ==================== validateToken ====================

  describe('validateToken', () => {
    it('returns false when no token generated', () => {
      expect(validateToken('Bearer test')).toBe(false);
    });

    it('returns false when authHeader is undefined', () => {
      generateToken();
      expect(validateToken(undefined)).toBe(false);
    });

    it('returns false when authHeader is empty', () => {
      generateToken();
      expect(validateToken('')).toBe(false);
    });

    it('validates correct Bearer token', () => {
      const token = generateToken();
      expect(validateToken(`Bearer ${token}`)).toBe(true);
    });

    it('validates token without Bearer prefix', () => {
      const token = generateToken();
      expect(validateToken(token)).toBe(true);
    });

    it('rejects wrong token', () => {
      generateToken();
      expect(validateToken('Bearer wrong-token')).toBe(false);
    });

    it('rejects token with different length', () => {
      generateToken();
      expect(validateToken('Bearer short')).toBe(false);
    });

    it('rejects after token is cleared', () => {
      const token = generateToken();
      clearToken();
      expect(validateToken(`Bearer ${token}`)).toBe(false);
    });
  });

  // ==================== Rate Limiter ====================

  describe('rate limiter', () => {
    it('allows requests when no limiter is initialized', () => {
      expect(consumeRateToken()).toBe(true);
    });

    it('allows up to maxTokens requests initially', () => {
      initRateLimiter(3);
      expect(consumeRateToken()).toBe(true);
      expect(consumeRateToken()).toBe(true);
      expect(consumeRateToken()).toBe(true);
      expect(consumeRateToken()).toBe(false);
    });

    it('refills tokens over time', () => {
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

    it('resetRateLimiter disables rate limiting', () => {
      initRateLimiter(1);
      consumeRateToken();
      expect(consumeRateToken()).toBe(false);
      resetRateLimiter();
      expect(consumeRateToken()).toBe(true); // no limiter = always allow
    });

    it('does not exceed maxTokens on refill', () => {
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
  });

  // ==================== Audit Log ====================

  describe('audit log', () => {
    it('starts empty', () => {
      expect(getAuditLog()).toEqual([]);
    });

    it('records entries with timestamps', () => {
      logAudit({ path: '/gui/health', action: 'health', success: true });
      const log = getAuditLog();
      expect(log).toHaveLength(1);
      expect(log[0].path).toBe('/gui/health');
      expect(log[0].action).toBe('health');
      expect(log[0].success).toBe(true);
      expect(typeof log[0].timestamp).toBe('number');
    });

    it('respects limit parameter', () => {
      logAudit({ path: '/a', action: 'a', success: true });
      logAudit({ path: '/b', action: 'b', success: true });
      logAudit({ path: '/c', action: 'c', success: true });
      expect(getAuditLog(2)).toHaveLength(2);
      expect(getAuditLog(2)[0].path).toBe('/b'); // returns last 2
    });

    it('enforces max 1000 entries (ring buffer)', () => {
      for (let i = 0; i < 1010; i++) {
        logAudit({ path: `/test/${i}`, action: 'test', success: true });
      }
      const log = getAuditLog(1100);
      expect(log.length).toBeLessThanOrEqual(1000);
      // First entries should be dropped
      expect(log[0].path).toBe('/test/10');
    });

    it('clearAuditLog empties the log', () => {
      logAudit({ path: '/test', action: 'test', success: true });
      clearAuditLog();
      expect(getAuditLog()).toEqual([]);
    });

    it('logs failed actions via electron-log', () => {
      mockLog.warn.mockClear();
      logAudit({ path: '/gui/input', action: 'input', success: false, error: 'rate limit' });
      expect(mockLog.warn).toHaveBeenCalled();
    });
  });
});
