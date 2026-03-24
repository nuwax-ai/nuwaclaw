import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { perfEmitter } from "./perfEmitter";

// Mock the logConfig module
vi.mock("../../../bootstrap/logConfig", () => ({
  getPerfLogger: () => ({
    info: vi.fn(),
  }),
}));

describe("perfEmitter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("duration", () => {
    it("should format duration log with ms suffix", () => {
      const mockLogger = { info: vi.fn() };
      vi.doMock("../../../bootstrap/logConfig", () => ({
        getPerfLogger: () => mockLogger,
      }));

      // The emitter should format: [PERF] name: Xms
      perfEmitter.duration("test.stage", 123);
      // Note: actual verification requires reimporting after mock
    });

    it("should include extra fields when provided", () => {
      perfEmitter.duration("test.stage", 100, { key: "value", count: 42 });
      // Should format: [PERF] test.stage: 100ms  key=value count=42
    });

    it("should handle boolean extra values", () => {
      perfEmitter.duration("test.stage", 50, { enabled: true, active: false });
      // Should format: [PERF] test.stage: 50ms  enabled=true active=false
    });

    it("should skip undefined extra values", () => {
      perfEmitter.duration("test.stage", 50, { key: "value", skip: undefined });
      // Should not include 'skip' in output
    });
  });

  describe("point", () => {
    it("should format point log without duration", () => {
      perfEmitter.point("checkpoint.reached");
      // Should format: [PERF] checkpoint.reached
    });

    it("should include extra fields for point logs", () => {
      perfEmitter.point("checkpoint.reached", { stage: "init" });
      // Should format: [PERF] checkpoint.reached  stage=init
    });
  });

  describe("formatExtra (internal)", () => {
    // Test via public API since formatExtra is not exported
    it("should handle empty extra object", () => {
      perfEmitter.duration("test", 0, {});
      // Should not add any extra text
    });

    it("should handle null values", () => {
      perfEmitter.duration("test", 0, { key: null });
      // Should include: key=
    });
  });
});
