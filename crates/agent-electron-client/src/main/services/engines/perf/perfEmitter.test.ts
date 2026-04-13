import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// 使用 vi.hoisted 创建共享 mock，确保测试中可访问
const mockPerfLogger = vi.hoisted(() => ({
  info: vi.fn(),
}));

vi.mock("../../../bootstrap/logConfig", () => ({
  getPerfLogger: () => mockPerfLogger,
}));

// 在 mock 设置后再 import，确保使用 mock 版本
import { perfEmitter } from "./perfEmitter";

describe("perfEmitter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("duration", () => {
    it("should format duration log with ms suffix", () => {
      perfEmitter.duration("test.stage", 123);

      expect(mockPerfLogger.info).toHaveBeenCalledTimes(1);
      expect(mockPerfLogger.info).toHaveBeenCalledWith(
        expect.stringContaining("[PERF] test.stage: 123ms"),
      );
    });

    it("should include extra fields when provided", () => {
      perfEmitter.duration("test.stage", 100, { key: "value", count: 42 });

      expect(mockPerfLogger.info).toHaveBeenCalledWith(
        expect.stringMatching(/test\.stage: 100ms\s+key=value\s+count=42/),
      );
    });

    it("should handle boolean extra values", () => {
      perfEmitter.duration("test.stage", 50, { enabled: true, active: false });

      expect(mockPerfLogger.info).toHaveBeenCalledWith(
        expect.stringMatching(/enabled=true\s+active=false/),
      );
    });

    it("should skip undefined extra values", () => {
      perfEmitter.duration("test.stage", 50, { key: "value", skip: undefined });

      const call = mockPerfLogger.info.mock.calls[0][0];
      expect(call).toContain("key=value");
      expect(call).not.toContain("skip");
    });
  });

  describe("point", () => {
    it("should format point log without duration", () => {
      perfEmitter.point("checkpoint.reached");

      expect(mockPerfLogger.info).toHaveBeenCalledWith(
        expect.stringContaining("[PERF] checkpoint.reached"),
      );
    });

    it("should include extra fields for point logs", () => {
      perfEmitter.point("checkpoint.reached", { stage: "init" });

      expect(mockPerfLogger.info).toHaveBeenCalledWith(
        expect.stringMatching(/checkpoint\.reached\s+stage=init/),
      );
    });
  });

  describe("formatExtra (internal)", () => {
    it("should handle empty extra object", () => {
      perfEmitter.duration("test", 0, {});

      const call = mockPerfLogger.info.mock.calls[0][0];
      // 无 extra 字段，不应有额外的空格+key=value
      expect(call).toMatch(/\[PERF\] test: 0ms$/);
    });

    it("should handle null values", () => {
      perfEmitter.duration("test", 0, { key: null });

      const call = mockPerfLogger.info.mock.calls[0][0];
      expect(call).toContain("key=");
    });

    it("should handle multiple extra fields", () => {
      perfEmitter.duration("test", 1, { a: "1", b: "2", c: "3" });

      const call = mockPerfLogger.info.mock.calls[0][0];
      expect(call).toContain("a=1");
      expect(call).toContain("b=2");
      expect(call).toContain("c=3");
    });
  });
});
