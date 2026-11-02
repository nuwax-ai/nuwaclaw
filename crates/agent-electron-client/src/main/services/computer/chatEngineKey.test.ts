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

describe("chatEngineKey · normalProject 作用域隔离", () => {
  it("同 id 不同业务（normalProject vs 普通会话）key 不同——防撞号共用引擎", () => {
    // 常规项目 id（devTargetId）与 conversationId 同为数字单段名，撞号时
    // 两类会话 projectDir 不同层，绝不能共用引擎实例
    const npKey = resolveChatEngineRegistryKey(
      req({
        agent_work_dir: "42",
        service_type: "computer-normal-project",
      }),
    );
    const plainKey = resolveChatEngineRegistryKey(
      req({ agent_work_dir: "42" }),
    );
    expect(npKey).toBe("normalProject:42");
    expect(plainKey).toBe("42");
    expect(npKey).not.toBe(plainKey);
  });

  it("camelCase 旧词 normalProject 同样加前缀", () => {
    expect(
      resolveChatEngineRegistryKey(
        req({ agent_work_dir: "42", service_type: "normalProject" }),
      ),
    ).toBe("normalProject:42");
  });

  it("同常规项目多会话（同 service_type + 同 id）key 一致——共享引擎语义保持", () => {
    const a = resolveChatEngineRegistryKey(
      req({
        agent_work_dir: "42",
        session_id: "conv-1",
        service_type: "computer-normal-project",
      }),
    );
    const b = resolveChatEngineRegistryKey(
      req({
        agent_work_dir: "42",
        session_id: "conv-2",
        service_type: "computer-normal-project",
      }),
    );
    expect(a).toBe(b);
  });

  it("candidates 同时给出前缀形态与原始形态（兼容存量引擎定位）", () => {
    expect(
      resolveChatEngineKeyCandidates(
        req({
          agent_work_dir: "42",
          project_id: undefined,
          session_id: undefined,
          service_type: "computer-normal-project",
        }),
      ),
    ).toEqual(["normalProject:42", "42"]);
  });

  it("projectSessionRegistry key 同样按业务隔离", () => {
    expect(
      resolveChatProjectRegistryKey(
        req({ agent_work_dir: "42", service_type: "computer-normal-project" }),
      ),
    ).toBe("normalProject:42");
    expect(resolveChatProjectRegistryKey(req({ agent_work_dir: "42" }))).toBe(
      "42",
    );
  });
});
