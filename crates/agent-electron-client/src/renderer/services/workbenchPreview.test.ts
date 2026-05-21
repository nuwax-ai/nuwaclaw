import { describe, expect, it, vi } from "vitest";
import {
  prepareWorkbenchPreviewSession,
  resolvePreviewCookieUrl,
} from "./workbenchPreview";

describe("resolvePreviewCookieUrl", () => {
  it("优先使用预览页 origin", () => {
    expect(
      resolvePreviewCookieUrl(
        "https://app.example.com",
        "https://app.example.com/custom/page?id=1",
      ),
    ).toBe("https://app.example.com");
  });

  it("预览 URL 无效时回退 baseUrl", () => {
    expect(
      resolvePreviewCookieUrl("https://app.example.com/", "not-a-url"),
    ).toBe("https://app.example.com");
  });
});

describe("prepareWorkbenchPreviewSession", () => {
  it("缺少 token 时不调用 session API", async () => {
    const setCookie = vi.fn();
    (globalThis as { window?: { electronAPI?: unknown } }).window = {
      electronAPI: {
        session: { setCookie },
      },
    };

    await prepareWorkbenchPreviewSession(
      "https://app.example.com",
      "https://app.example.com/page",
      "   ",
    );

    expect(setCookie).not.toHaveBeenCalled();
  });

  it("有 token 时写入 ticket cookie", async () => {
    const setCookie = vi.fn().mockResolvedValue({ success: true });
    const getCookie = vi
      .fn()
      .mockResolvedValue({ success: true, value: "tok" });
    (globalThis as { window?: { electronAPI?: unknown } }).window = {
      electronAPI: {
        session: { setCookie, getCookie },
      },
    };

    await prepareWorkbenchPreviewSession(
      "https://app.example.com",
      "https://app.example.com/custom",
      "session-tok",
    );

    expect(setCookie).toHaveBeenCalledWith({
      url: "https://app.example.com",
      name: "ticket",
      value: "session-tok",
      httpOnly: true,
    });
  });
});
