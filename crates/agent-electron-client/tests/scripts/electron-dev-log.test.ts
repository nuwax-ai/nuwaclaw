import { describe, expect, it } from "vitest";
import { shouldKeepDevLogLine } from "../../scripts/dev/electron-dev-log-filter.mjs";

describe("electron-dev-log filter", () => {
  it("keeps electron main process lines", () => {
    expect(
      shouldKeepDevLogLine("[1] 18:44:23.139 > [Init] ttyd terminal service started"),
    ).toBe(true);
  });

  it("drops routine vite lines", () => {
    expect(
      shouldKeepDevLogLine("[0]   VITE v6.4.1  ready in 482 ms"),
    ).toBe(false);
  });

  it("keeps vite errors", () => {
    expect(
      shouldKeepDevLogLine("[0] error: something failed in vite"),
    ).toBe(true);
  });

  it("strips ansi before filtering", () => {
    expect(
      shouldKeepDevLogLine("\x1b[32m[0]\x1b[39m  VITE ready"),
    ).toBe(false);
  });
});
