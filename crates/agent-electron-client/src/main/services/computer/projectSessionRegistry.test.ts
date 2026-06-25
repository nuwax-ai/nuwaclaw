import { describe, it, expect, beforeEach } from "vitest";
import {
  rememberProjectSession,
  resolveProjectSession,
  captureSessionsForProject,
  clearProjectSessionRegistry,
} from "./projectSessionRegistry";

describe("projectSessionRegistry", () => {
  beforeEach(() => {
    clearProjectSessionRegistry();
  });

  it("remembers and resolves session by project key", () => {
    rememberProjectSession("1553935", "sess_abc");
    expect(resolveProjectSession("1553935")).toBe("sess_abc");
  });

  it("captureSessionsForProject prefers request session_id when in list", () => {
    captureSessionsForProject("proj-1", ["sess-a", "sess-b"], "sess-a");
    expect(resolveProjectSession("proj-1")).toBe("sess-a");
  });

  it("captureSessionsForProject uses last session when no preferred id", () => {
    captureSessionsForProject("proj-1", ["sess-a", "sess-b"]);
    expect(resolveProjectSession("proj-1")).toBe("sess-b");
  });
});
