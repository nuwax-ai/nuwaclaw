import { describe, it, expect } from "vitest";
import type { ComputerChatRequest } from "@shared/types/computerTypes";
import {
  resolveChatEngineRegistryKey,
  resolveChatEngineKey,
  resolveChatEngineKeyCandidates,
  resolveChatProjectRegistryKey,
} from "./chatEngineKey";

function req(
  overrides: Partial<ComputerChatRequest> = {},
): ComputerChatRequest {
  return {
    user_id: "u1",
    project_id: "proj-1",
    prompt: "hi",
    ...overrides,
  };
}

describe("chatEngineKey", () => {
  it("resolveChatEngineRegistryKey prefers agent_work_dir", () => {
    expect(
      resolveChatEngineRegistryKey(
        req({
          agent_work_dir: "work-a",
          project_id: "proj-b",
          session_id: "sess-c",
        }),
      ),
    ).toBe("work-a");
  });

  it("resolveChatEngineRegistryKey falls back to default", () => {
    expect(resolveChatEngineRegistryKey(req({ project_id: undefined }))).toBe(
      "default",
    );
  });

  it("resolveChatEngineKey returns undefined when only default would apply", () => {
    expect(
      resolveChatEngineKey(req({ project_id: undefined })),
    ).toBeUndefined();
  });

  it("resolveChatEngineKeyCandidates dedupes and preserves order", () => {
    expect(
      resolveChatEngineKeyCandidates(
        req({
          agent_work_dir: "work-a",
          project_id: "proj-b",
          session_id: "sess-c",
        }),
      ),
    ).toEqual(["work-a", "proj-b", "sess-c"]);
  });

  it("resolveChatProjectRegistryKey ignores session_id", () => {
    expect(
      resolveChatProjectRegistryKey(
        req({ agent_work_dir: "work-a", session_id: "sess-c" }),
      ),
    ).toBe("work-a");
    expect(resolveChatProjectRegistryKey(req({ session_id: "sess-c" }))).toBe(
      "proj-1",
    );
  });
});
