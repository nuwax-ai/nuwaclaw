import { describe, it, expect, beforeEach } from "vitest";
import type { ComputerChatRequest } from "@shared/types/computerTypes";
import { ensureSessionIdFromRegistry } from "./ensureChatSessionId";
import {
  rememberProjectSession,
  clearProjectSessionRegistry,
} from "./projectSessionRegistry";

function chatRequest(
  overrides: Partial<ComputerChatRequest> = {},
): ComputerChatRequest {
  return {
    user_id: "u1",
    project_id: "1553935",
    prompt: "hi",
    ...overrides,
  };
}

describe("ensureSessionIdFromRegistry", () => {
  beforeEach(() => {
    clearProjectSessionRegistry();
  });

  it("returns existing session_id unchanged", () => {
    const req = chatRequest({ session_id: "sess-existing" });
    expect(ensureSessionIdFromRegistry(req)).toBe("sess-existing");
    expect(req.session_id).toBe("sess-existing");
  });

  it("fills session_id from registry by project_id", () => {
    rememberProjectSession("1553935", "sess_f98efbab");
    const req = chatRequest();
    expect(ensureSessionIdFromRegistry(req)).toBe("sess_f98efbab");
    expect(req.session_id).toBe("sess_f98efbab");
  });

  it("prefers agent_work_dir over project_id for lookup", () => {
    rememberProjectSession("/work/1553935", "sess-from-workdir");
    rememberProjectSession("1553935", "sess-from-project");
    const req = chatRequest({
      agent_work_dir: "/work/1553935",
    });
    expect(ensureSessionIdFromRegistry(req)).toBe("sess-from-workdir");
  });
});
