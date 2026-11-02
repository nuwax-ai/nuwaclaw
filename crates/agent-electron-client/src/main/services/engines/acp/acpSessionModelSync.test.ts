import { describe, expect, it } from "vitest";
import {
  isAcpMethodNotFoundError,
  isAcpSessionModelSyncMethodNotFound,
} from "./acpSessionModelSync";

describe("isAcpMethodNotFoundError", () => {
  it("识别 JSON-RPC -32601", () => {
    expect(isAcpMethodNotFoundError({ code: -32601, message: "x" })).toBe(true);
  });

  it("识别 Method not found 文案", () => {
    expect(
      isAcpMethodNotFoundError(
        new Error('"Method not found": session/set_config_option'),
      ),
    ).toBe(true);
  });

  it("其它错误返回 false", () => {
    expect(isAcpMethodNotFoundError(new Error("timeout"))).toBe(false);
    expect(isAcpMethodNotFoundError({ code: -32000 })).toBe(false);
  });
});

describe("isAcpSessionModelSyncMethodNotFound", () => {
  it("setSessionConfigOption：匹配 set_config_option 文案", () => {
    expect(
      isAcpSessionModelSyncMethodNotFound(
        new Error('"Method not found": session/set_config_option'),
        "setSessionConfigOption",
      ),
    ).toBe(true);
  });

  it("setSessionConfigOption：泛化 -32601 无 method 名时不匹配", () => {
    expect(
      isAcpSessionModelSyncMethodNotFound(
        { code: -32601, message: "x" },
        "setSessionConfigOption",
      ),
    ).toBe(false);
  });

  it("unstable_setSessionModel：匹配 setSessionModel 文案", () => {
    expect(
      isAcpSessionModelSyncMethodNotFound(
        new Error("Method not found: unstable_setSessionModel"),
        "unstable_setSessionModel",
      ),
    ).toBe(true);
  });

  it("非 Method not found 返回 false", () => {
    expect(
      isAcpSessionModelSyncMethodNotFound(
        new Error("timeout"),
        "setSessionConfigOption",
      ),
    ).toBe(false);
  });
});
