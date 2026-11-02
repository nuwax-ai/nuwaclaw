import { describe, expect, it } from "vitest";

import { parseAcpModeId, resolveEffectiveMode } from "./acpMode";

describe("parseAcpModeId", () => {
  it("parses ask/yolo and rejects unknown values", () => {
    expect(parseAcpModeId("ask")).toBe("ask");
    expect(parseAcpModeId("yolo")).toBe("yolo");
    expect(parseAcpModeId("auto")).toBeNull();
    expect(parseAcpModeId(undefined)).toBeNull();
  });
});

describe("resolveEffectiveMode", () => {
  it("defaults missing agent_mode to yolo", () => {
    expect(resolveEffectiveMode(undefined)).toEqual({
      mode: "yolo",
      isFallback: false,
    });
    expect(resolveEffectiveMode(null)).toEqual({
      mode: "yolo",
      isFallback: false,
    });
  });

  it("keeps supported modes and fail-safes unknown modes to ask", () => {
    expect(resolveEffectiveMode("ask")).toEqual({
      mode: "ask",
      isFallback: false,
    });
    expect(resolveEffectiveMode("yolo")).toEqual({
      mode: "yolo",
      isFallback: false,
    });
    expect(resolveEffectiveMode("auto")).toEqual({
      mode: "ask",
      isFallback: true,
    });
  });
});
