import { describe, it, expect, vi } from "vitest";
import {
  withStartRetry,
  DEFAULT_START_MAX_ATTEMPTS,
  DEFAULT_START_BACKOFF_MS,
} from "../src/index.js";

describe("agent-kit withStartRetry", () => {
  it("exports default retry knobs", () => {
    expect(DEFAULT_START_MAX_ATTEMPTS).toBe(3);
    expect([...DEFAULT_START_BACKOFF_MS]).toEqual([1000, 2000, 4000]);
  });

  it("returns on first success without backoff", async () => {
    const attemptFn = vi.fn(async () => ({ success: true as const }));
    const logger = { info: vi.fn(), warn: vi.fn() };
    const result = await withStartRetry(attemptFn, {
      label: "FileServer",
      logger,
      backoffMs: [1, 1, 1],
    });
    expect(result).toEqual({ success: true });
    expect(attemptFn).toHaveBeenCalledTimes(1);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("retries until success and logs attempts", async () => {
    const attemptFn = vi
      .fn()
      .mockResolvedValueOnce({ success: false, error: "timeout" })
      .mockResolvedValueOnce({ success: false, error: "timeout" })
      .mockResolvedValueOnce({ success: true });
    const logger = { info: vi.fn(), warn: vi.fn() };

    const result = await withStartRetry(attemptFn, {
      label: "Lanproxy",
      logger,
      backoffMs: [1, 1, 1],
    });

    expect(result).toEqual({ success: true });
    expect(attemptFn).toHaveBeenCalledTimes(3);
    expect(logger.warn).toHaveBeenCalledTimes(2);
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining("succeeded on attempt 3/3"),
    );
  });

  it("returns last failure after exhausting attempts", async () => {
    const attemptFn = vi.fn(async () => ({
      success: false as const,
      error: "still down",
    }));
    const result = await withStartRetry(attemptFn, {
      label: "FileServer",
      maxAttempts: 3,
      backoffMs: [1, 1, 1],
    });
    expect(result).toEqual({ success: false, error: "still down" });
    expect(attemptFn).toHaveBeenCalledTimes(3);
  });

  it("stops between attempts when aborted", async () => {
    const ac = new AbortController();
    const attemptFn = vi.fn(async () => {
      ac.abort();
      return { success: false as const, error: "fail" };
    });
    const result = await withStartRetry(attemptFn, {
      label: "FileServer",
      signal: ac.signal,
      backoffMs: [50, 50, 50],
    });
    expect(result.success).toBe(false);
    // First attempt runs; after abort, loop exits before further attempts.
    expect(attemptFn.mock.calls.length).toBeLessThanOrEqual(2);
  });
});
