import { beforeEach, describe, expect, it, vi } from "vitest";
import { AUTH_KEYS } from "@shared/constants";
import { getWorkbenchAccessTokenKey } from "@shared/utils/domain";
import {
  readTicketFromSession,
  recoverWorkbenchAccessToken,
} from "./workbenchToken";

let store: Record<string, unknown> = {};

vi.stubGlobal("window", {
  electronAPI: {
    settings: {
      get: vi.fn(async (key: string) => store[key] ?? null),
      set: vi.fn(async (key: string, value: unknown) => {
        store[key] = value;
      }),
      listKeys: vi.fn(async (prefix?: string) => {
        const normalized = prefix ?? "";
        return Object.entries(store)
          .filter(([key]) => key.startsWith(normalized))
          .map(([key, value]) => ({ key, value }));
      }),
    },
    session: {
      getCookieValue: vi.fn(async ({ url }: { url: string }) => ({
        success: true,
        found: true,
        value: url.includes("login.example.com")
          ? "jwt-from-cookie"
          : undefined,
      })),
    },
  },
});

describe("workbenchToken", () => {
  beforeEach(() => {
    store = {};
    vi.clearAllMocks();
  });

  it("readTicketFromSession returns ticket value from session IPC", async () => {
    const token = await readTicketFromSession("https://login.example.com");
    expect(token).toBe("jwt-from-cookie");
  });

  it("recoverWorkbenchAccessToken persists ticket into workbench cache", async () => {
    store[AUTH_KEYS.USER_INFO] = {
      username: "demo",
      currentDomain: "https://login.example.com",
    };

    const token = await recoverWorkbenchAccessToken([
      "https://login.example.com",
    ]);

    expect(token).toBe("jwt-from-cookie");
    expect(store[getWorkbenchAccessTokenKey("https://login.example.com")]).toBe(
      "jwt-from-cookie",
    );
    expect(
      (store[AUTH_KEYS.USER_INFO] as { accessToken?: string }).accessToken,
    ).toBe("jwt-from-cookie");
  });
});
