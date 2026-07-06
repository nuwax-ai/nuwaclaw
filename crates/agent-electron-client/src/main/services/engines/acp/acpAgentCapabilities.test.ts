import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  supportsLoadSession,
  supportsResumeSession,
} from "./acpAgentCapabilities";

describe("acpAgentCapabilities", () => {
  it("supportsResumeSession when sessionCapabilities.resume is set", () => {
    expect(
      supportsResumeSession({
        sessionCapabilities: { resume: {} },
      }),
    ).toBe(true);
  });

  it("does not support resume when sessionCapabilities.resume is absent", () => {
    expect(supportsResumeSession({ loadSession: true })).toBe(false);
    expect(supportsResumeSession(null)).toBe(false);
  });

  it("supportsLoadSession only when loadSession is true", () => {
    expect(supportsLoadSession({ loadSession: true })).toBe(true);
    expect(supportsLoadSession({ loadSession: false })).toBe(false);
    expect(supportsLoadSession({ sessionCapabilities: { resume: {} } })).toBe(
      false,
    );
  });
});
