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

describe("chatEngineKey · 对话级 key（A2）", () => {
  it("resolveChatEngineRegistryKey prefers project_id (conversationId)", () => {
    expect(
      resolveChatEngineRegistryKey(
        req({
          agent_work_dir: "work-a",
          project_id: "proj-b",
          session_id: "sess-c",
        }),
      ),
    ).toBe("proj-b");
  });

  it("无 project_id 时回退 agent_work_dir", () => {
    expect(
      resolveChatEngineRegistryKey(
        req({ project_id: undefined, agent_work_dir: "work-a" }),
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

  it("candidates 优先 project_id、去重保序", () => {
    expect(
      resolveChatEngineKeyCandidates(
        req({
          agent_work_dir: "work-a",
          project_id: "proj-b",
          session_id: "sess-c",
        }),
      ),
    ).toEqual(["proj-b", "sess-c"]);
  });

  it("resolveChatProjectRegistryKey prefers project_id, ignores session_id", () => {
    expect(
      resolveChatProjectRegistryKey(
        req({
          agent_work_dir: "work-a",
          project_id: "proj-b",
          session_id: "sess-c",
        }),
      ),
    ).toBe("proj-b");
    expect(
      resolveChatProjectRegistryKey(
        req({ agent_work_dir: "work-a", session_id: "sess-c" }),
      ),
    ).toBe("proj-1");
    expect(resolveChatProjectRegistryKey(req({ session_id: "sess-c" }))).toBe(
      "proj-1",
    );
  });
});

describe("chatEngineKey · normalProject 作用域 + 对话级隔离", () => {
  it("normalProject 业务 key 加前缀，主维度为 conversationId", () => {
    expect(
      resolveChatEngineRegistryKey(
        req({
          project_id: "1728392",
          agent_work_dir: "272",
          service_type: "computer-normal-project",
        }),
      ),
    ).toBe("normalProject:1728392");
  });

  it("同常规项目、不同对话 → key 不同（核心修复：可并行不共享引擎）", () => {
    const a = resolveChatEngineRegistryKey(
      req({
        project_id: "1728392",
        agent_work_dir: "272",
        service_type: "computer-normal-project",
      }),
    );
    const b = resolveChatEngineRegistryKey(
      req({
        project_id: "1728395",
        agent_work_dir: "272",
        service_type: "computer-normal-project",
      }),
    );
    expect(a).toBe("normalProject:1728392");
    expect(b).toBe("normalProject:1728395");
    expect(a).not.toBe(b);
  });

  it("同对话（同 project_id）不同 session_id → key 一致（会话复用语义保持）", () => {
    const a = resolveChatEngineRegistryKey(
      req({
        project_id: "1728392",
        agent_work_dir: "272",
        session_id: "conv-1",
        service_type: "computer-normal-project",
      }),
    );
    const b = resolveChatEngineRegistryKey(
      req({
        project_id: "1728392",
        agent_work_dir: "272",
        session_id: "conv-2",
        service_type: "computer-normal-project",
      }),
    );
    expect(a).toBe(b);
  });

  it("normalProject vs 普通会话同 conversationId 不撞——前缀隔离", () => {
    const npKey = resolveChatEngineRegistryKey(
      req({ project_id: "42", service_type: "computer-normal-project" }),
    );
    const plainKey = resolveChatEngineRegistryKey(req({ project_id: "42" }));
    expect(npKey).toBe("normalProject:42");
    expect(plainKey).toBe("42");
    expect(npKey).not.toBe(plainKey);
  });

  it("camelCase 旧词 normalProject 同样加前缀", () => {
    expect(
      resolveChatEngineRegistryKey(
        req({ project_id: "42", service_type: "normalProject" }),
      ),
    ).toBe("normalProject:42");
  });

  it("candidates 同时给出前缀形态与原始形态（兼容存量引擎定位）", () => {
    expect(
      resolveChatEngineKeyCandidates(
        req({
          project_id: "42",
          agent_work_dir: undefined,
          session_id: undefined,
          service_type: "computer-normal-project",
        }),
      ),
    ).toEqual(["normalProject:42", "42"]);
  });

  it("projectSessionRegistry key 按对话 + 业务隔离", () => {
    expect(
      resolveChatProjectRegistryKey(
        req({
          project_id: "1728392",
          agent_work_dir: "272",
          service_type: "computer-normal-project",
        }),
      ),
    ).toBe("normalProject:1728392");
    expect(resolveChatProjectRegistryKey(req({ project_id: "42" }))).toBe("42");
  });
});
