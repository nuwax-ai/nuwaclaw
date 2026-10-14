import { describe, expect, it, vi, beforeEach } from "vitest";

// A2：IPC status/stop/cancel 必须按 conversationId（project_id）对话级定位引擎/会话，
// 而非按 agent_work_dir（devTargetId）项目级归并——否则同一常规项目下不同对话会互相
// 串扰（status 报错对象、stop/cancel 停错对话）。本测锁死该对话级语义。

const state = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  getEngineForProject: vi.fn(),
  getAcpEngine: vi.fn(),
  stopEngine: vi.fn(),
  findSessionByProjectId: vi.fn(),
  abortSession: vi.fn(),
}));

vi.mock("electron", () => ({
  ipcMain: {
    handle: (name: string, handler: (...args: unknown[]) => unknown) =>
      state.handlers.set(name, handler),
  },
}));

vi.mock("../services/engines/unifiedAgent", () => ({
  agentService: {
    getEngineForProject: state.getEngineForProject,
    getAcpEngine: state.getAcpEngine,
    stopEngine: state.stopEngine,
    ensureEngineForRequest: vi.fn(),
  },
}));

vi.mock("../services/computer/chatDispatchCoordinator", () => ({
  chatDispatchCoordinator: { bumpArrival: vi.fn(() => 1) },
  resolveChatDispatchKey: vi.fn(() => "dispatch-key"),
}));

import { registerComputerHandlers } from "./computerHandlers";

// 同一常规项目（devTargetId=272）下两个不同对话（conversationId）
const NP = "computer-normal-project";
const CONV_A = "1728392";
const CONV_B = "1728395";
const DEV_TARGET = "272";

function makeEngine() {
  return {
    findSessionByProjectId: state.findSessionByProjectId,
    abortSession: state.abortSession,
  };
}

function callHandler(name: string, request: unknown) {
  const handler = state.handlers.get(name);
  expect(handler, `handler ${name} registered`).toBeDefined();
  return handler!({}, request);
}

describe("computerHandlers IPC 对话级定位（A2）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.handlers.clear();
    state.getEngineForProject.mockReturnValue(makeEngine());
    state.findSessionByProjectId.mockImplementation((pid: string) => ({
      id: `sess-${pid}`,
      status: "active",
      createdAt: 0,
      lastActivity: 0,
    }));
    registerComputerHandlers();
  });

  it("agentStatus：按 conversationId 建键并反查会话（非 agent_work_dir）", async () => {
    const res = (await callHandler("computer:agentStatus", {
      user_id: "u1",
      project_id: CONV_A,
      agent_work_dir: DEV_TARGET,
      service_type: NP,
    })) as any;

    expect(state.getEngineForProject).toHaveBeenCalledWith(
      `normalProject:${CONV_A}`,
    );
    expect(state.findSessionByProjectId).toHaveBeenCalledWith(CONV_A);
    expect(res.data.status).toBe("Busy");
    expect(res.data.session_id).toBe(`sess-${CONV_A}`);
  });

  it("agentStatus：同项目两对话各自独立定位（key 与反查均按 conversationId）", async () => {
    await callHandler("computer:agentStatus", {
      user_id: "u1",
      project_id: CONV_A,
      agent_work_dir: DEV_TARGET,
      service_type: NP,
    });
    await callHandler("computer:agentStatus", {
      user_id: "u1",
      project_id: CONV_B,
      agent_work_dir: DEV_TARGET,
      service_type: NP,
    });

    expect(state.getEngineForProject).toHaveBeenNthCalledWith(
      1,
      `normalProject:${CONV_A}`,
    );
    expect(state.getEngineForProject).toHaveBeenNthCalledWith(
      2,
      `normalProject:${CONV_B}`,
    );
    expect(state.findSessionByProjectId).toHaveBeenNthCalledWith(1, CONV_A);
    expect(state.findSessionByProjectId).toHaveBeenNthCalledWith(2, CONV_B);
  });

  it("cancelSession：无 session_id 时按 conversationId 反查并中止本对话会话", async () => {
    await callHandler("computer:cancelSession", {
      user_id: "u1",
      project_id: CONV_B,
      agent_work_dir: DEV_TARGET,
      service_type: NP,
    });

    expect(state.findSessionByProjectId).toHaveBeenCalledWith(CONV_B);
    expect(state.abortSession).toHaveBeenCalledWith(`sess-${CONV_B}`);
  });

  it("agentStop：按 conversationId 建键停止本对话引擎", async () => {
    await callHandler("computer:agentStop", {
      user_id: "u1",
      project_id: CONV_A,
      agent_work_dir: DEV_TARGET,
      service_type: NP,
    });

    expect(state.getEngineForProject).toHaveBeenCalledWith(
      `normalProject:${CONV_A}`,
    );
    expect(state.stopEngine).toHaveBeenCalledWith(`normalProject:${CONV_A}`);
  });
});
