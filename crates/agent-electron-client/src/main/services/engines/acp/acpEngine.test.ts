/**
 * 单元测试: AcpEngine — 取消链路优化
 *
 * 覆盖内容：
 * - abortSession 先 reject 再等待 ACP cancel
 * - abortSession 超时后仍完成清理
 * - terminating 状态下拒绝新 prompt
 * - terminating 状态下抑制 message/tool 更新
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("electron-log", () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock("../../memory", () => ({
  memoryService: {
    isInitialized: vi.fn(() => false),
    init: vi.fn().mockResolvedValue(undefined),
    ensureMemoryReadyForSession: vi.fn().mockResolvedValue(undefined),
    onSessionEnd: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("../../utils/processTree", () => ({
  killProcessTree: vi.fn(),
  killProcessTreeGraceful: vi.fn(),
}));

vi.mock("../../system/processRegistry", () => ({
  processRegistry: {
    unregister: vi.fn(),
  },
}));

vi.mock("@main/services/packages/guiAgentServer", () => ({
  getGuiAgentServerUrl: vi.fn(() => null),
}));

vi.mock("@main/services/packages/windowsMcp", () => ({
  getWindowsMcpUrl: vi.fn(() => null),
}));

vi.mock("@main/services/sandbox/policy", () => ({
  getSandboxPolicy: vi.fn(() => ({
    enabled: false,
    backend: "auto",
    mode: "compat",
    autoFallback: "startup-only",
    windowsMode: "workspace-write",
  })),
  resolveSandboxType: vi.fn(async () => ({
    type: "none",
    degraded: false,
  })),
  getBundledLinuxBwrapPath: vi.fn(() => null),
  getBundledWindowsSandboxHelperPath: vi.fn(() => null),
}));

import { AcpEngine } from "./acpEngine";
import * as acpClient from "./acpClient";

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
};

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function setupEngine(engineType: "claude-code" | "nuwaxcode" = "nuwaxcode") {
  const engine = new AcpEngine(engineType);
  const sessionId = "session-test-001";
  const session = {
    id: sessionId,
    acpSessionId: sessionId,
    createdAt: Date.now(),
    status: "active",
  } as any;

  (engine as any).config = { engine: engineType, workspaceDir: "/tmp" } as any;
  (engine as any).acpConnection = {
    cancel: vi.fn(),
    prompt: vi.fn(),
  } as any;
  (engine as any).sessions.set(sessionId, session);

  return {
    engine,
    sessionId,
    session,
    acpConnection: (engine as any).acpConnection as {
      cancel: any;
      prompt: any;
    },
  };
}

function setupEngineForCreateSession(
  engineType: "claude-code" | "nuwaxcode" = "nuwaxcode",
) {
  const engine = new AcpEngine(engineType);
  const newSession = vi.fn().mockResolvedValue({ sessionId: "acp-session-1" });

  (engine as any).config = {
    engine: engineType,
    workspaceDir: "/workspace/project",
    mcpServers: {
      "gui-agent": {
        url: "http://127.0.0.1:9876/mcp",
        type: "http",
      },
      "safe-tool": {
        command: "node",
        args: ["tool.js"],
      },
    },
  } as any;
  (engine as any).acpConnection = {
    newSession,
    prompt: vi.fn(),
    cancel: vi.fn(),
  } as any;

  return { engine, newSession };
}

describe("AcpEngine.abortSession", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("先 reject 本地 prompt，再等待 ACP cancel", async () => {
    const { engine, sessionId, session, acpConnection } = setupEngine();
    const reject = vi.fn();
    (engine as any).activePromptSessions.add(sessionId);
    (engine as any).activePromptRejects.set(sessionId, reject);

    const deferred = createDeferred<void>();
    acpConnection.cancel.mockReturnValueOnce(deferred.promise);

    const abortPromise = engine.abortSession(sessionId);

    expect(reject).toHaveBeenCalledTimes(1);
    expect((engine as any).activePromptSessions.has(sessionId)).toBe(false);
    expect(session.status).toBe("terminating");

    deferred.resolve();
    await expect(abortPromise).resolves.toBe(true);
    expect(session.status).toBe("idle");
  });

  it("ACP cancel 超时后仍完成清理", async () => {
    const { engine, sessionId, session, acpConnection } = setupEngine();
    const reject = vi.fn();
    (engine as any).activePromptSessions.add(sessionId);
    (engine as any).activePromptRejects.set(sessionId, reject);

    acpConnection.cancel.mockReturnValueOnce(new Promise<void>(() => {}));

    vi.useFakeTimers();
    const abortPromise = engine.abortSession(sessionId);
    await vi.advanceTimersByTimeAsync(15_001);

    await expect(abortPromise).resolves.toBe(true);
    expect(session.status).toBe("idle");
  });
});

describe("AcpEngine.prompt", () => {
  it("terminating 状态拒绝新 prompt", async () => {
    const { engine, sessionId, session, acpConnection } = setupEngine();
    session.status = "terminating";

    await expect(
      engine.prompt(sessionId, [{ type: "text", text: "hi" }]),
    ).rejects.toThrow("terminating");

    expect(acpConnection.prompt).not.toHaveBeenCalled();
  });

  it("nuwaxcode 默认透传 mcpInit 非阻塞元信息", async () => {
    const { engine, sessionId, acpConnection } = setupEngine("nuwaxcode");
    acpConnection.prompt.mockResolvedValueOnce({ stopReason: "end_turn" });

    await engine.prompt(sessionId, [{ type: "text", text: "hi" }], {
      messageID: "rid-meta-001",
    });

    expect(acpConnection.prompt).toHaveBeenCalledTimes(1);
    expect(acpConnection.prompt).toHaveBeenCalledWith({
      sessionId,
      prompt: [{ type: "text", text: "hi" }],
      _meta: {
        requestId: "rid-meta-001",
        request_id: "rid-meta-001",
        mcpInitPolicy: "non_blocking",
        mcpInitTimeoutMs: 500,
      },
    });
  });

  it("claude-code 不透传 nuwaxcode 专属 mcpInit 元信息", async () => {
    const { engine, sessionId, acpConnection } = setupEngine("claude-code");
    acpConnection.prompt.mockResolvedValueOnce({ stopReason: "end_turn" });

    await engine.prompt(sessionId, [{ type: "text", text: "hi" }], {
      messageID: "rid-meta-002",
    });

    expect(acpConnection.prompt).toHaveBeenCalledTimes(1);
    expect(acpConnection.prompt).toHaveBeenCalledWith({
      sessionId,
      prompt: [{ type: "text", text: "hi" }],
      _meta: {
        requestId: "rid-meta-002",
        request_id: "rid-meta-002",
      },
    });
  });

  it("nuwaxcode 在 MCP 断连窗口内自动重试一次", async () => {
    const { engine, sessionId, acpConnection } = setupEngine("nuwaxcode");
    acpConnection.prompt
      .mockRejectedValueOnce(
        new Error("SSE stream disconnected: TypeError: terminated"),
      )
      .mockResolvedValueOnce({ stopReason: "end_turn" });

    vi.useFakeTimers();
    const promptPromise = engine.prompt(sessionId, [
      { type: "text", text: "hi" },
    ]);
    await vi.advanceTimersByTimeAsync(1_200);

    await expect(promptPromise).resolves.toBeDefined();
    expect(acpConnection.prompt).toHaveBeenCalledTimes(2);
  });

  it("claude-code 保持原逻辑，不执行 MCP 自动重试", async () => {
    const { engine, sessionId, acpConnection } = setupEngine("claude-code");
    acpConnection.prompt.mockRejectedValueOnce(
      new Error("SSE stream disconnected: TypeError: terminated"),
    );

    await expect(
      engine.prompt(sessionId, [{ type: "text", text: "hi" }]),
    ).resolves.toBeDefined();
    expect(acpConnection.prompt).toHaveBeenCalledTimes(1);
  });

  it("nuwaxcode MCP 断连失败时上报 mcp_reconnecting", async () => {
    const { engine, sessionId, acpConnection } = setupEngine("nuwaxcode");
    const onPromptEnd = vi.fn();
    engine.on("computer:promptEnd", onPromptEnd);

    acpConnection.prompt.mockRejectedValue(
      new Error("SSE stream disconnected: TypeError: terminated"),
    );

    vi.useFakeTimers();
    const promptPromise = engine.prompt(sessionId, [
      { type: "text", text: "hi" },
    ]);
    await vi.advanceTimersByTimeAsync(1_200);
    await promptPromise;

    expect(acpConnection.prompt).toHaveBeenCalledTimes(2);
    expect(onPromptEnd).toHaveBeenCalled();
    const event = onPromptEnd.mock.calls.at(-1)?.[0];
    expect(event.reason).toBe("mcp_reconnecting");
  });
});

describe("AcpEngine.handleAcpSessionUpdate", () => {
  it("terminating 状态抑制 message/tool 更新", () => {
    const { engine, sessionId, session } = setupEngine();
    session.status = "terminating";

    const onMessage = vi.fn();
    const onProgress = vi.fn();
    engine.on("message.part.updated", onMessage);
    engine.on("computer:progress", onProgress);

    (engine as any).handleAcpSessionUpdate(sessionId, {
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: "hello" },
    });

    expect(onMessage).not.toHaveBeenCalled();
    expect(onProgress).not.toHaveBeenCalled();
  });
});

describe("AcpEngine.createSession", () => {
  it("沙箱启用时应移除 gui-agent MCP（互斥）", async () => {
    const { engine, newSession } = setupEngineForCreateSession("nuwaxcode");

    (engine as any).storedSandboxConfig = {
      enabled: true,
      type: "windows-sandbox",
      projectWorkspaceDir: "/workspace/project",
    };

    await engine.createSession({
      mcpServers: {
        "another-tool": {
          command: "node",
          args: ["another.js"],
        },
      },
    });

    expect(newSession).toHaveBeenCalledTimes(1);
    const sent = newSession.mock.calls[0][0] as {
      mcpServers: Array<{ name: string }>;
    };

    expect(sent.mcpServers.map((m) => m.name)).toEqual([
      "safe-tool",
      "another-tool",
    ]);
  });

  it("沙箱关闭时应保留 gui-agent MCP", async () => {
    const { engine, newSession } = setupEngineForCreateSession("nuwaxcode");
    (engine as any).storedSandboxConfig = null;

    await engine.createSession();

    expect(newSession).toHaveBeenCalledTimes(1);
    const sent = newSession.mock.calls[0][0] as {
      mcpServers: Array<{ name: string }>;
    };

    expect(sent.mcpServers.map((m) => m.name)).toContain("gui-agent");
  });
});

describe("AcpEngine.handlePermissionRequest(strict)", () => {
  it("strict 下 workspace 内写入仅放行 allow_once", async () => {
    const { engine, sessionId } = setupEngine("nuwaxcode");
    (engine as any).config = { engine: "nuwaxcode", workspaceDir: "/tmp/ws" };
    (engine as any).storedSandboxConfig = {
      enabled: true,
      mode: "strict",
      projectWorkspaceDir: "/tmp/ws",
    };
    (engine as any).isolatedHome = "/tmp/iso-home";

    const result = await (engine as any).handlePermissionRequest({
      sessionId,
      toolCall: {
        toolCallId: "tc-strict-1",
        kind: "edit",
        title: "Edit",
        rawInput: { file_path: "/tmp/ws/a.txt" },
      },
      options: [
        {
          optionId: "allow-always",
          kind: "allow_always",
          name: "allow always",
        },
        {
          optionId: "allow-once",
          kind: "allow_once",
          name: "allow once",
        },
      ],
    });

    expect(result).toEqual({
      outcome: { outcome: "selected", optionId: "allow-once" },
    });
  });

  it("strict 下 workspace/temp/appData 外写入应拒绝", async () => {
    const { engine, sessionId } = setupEngine("nuwaxcode");
    (engine as any).config = { engine: "nuwaxcode", workspaceDir: "/tmp/ws" };
    (engine as any).storedSandboxConfig = {
      enabled: true,
      mode: "strict",
      projectWorkspaceDir: "/tmp/ws",
    };
    (engine as any).isolatedHome = "/tmp/iso-home";

    const result = await (engine as any).handlePermissionRequest({
      sessionId,
      toolCall: {
        toolCallId: "tc-strict-2",
        kind: "write",
        title: "Write",
        rawInput: { file_path: "/etc/passwd" },
      },
      options: [
        {
          optionId: "allow-always",
          kind: "allow_always",
          name: "allow always",
        },
        {
          optionId: "allow-once",
          kind: "allow_once",
          name: "allow once",
        },
      ],
    });

    expect(result).toEqual({ outcome: { outcome: "cancelled" } });
  });
});

describe("AcpEngine.init", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("warmup 进程也应注入 MCP 配置，避免复用后工具列表为空", async () => {
    const engine = new AcpEngine("nuwaxcode");
    let capturedEnv: Record<string, string> | undefined;

    const mockConnection = {
      initialize: vi.fn().mockResolvedValue({ protocolVersion: "1.0.0" }),
    } as any;

    const mockProcess = {
      pid: 12345,
      on: vi.fn(),
      stdout: { removeAllListeners: vi.fn() },
      stderr: { removeAllListeners: vi.fn() },
      stdin: { removeAllListeners: vi.fn() },
      removeAllListeners: vi.fn(),
      kill: vi.fn(),
    } as any;

    vi.spyOn(acpClient, "resolveAcpBinary").mockReturnValue({
      binPath: "nuwaxcode",
      binArgs: ["acp"],
      isNative: false,
    });
    vi.spyOn(acpClient, "createAcpConnection").mockImplementation(
      async (cfg: any) => {
        capturedEnv = cfg.env as Record<string, string>;
        return {
          connection: mockConnection,
          process: mockProcess,
          isolatedHome: null,
          cleanup: vi.fn(),
        } as any;
      },
    );
    vi.spyOn(acpClient, "loadAcpSdk").mockResolvedValue({
      PROTOCOL_VERSION: "1.0.0",
    } as any);

    const ok = await engine.init({
      engine: "nuwaxcode",
      workspaceDir: "/tmp",
      env: { NUWAX_AGENT_WARMUP: "1" },
      mcpServers: {
        "chrome-devtools": {
          command: "node",
          args: ["proxy.js", "--config-file", "/tmp/mcp.json"],
          env: {},
        },
      },
    } as any);

    expect(ok).toBe(true);
    expect(capturedEnv?.OPENCODE_CONFIG_CONTENT).toBeTruthy();

    const injected = JSON.parse(capturedEnv!.OPENCODE_CONFIG_CONTENT!);
    expect(injected.mcp).toBeDefined();
    expect(injected.mcp["chrome-devtools"]).toBeDefined();
    expect(injected.permission.question).toBe("deny");

    await engine.destroy();
  });
});

describe("AcpEngine.chat", () => {
  it("nuwaxcode: 将 request_id 透传并附带 mcpInit 默认策略", async () => {
    const { engine, sessionId, session } = setupEngine();
    session.projectId = "project-test-001";

    const promptAsyncSpy = vi
      .spyOn(engine, "promptAsync")
      .mockResolvedValue(undefined);

    const result = await engine.chat({
      user_id: "user-1",
      project_id: "project-test-001",
      session_id: sessionId,
      request_id: "rid-chat-001",
      prompt: "hello trace",
    } as any);

    expect(result.success).toBe(true);
    expect(promptAsyncSpy).toHaveBeenCalledWith(
      sessionId,
      [{ type: "text", text: "hello trace" }],
      {
        messageID: "rid-chat-001",
        mcpInitPolicy: "non_blocking",
        mcpInitTimeoutMs: 500,
      },
    );
  });

  it("claude-code: chat 保持原逻辑仅透传 messageID", async () => {
    const { engine, sessionId, session } = setupEngine("claude-code");
    session.projectId = "project-test-001";

    const promptAsyncSpy = vi
      .spyOn(engine, "promptAsync")
      .mockResolvedValue(undefined);

    const result = await engine.chat({
      user_id: "user-1",
      project_id: "project-test-001",
      session_id: sessionId,
      request_id: "rid-chat-claude-001",
      prompt: "hello trace",
    } as any);

    expect(result.success).toBe(true);
    expect(promptAsyncSpy).toHaveBeenCalledWith(
      sessionId,
      [{ type: "text", text: "hello trace" }],
      { messageID: "rid-chat-claude-001" },
    );
  });
});

/** listSessionsDetailed：会话 title 透传到列表（L1 数据断言） */
describe("AcpEngine.listSessionsDetailed", () => {
  it("返回的会话列表应包含 createSession 时传入的 title", () => {
    const { engine, sessionId, session } = setupEngine();
    const expectedTitle = "我的会话标题";
    (session as any).title = expectedTitle;

    const list = engine.listSessionsDetailed();

    expect(list).toHaveLength(1);
    expect(list[0].id).toBe(sessionId);
    expect(list[0].title).toBe(expectedTitle);
  });
});
