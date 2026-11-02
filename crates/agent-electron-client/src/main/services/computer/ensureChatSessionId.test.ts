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

  it("normalProject 会话 reload 后按带前缀 key 恢复（写入侧带前缀，读取侧双形态探测）", () => {
    // 模拟 chat 成功回写 / devcomputer reload capture：写入侧经
    // resolveChatProjectRegistryKey 对 normalProject 业务带 normalProject: 前缀
    rememberProjectSession("normalProject:42", "sess-np-42");

    // 读取侧请求带 service_type（Java 全类型下发）：前缀形态命中
    const withType = chatRequest({
      agent_work_dir: "42",
      project_id: "1553935",
      service_type: "computer-normal-project",
    });
    expect(ensureSessionIdFromRegistry(withType)).toBe("sess-np-42");

    // 读取侧请求缺 service_type（透传不全）：原始形态查不到带前缀条目，不误命中
    const withoutType = chatRequest({
      agent_work_dir: "42",
      project_id: "1553935",
    });
    expect(ensureSessionIdFromRegistry(withoutType)).toBeUndefined();
  });
});
