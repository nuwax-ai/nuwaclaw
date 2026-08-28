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
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { ACP_SESSION_CANCELLED_ERROR_CODE } from "@shared/constants";
import type { AcpChatHttpResult } from "@shared/types/computerTypes";
import * as dependencies from "@main/services/system/dependencies";
import * as sandboxPolicy from "@main/services/sandbox/policy";
import * as opencodeAcpSandbox from "./sandbox/opencodeAcpSandbox";
import { chatDispatchCoordinator } from "../../computer/chatDispatchCoordinator";

vi.mock("electron", () => ({
  app: {
    getPath: vi.fn((name: string) =>
      name === "home" ? "/mock/home" : "/mock/appdata",
    ),
    getVersion: vi.fn(() => "0.0.0-test"),
    isPackaged: false,
  },
}));

const mockAppDataDir = path.join(
  os.tmpdir(),
  `nuwaclaw-acp-engine-test-${process.pid}`,
);

vi.mock("../../system/appPaths", () => ({
  getAppDataDir: () => mockAppDataDir,
}));

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

vi.mock("@main/services/system/dependencies", () => ({
  getResourcesPath: vi.fn(() => "/mock/resources"),
  getAppEnv: vi.fn(() => ({ PATH: "/mock/path" })),
  getBundledGitBashPath: vi.fn(() => null),
}));

const mockGetBundledGitBashPath = vi.fn(() => "");

vi.mock("@main/services/system/binaryLocator", async (importOriginal) => {
  const mod =
    await importOriginal<
      typeof import("@main/services/system/binaryLocator")
    >();
  return {
    ...mod,
    getBundledGitBashPath: () => mockGetBundledGitBashPath(),
  };
});

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
import * as acpChatMemory from "./acpChatMemory";

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

  it("先发送 ACP cancel，再 reject 本地 prompt", async () => {
    const { engine, sessionId, session, acpConnection } = setupEngine();
    const reject = vi.fn();
    (engine as any).activePromptSessions.add(sessionId);
    (engine as any).activePromptRejects.set(sessionId, reject);

    const deferred = createDeferred<void>();
    acpConnection.cancel.mockReturnValueOnce(deferred.promise);

    const abortPromise = engine.abortSession(sessionId);

    // cancel 已发送但未完成，reject 还没被调用
    expect(reject).toHaveBeenCalledTimes(0);
    expect((engine as any).activePromptSessions.has(sessionId)).toBe(true);
    expect(session.status).toBe("terminating");

    // ACP binary 响应 cancel 后，reject 才被调用
    deferred.resolve();
    await expect(abortPromise).resolves.toBe(true);
    expect(reject).toHaveBeenCalledTimes(1);
    expect((engine as any).activePromptSessions.has(sessionId)).toBe(false);
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

  it("本地 Session cancelled 时 promptEnd reason 为 cancelled", async () => {
    const { engine, sessionId, acpConnection } = setupEngine("nuwaxcode");
    const onPromptEnd = vi.fn();
    engine.on("computer:promptEnd", onPromptEnd);

    const cancelled = new Error("Session cancelled");
    Object.assign(cancelled, { code: ACP_SESSION_CANCELLED_ERROR_CODE });
    acpConnection.prompt.mockRejectedValueOnce(cancelled);

    await engine.prompt(sessionId, [{ type: "text", text: "hi" }]);

    expect(onPromptEnd).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId,
        reason: "cancelled",
      }),
    );
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

  it("审批门控的交互工具在 completed 更新中带回 rawInput", () => {
    const { engine, sessionId } = setupEngine("claude-code");
    const onMessage = vi.fn();
    const onProgress = vi.fn();
    engine.on("message.part.updated", onMessage);
    engine.on("computer:progress", onProgress);

    const rawInput = {
      schemaVersion: "custom.interactive.v1",
      requestId: "tech_report_001",
      revision: 1,
      title: "技术调研报告配置",
      ui: { version: "nuwax.interaction.v1", presentation: "inline" },
    };
    const rawOutput = JSON.stringify({
      status: "pending",
      requestId: "tech_report_001",
      revision: 1,
    });

    (engine as any).handleAcpSessionUpdate(sessionId, {
      _meta: { claudeCode: { toolName: "custom_interactive_tool" } },
      sessionUpdate: "tool_call_update",
      toolCallId: "tool-call-interactive",
      rawInput,
    });
    (engine as any).handleAcpSessionUpdate(sessionId, {
      _meta: { claudeCode: { toolName: "custom_interactive_tool" } },
      sessionUpdate: "tool_call_update",
      toolCallId: "tool-call-interactive",
      status: "completed",
      rawOutput,
    });

    expect(onProgress).toHaveBeenCalledTimes(1);
    expect(onProgress.mock.calls[0][0]).toMatchObject({
      sessionId,
      subType: "tool_call_update",
      data: {
        toolCallId: "tool-call-interactive",
        title: "custom_interactive_tool",
        status: "completed",
        rawInput,
        rawOutput,
      },
    });
    expect(onMessage).toHaveBeenCalledTimes(1);
    expect(onMessage.mock.calls[0][0]).toMatchObject({
      sessionId,
      type: "tool",
      toolCallId: "tool-call-interactive",
      name: "custom_interactive_tool",
      status: "completed",
      input: rawInput,
      output: rawOutput,
    });
  });
});

describe("AcpEngine.createSession", () => {
  it("nuwaxcode 1.2.0 原生 strict 沙箱仍注入 session-scoped sandboxed-bash/fs MCP", async () => {
    const { engine, newSession } = setupEngineForCreateSession("nuwaxcode");
    const resourcesSpy = vi
      .spyOn(dependencies, "getResourcesPath")
      .mockReturnValue(path.join(process.cwd(), "resources"));
    vi.spyOn(
      opencodeAcpSandbox,
      "readBundledOpencodeEngineVersion",
    ).mockReturnValue("1.2.0");

    (engine as any).storedSandboxConfig = {
      enabled: true,
      type: "windows-sandbox",
      mode: "strict",
      projectWorkspaceDir: "C:\\workspace\\project",
      windowsSandboxHelperPath: "C:\\tools\\nuwax-sandbox-helper.exe",
    };

    try {
      await engine.createSession({ cwd: "C:\\workspace\\project\\session-1" });
    } finally {
      resourcesSpy.mockRestore();
    }

    const sent = newSession.mock.calls[0][0] as {
      mcpServers: Array<{
        name: string;
        env?: Array<{ name: string; value: string }>;
      }>;
    };
    const names = sent.mcpServers.map((m) => m.name);
    expect(names).toContain("sandboxed-bash");
    expect(names).toContain("sandboxed-fs");
    const bashServer = sent.mcpServers.find((m) => m.name === "sandboxed-bash");
    expect(
      bashServer?.env?.find((kv) => kv.name === "NUWAX_SANDBOX_MODE")?.value,
    ).toBe("workspace-write");
    expect(
      bashServer?.env?.find((kv) => kv.name === "NUWAX_SANDBOX_POLICY_MODE")
        ?.value,
    ).toBe("strict");
  });

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

    expect(sent.mcpServers.map((m) => m.name).sort()).toEqual([
      "another-tool",
      "safe-tool",
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

  it("compat 下若 sandboxed-fs 脚本缺失，不应阻断其他 MCP 加载", async () => {
    const { engine, newSession } = setupEngineForCreateSession("claude-code");
    const resourcesSpy = vi
      .spyOn(dependencies, "getResourcesPath")
      .mockReturnValue("/__missing_resources__");

    (engine as any).storedSandboxConfig = {
      enabled: true,
      type: "windows-sandbox",
      mode: "compat",
      projectWorkspaceDir: "/workspace/project",
      windowsSandboxHelperPath: "C:\\tools\\nuwax-sandbox-helper.exe",
    };

    try {
      await engine.createSession();
    } finally {
      resourcesSpy.mockRestore();
    }

    expect(newSession).toHaveBeenCalledTimes(1);
    const sent = newSession.mock.calls[0][0] as {
      mcpServers: Array<{ name: string }>;
      _meta?: {
        claudeCode?: { options?: { disallowedTools?: string[] } };
      };
    };
    const names = sent.mcpServers.map((m) => m.name);
    expect(names).not.toContain("sandboxed-bash");
    expect(names).not.toContain("sandboxed-fs");
    const disallowed = sent._meta?.claudeCode?.options?.disallowedTools || [];
    expect(disallowed).not.toContain("Bash");
    expect(disallowed).not.toContain("Write");
    expect(disallowed).not.toContain("Edit");
    expect(disallowed).not.toContain("NotebookEdit");
  });

  it("compat 模式下 sandboxed-fs 注入与工具禁用应生效", async () => {
    const { engine, newSession } = setupEngineForCreateSession("nuwaxcode");
    vi.spyOn(
      opencodeAcpSandbox,
      "readBundledOpencodeEngineVersion",
    ).mockReturnValue("1.1.99");
    const resourcesSpy = vi
      .spyOn(dependencies, "getResourcesPath")
      .mockReturnValue(path.join(process.cwd(), "resources"));

    (engine as any).storedSandboxConfig = {
      enabled: true,
      type: "windows-sandbox",
      mode: "compat",
      projectWorkspaceDir: "/workspace/project",
      windowsSandboxHelperPath: "C:\\tools\\nuwax-sandbox-helper.exe",
    };

    try {
      await engine.createSession();
    } finally {
      resourcesSpy.mockRestore();
    }

    expect(newSession).toHaveBeenCalledTimes(1);
    const sent = newSession.mock.calls[0][0] as {
      mcpServers: Array<{
        name: string;
        env?: Array<{ name: string; value: string }>;
      }>;
      _meta?: {
        claudeCode?: { options?: { disallowedTools?: string[] } };
      };
    };
    const fsServer = sent.mcpServers.find((m) => m.name === "sandboxed-fs");
    expect(fsServer).toBeDefined();
    const modeVar = fsServer?.env?.find(
      (kv) => kv.name === "NUWAX_SANDBOX_MODE",
    );
    expect(modeVar?.value).toBe("compat");
    const rootsVar = fsServer?.env?.find(
      (kv) => kv.name === "NUWAX_SANDBOX_WRITABLE_ROOTS",
    );
    const parsedRoots = JSON.parse(rootsVar?.value ?? "[]") as string[];
    expect(
      parsedRoots.some((r) =>
        r.replace(/\\/g, "/").includes("/workspace/project"),
      ),
    ).toBe(true);
    const disallowed = sent._meta?.claudeCode?.options?.disallowedTools || [];
    expect(disallowed).toContain("Write");
    expect(disallowed).toContain("Edit");
    expect(disallowed).toContain("NotebookEdit");
  });
});

describe("AcpEngine.handlePermissionRequest(strict)", () => {
  it("ask 模式发出 RCoder request_permission SSE payload", async () => {
    const { engine, sessionId } = setupEngine("nuwaxcode");
    (engine as any).setEffectiveMode(sessionId, "ask");
    const onProgress = vi.fn();
    engine.on("computer:progress", onProgress);

    const responsePromise = (engine as any).handlePermissionRequest({
      sessionId,
      toolCall: {
        toolCallId: "tool-call-ask",
        kind: "execute",
        title: "Run command",
        status: "pending",
        rawInput: { command: "cargo test" },
        content: [],
      },
      options: [
        {
          optionId: "reject-once",
          kind: "reject_once",
          name: "拒绝本次",
        },
        {
          optionId: "allow-once",
          kind: "allow_once",
          name: "允许本次",
        },
      ],
    });

    expect(onProgress).toHaveBeenCalledTimes(1);
    const event = onProgress.mock.calls[0][0];
    expect(event).toMatchObject({
      sessionId,
      acpSessionId: sessionId,
      messageType: "acpRequestPermission",
      subType: "request_permission",
      data: {
        request_permission_request: {
          sessionId: sessionId,
          toolCall: {
            toolCallId: "tool-call-ask",
            kind: "execute",
            status: "pending",
            title: "Run command",
            rawInput: { command: "cargo test" },
          },
          options: [
            {
              optionId: "reject-once",
              kind: "reject_once",
              name: "拒绝本次",
            },
            {
              optionId: "allow-once",
              kind: "allow_once",
              name: "允许本次",
            },
          ],
        },
        tool_call_id: "tool-call-ask",
      },
    });
    expect(event.data._intervention).toMatchObject({
      id: expect.stringMatching(/^itv_/),
      revision: 1,
      status: "pending",
      sessionId,
      source: "acp_permission",
      engine: "nuwaxcode",
      protocol: "acp",
      acp: {
        method: "session/request_permission",
        request: {
          sessionId,
          toolCall: { toolCallId: "tool-call-ask" },
        },
      },
    });
    expect(event.data._engine).toBe("nuwaxcode");

    const result = (engine as any).resolvePermissionIntervention({
      permission_resolve_request: {
        request_permission_response: {
          outcome: { Selected: { option_id: "reject-once" } },
        },
        session_id: sessionId,
        tool_call_id: "tool-call-ask",
        save_rule: false,
      },
    });

    expect(result).toMatchObject({ ok: true, hostStatus: "resolved" });
    await expect(responsePromise).resolves.toEqual({
      outcome: { outcome: "selected", optionId: "reject-once" },
    });
  });

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
    mockGetBundledGitBashPath.mockReturnValue("");
    vi.restoreAllMocks();
  });

  it("nuwaxcode init 应注入 MCP 配置", async () => {
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

    const initResult = await engine.init({
      engine: "nuwaxcode",
      workspaceDir: "/tmp",
      mcpServers: {
        "chrome-devtools": {
          command: "node",
          args: ["proxy.js", "--config-file", "/tmp/mcp.json"],
          env: {},
        },
      },
    } as any);

    expect(initResult.ok).toBe(true);
    expect(capturedEnv?.OPENCODE_CONFIG_CONTENT).toBeTruthy();

    const injected = JSON.parse(capturedEnv!.OPENCODE_CONFIG_CONTENT!);
    // MCP 只经 ACP session/new 下发，避免 OPENCODE_CONFIG_CONTENT.mcp 双路径重复建连
    expect(injected.mcp).toBeUndefined();
    expect(injected.permission.question).toBe("deny");

    await engine.destroy();
  });

  it("nuwaxcode init 在 Windows 且 bundled Git Bash 可用时注入 OPENCODE shell", async () => {
    const bundledBash = "C:\\mock\\resources\\git\\bin\\bash.exe";
    mockGetBundledGitBashPath.mockReturnValue(bundledBash);

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

    const initResult = await engine.init({
      engine: "nuwaxcode",
      workspaceDir: "/tmp",
    } as any);

    expect(initResult.ok).toBe(true);
    const injected = JSON.parse(capturedEnv!.OPENCODE_CONFIG_CONTENT!);
    if (process.platform === "win32") {
      expect(injected.shell).toBe(bundledBash);
    } else {
      expect(injected.shell).toBeUndefined();
    }

    mockGetBundledGitBashPath.mockReturnValue("");
    await engine.destroy();
  });

  it("codex-cli 使用 env API key 时应在建会话前激活 ACP auth", async () => {
    const engine = new AcpEngine("codex-cli");
    const authenticate = vi.fn().mockResolvedValue({});

    const mockConnection = {
      initialize: vi.fn().mockResolvedValue({ protocolVersion: "1.0.0" }),
      authenticate,
    } as any;

    const mockProcess = {
      pid: 12346,
      on: vi.fn(),
      stdout: { removeAllListeners: vi.fn() },
      stderr: { removeAllListeners: vi.fn() },
      stdin: { removeAllListeners: vi.fn() },
      removeAllListeners: vi.fn(),
      kill: vi.fn(),
    } as any;

    vi.spyOn(acpClient, "resolveAcpBinary").mockReturnValue({
      binPath: "nuwax-codex-acp",
      binArgs: [],
      isNative: true,
    });
    vi.spyOn(acpClient, "createAcpConnection").mockResolvedValue({
      connection: mockConnection,
      process: mockProcess,
      isolatedHome: null,
      cleanup: vi.fn(),
    } as any);
    vi.spyOn(acpClient, "loadAcpSdk").mockResolvedValue({
      PROTOCOL_VERSION: "1.0.0",
    } as any);

    const ok = await engine.init({
      engine: "codex-cli",
      workspaceDir: "/tmp",
      apiKey: "ak-test",
    } as any);

    expect(ok.ok).toBe(true);
    expect(authenticate).toHaveBeenCalledWith({ methodId: "codex-api-key" });

    await engine.destroy();
  });

  it("沙箱启用时 nuwaxcode 1.1.x 不注入 sandbox 键，并禁用内置 bash/edit", async () => {
    const engine = new AcpEngine("nuwaxcode");
    let capturedEnv: Record<string, string> | undefined;

    vi.spyOn(sandboxPolicy, "getSandboxPolicy").mockReturnValue({
      enabled: true,
      backend: "auto",
      mode: "compat",
      autoFallback: "startup-only",
      windowsMode: "workspace-write",
    });
    vi.spyOn(sandboxPolicy, "resolveSandboxType").mockResolvedValue({
      type: "windows-sandbox",
      degraded: false,
    });
    vi.spyOn(
      sandboxPolicy,
      "getBundledWindowsSandboxHelperPath",
    ).mockReturnValue("C:\\tools\\nuwax-sandbox-helper.exe");
    const applySpy = vi
      .spyOn(opencodeAcpSandbox, "applyOpencodeSandboxToOpenCodeConfig")
      .mockImplementation(({ configObj }) => {
        configObj.permission = {
          ...(configObj.permission as object),
          bash: "deny",
          edit: "deny",
        };
        return {
          opencodeSandboxConfigInjected: false,
          builtinBashDenied: true,
          builtinEditDenied: true,
          engineVersion: "1.1.99",
          usesNativeSandbox: false,
        };
      });

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

    try {
      const ok = await engine.init({
        engine: "nuwaxcode",
        workspaceDir: "/tmp/workspace",
        apiKey: "test-key",
        model: "openai-compatible/glm-5",
      } as any);

      expect(ok.ok).toBe(true);
      const injected = JSON.parse(capturedEnv!.OPENCODE_CONFIG_CONTENT!);
      expect(injected.sandbox).toBeUndefined();
      expect(injected.permission.bash).toBe("deny");
      expect(injected.permission.edit).toBe("deny");
    } finally {
      applySpy.mockRestore();
      await engine.destroy();
    }
  });
});

describe("AcpEngine.chat", () => {
  beforeEach(() => {
    chatDispatchCoordinator.reset();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

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

  it("chat 前有活跃 prompt 时先 abortSession 再发新 prompt", async () => {
    const { engine, sessionId, session, acpConnection } = setupEngine();
    session.projectId = "project-test-001";
    (engine as any).activePromptSessions.add(sessionId);
    acpConnection.cancel.mockResolvedValue(undefined);

    const abortSpy = vi.spyOn(engine, "abortSession");
    const promptAsyncSpy = vi
      .spyOn(engine, "promptAsync")
      .mockResolvedValue(undefined);

    const result = await engine.chat({
      user_id: "user-1",
      project_id: "project-test-001",
      session_id: sessionId,
      request_id: "rid-chat-supersede-001",
      prompt: "follow-up",
    } as any);

    expect(result.success).toBe(true);
    expect(abortSpy).toHaveBeenCalledWith(sessionId);
    expect(acpConnection.cancel).toHaveBeenCalledWith({ sessionId });
    expect(promptAsyncSpy).toHaveBeenCalled();
  });

  it("chat 前无活跃 turn 时不调用 abortSession", async () => {
    const { engine, sessionId, session } = setupEngine();
    session.projectId = "project-test-001";

    const abortSpy = vi.spyOn(engine, "abortSession");
    vi.spyOn(engine, "promptAsync").mockResolvedValue(undefined);

    const result = await engine.chat({
      user_id: "user-1",
      project_id: "project-test-001",
      session_id: sessionId,
      request_id: "rid-chat-clean-001",
      prompt: "hello",
    } as any);

    expect(result.success).toBe(true);
    expect(abortSpy).not.toHaveBeenCalled();
  });

  it("chat 前有孤立 pending 权限时取消后再发新 prompt", async () => {
    const { engine, sessionId, session } = setupEngine();
    session.projectId = "project-test-001";

    const { approvalInterventionService } =
      await import("../../intervention/approvalInterventionService");
    const cancelSpy = vi.spyOn(
      approvalInterventionService,
      "cancelByAcpSession",
    );

    approvalInterventionService.createPending({
      engine: "nuwaxcode",
      appSessionId: sessionId,
      acpSessionId: sessionId,
      acpRequest: {
        sessionId,
        toolCall: {
          toolCallId: "tool-call-orphan",
          kind: "bash",
          title: "bash",
          rawInput: { command: "ls" },
        },
        options: [{ optionId: "once", name: "Allow once", kind: "allow_once" }],
      } as any,
    });

    const abortSpy = vi.spyOn(engine, "abortSession");
    const promptAsyncSpy = vi
      .spyOn(engine, "promptAsync")
      .mockResolvedValue(undefined);

    const result = await engine.chat({
      user_id: "user-1",
      project_id: "project-test-001",
      session_id: sessionId,
      request_id: "rid-chat-orphan-pending-001",
      prompt: "new message",
    } as any);

    expect(result.success).toBe(true);
    expect(abortSpy).not.toHaveBeenCalled();
    expect(cancelSpy).toHaveBeenCalledWith(sessionId, "new_chat");
    expect(promptAsyncSpy).toHaveBeenCalled();
    expect(approvalInterventionService.pendingCount).toBe(0);
  });

  it("abort 后新 chat 时旧 prompt finally 不会清掉新轮次 activePromptSessions", async () => {
    const { engine, sessionId, session, acpConnection } = setupEngine();
    session.projectId = "project-test-001";

    let resolveOldPrompt!: (value: { stopReason: string }) => void;
    let resolveNewPrompt!: (value: { stopReason: string }) => void;
    const oldAcpPrompt = new Promise<{ stopReason: string }>((resolve) => {
      resolveOldPrompt = resolve;
    });
    const newAcpPrompt = new Promise<{ stopReason: string }>((resolve) => {
      resolveNewPrompt = resolve;
    });

    acpConnection.prompt
      .mockImplementationOnce(() => oldAcpPrompt)
      .mockImplementationOnce(() => newAcpPrompt);
    acpConnection.cancel.mockResolvedValue(undefined);

    void engine.prompt(sessionId, [{ type: "text", text: "old" }]);
    await vi.waitFor(() =>
      expect((engine as any).activePromptSessions.has(sessionId)).toBe(true),
    );

    const chatResult = await engine.chat({
      user_id: "user-1",
      project_id: "project-test-001",
      session_id: sessionId,
      request_id: "rid-chat-race-001",
      prompt: "new",
    } as any);

    expect(chatResult.success).toBe(true);
    expect(acpConnection.cancel).toHaveBeenCalledWith({ sessionId });
    expect((engine as any).activePromptSessions.has(sessionId)).toBe(true);

    resolveOldPrompt({ stopReason: "cancelled" });
    await new Promise((resolve) => setImmediate(resolve));
    expect((engine as any).activePromptSessions.has(sessionId)).toBe(true);

    resolveNewPrompt({ stopReason: "end_turn" });
    await vi.waitFor(
      () =>
        expect((engine as any).activePromptSessions.has(sessionId)).toBe(false),
      { timeout: 2000 },
    );
  });

  it("dispatch: stale turn skips promptAsync and memory", async () => {
    chatDispatchCoordinator.reset();
    const { engine, sessionId, session } = setupEngine();
    session.projectId = "project-test-001";

    chatDispatchCoordinator.bumpArrival("project-test-001", "rid-1");
    chatDispatchCoordinator.bumpArrival("project-test-001", "rid-2");

    const promptAsyncSpy = vi
      .spyOn(engine, "promptAsync")
      .mockResolvedValue(undefined);
    const recordMemorySpy = vi.spyOn(
      acpChatMemory,
      "recordUserMessageToMemory",
    );
    const buildPromptSpy = vi.spyOn(acpChatMemory, "buildMemoryEnhancedPrompt");

    const result = await engine.chat(
      {
        user_id: "user-1",
        project_id: "project-test-001",
        session_id: sessionId,
        request_id: "rid-chat-stale-001",
        prompt: "hello",
        original_user_prompt: "hello",
        open_long_memory: true,
      } as any,
      { dispatchKey: "project-test-001", turnGeneration: 1 },
    );

    expect(result.success).toBe(true);
    expect((result as AcpChatHttpResult).promptDispatched).toBe(false);
    expect(promptAsyncSpy).not.toHaveBeenCalled();
    expect(recordMemorySpy).not.toHaveBeenCalled();
    expect(buildPromptSpy).not.toHaveBeenCalled();

    recordMemorySpy.mockRestore();
    buildPromptSpy.mockRestore();
  });

  it("dispatch: superseded after abort skips memory", async () => {
    chatDispatchCoordinator.reset();
    const key = "project-test-001";
    chatDispatchCoordinator.bumpArrival(key, "rid-2");

    const { engine, sessionId, session } = setupEngine();
    session.projectId = key;

    vi.spyOn(engine as any, "abortActiveTurnBeforeNewChat").mockImplementation(
      async () => {
        chatDispatchCoordinator.bumpArrival(key, "rid-3");
      },
    );

    const recordMemorySpy = vi.spyOn(
      acpChatMemory,
      "recordUserMessageToMemory",
    );
    const buildPromptSpy = vi.spyOn(acpChatMemory, "buildMemoryEnhancedPrompt");
    vi.spyOn(engine, "promptAsync").mockResolvedValue(undefined);

    const result = await engine.chat(
      {
        user_id: "user-1",
        project_id: key,
        session_id: sessionId,
        request_id: "rid-chat-abort-supersede",
        prompt: "hello",
        original_user_prompt: "hello",
        open_long_memory: true,
      } as any,
      { dispatchKey: key, turnGeneration: 2 },
    );

    expect((result as AcpChatHttpResult).promptDispatched).toBe(false);
    expect(recordMemorySpy).not.toHaveBeenCalled();
    expect(buildPromptSpy).not.toHaveBeenCalled();

    recordMemorySpy.mockRestore();
    buildPromptSpy.mockRestore();
  });

  it("dispatch: runDispatch gate stale skips memory", async () => {
    chatDispatchCoordinator.reset();
    const key = "project-test-001";
    const gen1 = chatDispatchCoordinator.bumpArrival(key, "rid-hold");
    const hold = createDeferred<void>();

    const queueHold = chatDispatchCoordinator.runDispatch(
      key,
      gen1,
      async () => {
        await hold.promise;
        return "dispatched" as const;
      },
    );

    await new Promise((resolve) => setImmediate(resolve));

    const { engine, sessionId, session } = setupEngine();
    session.projectId = key;

    const recordMemorySpy = vi.spyOn(
      acpChatMemory,
      "recordUserMessageToMemory",
    );
    vi.spyOn(engine, "promptAsync").mockResolvedValue(undefined);

    const chatPromise = engine.chat(
      {
        user_id: "user-1",
        project_id: key,
        session_id: sessionId,
        request_id: "rid-chat-gate-stale",
        prompt: "hello",
        original_user_prompt: "hello",
        open_long_memory: true,
      } as any,
      { dispatchKey: key, turnGeneration: 1 },
    );

    await new Promise((resolve) => setImmediate(resolve));
    chatDispatchCoordinator.bumpArrival(key, "rid-2");
    hold.resolve();

    const result = await chatPromise;
    await queueHold;

    expect((result as AcpChatHttpResult).promptDispatched).toBe(false);
    expect(recordMemorySpy).not.toHaveBeenCalled();

    recordMemorySpy.mockRestore();
  });

  it("dispatch: latest turn aborts in-flight prompt then dispatches", async () => {
    chatDispatchCoordinator.reset();
    const { engine, sessionId, session, acpConnection } = setupEngine();
    session.projectId = "project-test-001";
    (engine as any).activePromptSessions.add(sessionId);
    acpConnection.cancel.mockResolvedValue(undefined);

    chatDispatchCoordinator.bumpArrival("project-test-001", "rid-1");
    chatDispatchCoordinator.bumpArrival("project-test-001", "rid-2");

    const abortSpy = vi.spyOn(engine, "abortSession");
    const promptAsyncSpy = vi
      .spyOn(engine, "promptAsync")
      .mockResolvedValue(undefined);

    const result = await engine.chat(
      {
        user_id: "user-1",
        project_id: "project-test-001",
        session_id: sessionId,
        request_id: "rid-chat-latest-001",
        prompt: "follow-up",
      } as any,
      { dispatchKey: "project-test-001", turnGeneration: 2 },
    );

    expect(result.success).toBe(true);
    expect((result as AcpChatHttpResult).promptDispatched).toBe(true);
    expect(abortSpy).toHaveBeenCalledWith(sessionId);
    expect(promptAsyncSpy).toHaveBeenCalled();
  });

  it("dispatch: latest turn records memory before promptAsync", async () => {
    chatDispatchCoordinator.reset();
    const { engine, sessionId, session } = setupEngine();
    session.projectId = "project-test-001";

    chatDispatchCoordinator.bumpArrival("project-test-001", "rid-1");
    chatDispatchCoordinator.bumpArrival("project-test-001", "rid-2");

    const recordMemorySpy = vi.spyOn(
      acpChatMemory,
      "recordUserMessageToMemory",
    );
    const promptAsyncSpy = vi
      .spyOn(engine, "promptAsync")
      .mockResolvedValue(undefined);

    const result = await engine.chat(
      {
        user_id: "user-1",
        project_id: "project-test-001",
        session_id: sessionId,
        request_id: "rid-chat-latest-memory",
        prompt: "hello",
        original_user_prompt: "hello",
        open_long_memory: true,
      } as any,
      { dispatchKey: "project-test-001", turnGeneration: 2 },
    );

    expect(result.success).toBe(true);
    expect((result as AcpChatHttpResult).promptDispatched).toBe(true);
    expect(recordMemorySpy).toHaveBeenCalledTimes(1);
    expect(promptAsyncSpy).toHaveBeenCalled();

    recordMemorySpy.mockRestore();
  });

  it("dispatch: latest turn calls memory before promptAsync", async () => {
    chatDispatchCoordinator.reset();
    const key = "project-test-001";
    chatDispatchCoordinator.bumpArrival(key, "rid-1");
    chatDispatchCoordinator.bumpArrival(key, "rid-2");

    const { engine, sessionId, session } = setupEngine();
    session.projectId = key;

    const callOrder: string[] = [];
    vi.spyOn(acpChatMemory, "recordUserMessageToMemory").mockImplementation(
      () => {
        callOrder.push("memory");
      },
    );
    vi.spyOn(engine, "promptAsync").mockImplementation(async () => {
      callOrder.push("prompt");
    });

    await engine.chat(
      {
        user_id: "user-1",
        project_id: key,
        session_id: sessionId,
        request_id: "rid-chat-order",
        prompt: "hello",
        original_user_prompt: "hello",
        open_long_memory: true,
      } as any,
      { dispatchKey: key, turnGeneration: 2 },
    );

    expect(callOrder).toEqual(["memory", "prompt"]);
  });

  it("dispatch: superseded skips mcp warmup", async () => {
    chatDispatchCoordinator.reset();
    const key = "project-test-001";
    chatDispatchCoordinator.bumpArrival(key, "rid-1");
    chatDispatchCoordinator.bumpArrival(key, "rid-2");

    const { engine, sessionId, session } = setupEngine();
    session.projectId = key;

    const warmupSpy = vi.spyOn(
      engine as any,
      "waitForMcpFirstPromptWarmupIfNeeded",
    );
    vi.spyOn(engine, "promptAsync").mockResolvedValue(undefined);

    const result = await engine.chat(
      {
        user_id: "user-1",
        project_id: key,
        session_id: sessionId,
        request_id: "rid-chat-no-warmup",
        prompt: "hello",
        original_user_prompt: "hello",
        open_long_memory: true,
      } as any,
      { dispatchKey: key, turnGeneration: 1 },
    );

    expect((result as AcpChatHttpResult).promptDispatched).toBe(false);
    expect(warmupSpy).not.toHaveBeenCalled();
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

  it("codex-cli: config.workspaceDir 已是项目目录时不重复拼接 cwd", async () => {
    const engine = new AcpEngine("codex-cli");
    const projectDir = path.join(
      "/tmp/workspace",
      "computer-project-workspace",
      "user-1",
      "project-codex",
    );
    (engine as any).config = {
      engine: "codex-cli",
      workspaceDir: projectDir,
      mcpServers: {},
    };
    (engine as any).acpConnection = {} as any;

    const createSessionSpy = vi
      .spyOn(engine, "createSession")
      .mockImplementation(async () => {
        (engine as any).sessions.set("new-session-codex", {
          id: "new-session-codex",
          acpSessionId: "new-session-codex",
          createdAt: Date.now(),
          status: "idle",
          mcpServerCount: 0,
        });
        return {
          id: "new-session-codex",
          title: "project-codex",
          time: { created: Date.now() },
        } as any;
      });

    vi.spyOn(engine, "promptAsync").mockResolvedValue(undefined);

    const result = await engine.chat({
      user_id: "user-1",
      project_id: "project-codex",
      request_id: "rid-chat-codex-001",
      prompt: "hello codex",
    } as any);

    expect(result.success).toBe(true);
    expect(createSessionSpy).toHaveBeenCalledWith(
      expect.objectContaining({ cwd: projectDir }),
    );
  });

  it("claude-code: 新会话即使未启用 sandbox/context_servers 也等待 MCP warmup 后再发首条 prompt", async () => {
    const engine = new AcpEngine("claude-code");
    (engine as any).config = {
      engine: "claude-code",
      workspaceDir: "/tmp/workspace",
      mcpServers: {
        whois: { command: "node", args: ["whois.js"] },
        time: { command: "node", args: ["time.js"] },
      },
    };
    (engine as any).acpConnection = {} as any;
    vi.spyOn(engine, "createSession").mockImplementation(async () => {
      (engine as any).sessions.set("new-session-compat", {
        id: "new-session-compat",
        acpSessionId: "new-session-compat",
        createdAt: Date.now(),
        status: "idle",
        mcpServerCount: 2,
      });
      return {
        id: "new-session-compat",
        title: "project-compat",
        time: { created: Date.now() },
      } as any;
    });

    const promptAsyncSpy = vi
      .spyOn(engine, "promptAsync")
      .mockResolvedValue(undefined);

    vi.useFakeTimers();
    const chatPromise = engine.chat({
      user_id: "user-1",
      project_id: "project-compat",
      request_id: "rid-chat-compat-001",
      prompt: "hello compat",
    } as any);

    await vi.advanceTimersByTimeAsync(2999);
    expect(promptAsyncSpy).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    await expect(chatPromise).resolves.toMatchObject({ success: true });
    expect(promptAsyncSpy).toHaveBeenCalledWith(
      "new-session-compat",
      [{ type: "text", text: "hello compat" }],
      { messageID: "rid-chat-compat-001" },
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

  it("自定义下发引擎应返回 engineDisplayName（ACP agentInfo.name）", () => {
    const { engine, sessionId } = setupEngine();
    (engine as any).config = {
      customEngineCommand: "/path/to/custom-agent",
      customAgentId: "3182",
    };
    (engine as any)._acpAgentName = "deepagents-flow-ts";

    const list = engine.listSessionsDetailed();

    expect(list).toHaveLength(1);
    expect(list[0].id).toBe(sessionId);
    expect(list[0].engineDisplayName).toBe("deepagents-flow-ts");
    expect(list[0].engineType).toBe("nuwaxcode");
  });

  it("内置引擎不应设置 engineDisplayName", () => {
    const { engine } = setupEngine();
    (engine as any).config = { engine: "nuwaxcode" };

    const list = engine.listSessionsDetailed();

    expect(list[0].engineDisplayName).toBeUndefined();
  });
});

describe("AcpEngine.resumeAcpSession", () => {
  it("registers session after resumeSession without pendingNewSessionRegistration", async () => {
    const resumeSession = vi.fn().mockResolvedValue({});
    const engine = new AcpEngine("nuwaxcode");
    (engine as any).config = {
      engine: "nuwaxcode",
      workspaceDir: "/workspace/project",
      mcpServers: {},
    };
    (engine as any).acpConnection = {
      resumeSession,
      newSession: vi.fn(),
      prompt: vi.fn(),
      cancel: vi.fn(),
    };

    const sdk = await engine.resumeAcpSession("existing-sess", {
      title: "proj-1",
      cwd: "/workspace/project/proj-1",
    });

    expect(resumeSession).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "existing-sess",
        cwd: expect.any(String),
      }),
    );
    expect(sdk.id).toBe("existing-sess");
    expect((engine as any).sessions.has("existing-sess")).toBe(true);
    expect((engine as any).pendingNewSessionRegistration).toBe(false);
  });
});

describe("AcpEngine.chat session restore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses loadSession for session_id when agent supports loadSession (nuwaxcode)", async () => {
    const engine = new AcpEngine("nuwaxcode");
    const sesId = "ses_010fsavedSessionForLoad";
    const loadSession = vi.fn().mockResolvedValue({
      modes: { currentModeId: "default", availableModes: [] },
    });
    const resumeSession = vi.fn();
    const setSessionMode = vi.fn().mockResolvedValue({});
    const prompt = vi.fn().mockResolvedValue({ stopReason: "end_turn" });

    (engine as any).config = {
      engine: "nuwaxcode",
      workspaceDir: "/workspace/project",
      mcpServers: {},
    };
    (engine as any).agentCapabilities = {
      loadSession: true,
      sessionCapabilities: { resume: {} },
    };
    (engine as any).acpConnection = {
      loadSession,
      resumeSession,
      newSession: vi.fn(),
      prompt,
      cancel: vi.fn(),
      setSessionMode,
    };

    const result = await engine.chat({
      user_id: "u1",
      project_id: "proj-1",
      session_id: sesId,
      prompt: "continue",
      request_id: "req-1",
      agent_config: { agent_server: { agent_mode: "ask" } },
    });

    expect(loadSession).toHaveBeenCalled();
    expect(resumeSession).not.toHaveBeenCalled();
    // agent_mode 只进本地权限，不调用 ACP session/set_mode
    expect(setSessionMode).not.toHaveBeenCalled();
    expect((engine as any).permissions.getEffectiveMode(sesId)).toBe("ask");
    expect(result.success).toBe(true);
    expect(result.data?.is_new_session).toBe(false);
    expect(result.data?.session_id).toBe(sesId);
  });

  it("uses newSession when agent does not support loadSession", async () => {
    const engine = new AcpEngine("nuwaxcode");
    const newSession = vi.fn().mockResolvedValue({
      sessionId: "ses_010ffreshSession",
      modes: { currentModeId: "default", availableModes: [] },
    });
    const setSessionMode = vi.fn().mockResolvedValue({});
    const prompt = vi.fn().mockResolvedValue({ stopReason: "end_turn" });

    (engine as any).config = {
      engine: "nuwaxcode",
      workspaceDir: "/workspace/project",
      mcpServers: {},
    };
    (engine as any).agentCapabilities = {
      sessionCapabilities: { resume: {} },
    };
    (engine as any).acpConnection = {
      newSession,
      prompt,
      cancel: vi.fn(),
      setSessionMode,
    };

    const result = await engine.chat({
      user_id: "u1",
      project_id: "proj-1",
      session_id: "ses_010fsavedButNoLoadCap",
      prompt: "continue",
      request_id: "req-1",
      agent_config: { agent_server: { agent_mode: "ask" } },
    });

    expect(newSession).toHaveBeenCalled();
    expect(setSessionMode).not.toHaveBeenCalled();
    expect(
      (engine as any).permissions.getEffectiveMode("ses_010ffreshSession"),
    ).toBe("ask");
    expect(result.success).toBe(true);
    expect(result.data?.is_new_session).toBe(true);
    expect(result.data?.session_id).toBe("ses_010ffreshSession");
  });

  it("applies agent_mode locally without ACP setSessionMode even when modes match", async () => {
    const engine = new AcpEngine("nuwaxcode");
    const sesId = "ses_010falreadyAsk";
    const loadSession = vi.fn().mockResolvedValue({
      modes: { currentModeId: "default", availableModes: [] },
    });
    const setSessionMode = vi.fn();
    const prompt = vi.fn().mockResolvedValue({ stopReason: "end_turn" });

    (engine as any).config = {
      engine: "nuwaxcode",
      workspaceDir: "/workspace/project",
      mcpServers: {},
    };
    (engine as any).agentCapabilities = {
      loadSession: true,
    };
    (engine as any).acpConnection = {
      loadSession,
      newSession: vi.fn(),
      prompt,
      cancel: vi.fn(),
      setSessionMode,
    };

    await engine.chat({
      user_id: "u1",
      project_id: "proj-1",
      session_id: sesId,
      prompt: "continue",
      agent_config: { agent_server: { agent_mode: "ask" } },
    });

    expect(setSessionMode).not.toHaveBeenCalled();
    expect((engine as any).permissions.getEffectiveMode(sesId)).toBe("ask");
  });

  it("syncs session model when loaded session model differs from request model", async () => {
    const engine = new AcpEngine("nuwaxcode");
    const sesId = "ses_010fmodelSyncTest";
    const loadSession = vi.fn().mockResolvedValue({
      modes: { currentModeId: "default", availableModes: [] },
      configOptions: [
        {
          id: "model",
          currentValue: "openai-compatible/glm-5",
        },
      ],
    });
    const unstable_setSessionModel = vi.fn().mockResolvedValue({});
    const prompt = vi.fn().mockResolvedValue({ stopReason: "end_turn" });

    (engine as any).config = {
      engine: "nuwaxcode",
      model: "openai-compatible/deepseek-v4-flash",
      workspaceDir: "/workspace/project",
      mcpServers: {},
      env: { OPENCODE_MODEL: "openai-compatible/deepseek-v4-flash" },
    };
    (engine as any).agentCapabilities = {
      loadSession: true,
    };
    (engine as any).acpConnection = {
      loadSession,
      newSession: vi.fn(),
      prompt,
      cancel: vi.fn(),
      setSessionMode: vi.fn(),
      unstable_setSessionModel,
    };

    const result = await engine.chat({
      user_id: "u1",
      project_id: "proj-1",
      session_id: sesId,
      prompt: "continue",
      request_id: "req-1",
      agent_config: {
        agent_server: {
          agent_mode: "ask",
          env: {
            OPENCODE_MODEL: "openai-compatible/deepseek-v4-flash",
          },
        },
      },
    } as any);

    expect(unstable_setSessionModel).toHaveBeenCalledWith({
      sessionId: sesId,
      modelId: "openai-compatible/deepseek-v4-flash",
    });
    expect(result.success).toBe(true);
  });

  it("surfaces friendly model mismatch error when model sync path is unavailable", async () => {
    const engine = new AcpEngine("nuwaxcode");
    const prompt = vi.fn();

    (engine as any).config = {
      engine: "nuwaxcode",
      model: "openai-compatible/deepseek-v4-flash",
      workspaceDir: "/workspace/project",
      mcpServers: {},
      env: { OPENCODE_MODEL: "openai-compatible/deepseek-v4-flash" },
    };
    (engine as any).agentCapabilities = { loadSession: true };
    (engine as any).acpConnection = {
      prompt,
      cancel: vi.fn(),
      setSessionMode: vi.fn(),
    };
    (engine as any).sessions.set("mem-sess", {
      id: "mem-sess",
      acpSessionId: "mem-sess",
      createdAt: Date.now(),
      status: "idle",
      acpCurrentModeId: "ask",
      acpCurrentModelId: "openai-compatible/glm-5",
      resumedModelId: "openai-compatible/glm-5",
    });

    const result = await engine.chat({
      user_id: "u1",
      project_id: "proj-1",
      session_id: "mem-sess",
      prompt: "continue",
      request_id: "req-3",
      agent_config: {
        agent_server: {
          agent_mode: "ask",
          env: {
            OPENCODE_MODEL: "openai-compatible/deepseek-v4-flash",
          },
        },
      },
    } as any);

    expect(prompt).not.toHaveBeenCalled();
    expect(result.success).toBe(false);
    expect(result.message).toContain("Session model is out of sync");
    expect(result.message).toContain("openai-compatible/glm-5");
    expect(result.message).toContain("openai-compatible/deepseek-v4-flash");
  });

  it("updates local permission agent_mode when reusing in-memory session", async () => {
    const engine = new AcpEngine("nuwaxcode");
    const setSessionMode = vi.fn().mockResolvedValue({});
    const prompt = vi.fn().mockResolvedValue({ stopReason: "end_turn" });

    (engine as any).config = {
      engine: "nuwaxcode",
      workspaceDir: "/workspace/project",
      mcpServers: {},
    };
    (engine as any).agentCapabilities = { loadSession: true };
    (engine as any).acpConnection = {
      prompt,
      cancel: vi.fn(),
      setSessionMode,
    };
    (engine as any).sessions.set("mem-sess", {
      id: "mem-sess",
      acpSessionId: "mem-sess",
      createdAt: Date.now(),
      status: "idle",
      acpCurrentModeId: "yolo",
    });
    (engine as any).permissions.setEffectiveMode("mem-sess", "yolo");

    const result = await engine.chat({
      user_id: "u1",
      project_id: "proj-1",
      session_id: "mem-sess",
      prompt: "second turn ask",
      request_id: "req-2",
      agent_config: { agent_server: { agent_mode: "ask" } },
    });

    expect(setSessionMode).not.toHaveBeenCalled();
    expect((engine as any).permissions.getEffectiveMode("mem-sess")).toBe(
      "ask",
    );
    expect(result.success).toBe(true);
  });
});

describe("AcpEngine plan mode", () => {
  const PLAN_MODES = {
    currentModeId: "build",
    availableModes: [
      { id: "build", name: "build" },
      { id: "plan", name: "plan" },
    ],
  };

  function buildPlanEngine(opts: {
    modes?: unknown;
    configOptions?: unknown;
    setSessionMode?: ReturnType<typeof vi.fn>;
    setSessionConfigOption?: ReturnType<typeof vi.fn>;
  }) {
    const engine = new AcpEngine("nuwaxcode");
    const loadSession = vi.fn().mockResolvedValue({
      modes: opts.modes ?? PLAN_MODES,
      configOptions: opts.configOptions,
    });
    (engine as any).config = {
      engine: "nuwaxcode",
      workspaceDir: "/workspace/project",
      mcpServers: {},
    };
    (engine as any).agentCapabilities = { loadSession: true };
    (engine as any).acpConnection = {
      loadSession,
      newSession: vi.fn(),
      prompt: vi.fn().mockResolvedValue({ stopReason: "end_turn" }),
      cancel: vi.fn(),
      setSessionMode: opts.setSessionMode ?? vi.fn().mockResolvedValue({}),
      setSessionConfigOption: opts.setSessionConfigOption,
    };
    return { engine, loadSession };
  }

  it("plan 档：引擎广告 plan mode 时下发 setSessionMode", async () => {
    const setSessionMode = vi.fn().mockResolvedValue({});
    const { engine } = buildPlanEngine({ setSessionMode });

    const result = await engine.chat({
      user_id: "u1",
      project_id: "proj-1",
      session_id: "ses_plan1",
      prompt: "plan this feature",
      request_id: "req-plan-1",
      agent_config: { agent_server: { agent_mode: "plan" } },
    });

    expect(setSessionMode).toHaveBeenCalledWith({
      sessionId: "ses_plan1",
      modeId: "plan",
    });
    // plan 档本地审批策略强制折算为 ask
    expect((engine as any).permissions.getEffectiveMode("ses_plan1")).toBe(
      "ask",
    );
    expect(result.success).toBe(true);
  });

  it("plan 档：set_mode 失败时 fallback mode config option，prompt 不中断", async () => {
    const setSessionMode = vi
      .fn()
      .mockRejectedValue(
        Object.assign(new Error("Method not found"), { code: -32601 }),
      );
    const setSessionConfigOption = vi
      .fn()
      .mockResolvedValue({ configOptions: [] });
    const { engine } = buildPlanEngine({
      setSessionMode,
      setSessionConfigOption,
    });

    const result = await engine.chat({
      user_id: "u1",
      project_id: "proj-1",
      session_id: "ses_plan2",
      prompt: "plan this feature",
      agent_config: { agent_server: { agent_mode: "plan" } },
    });

    expect(setSessionConfigOption).toHaveBeenCalledWith({
      sessionId: "ses_plan2",
      configId: "mode",
      value: "plan",
    });
    expect(result.success).toBe(true);
  });

  it("plan 档：nuwaxcode 无 modes 字段时从 mode config option 推导并下发", async () => {
    const setSessionMode = vi.fn().mockResolvedValue({});
    const { engine } = buildPlanEngine({
      modes: null,
      configOptions: [
        {
          id: "mode",
          type: "select",
          currentValue: "build",
          options: [
            { value: "build", name: "build" },
            { value: "plan", name: "plan" },
          ],
        },
      ],
      setSessionMode,
    });

    await engine.chat({
      user_id: "u1",
      project_id: "proj-1",
      session_id: "ses_plan3",
      prompt: "plan this feature",
      agent_config: { agent_server: { agent_mode: "plan" } },
    });

    expect(setSessionMode).toHaveBeenCalledWith({
      sessionId: "ses_plan3",
      modeId: "plan",
    });
  });

  it("plan 档：引擎无 plan mode 时跳过下发，prompt 照常", async () => {
    const setSessionMode = vi.fn().mockResolvedValue({});
    const { engine } = buildPlanEngine({
      modes: {
        currentModeId: "agent",
        availableModes: [{ id: "read-only" }, { id: "agent" }],
      },
      setSessionMode,
    });

    const result = await engine.chat({
      user_id: "u1",
      project_id: "proj-1",
      session_id: "ses_plan4",
      prompt: "plan this feature",
      agent_config: { agent_server: { agent_mode: "plan" } },
    });

    expect(setSessionMode).not.toHaveBeenCalled();
    expect(result.success).toBe(true);
  });

  it("退出 plan：恢复会话初始 mode，避免 plan 跨请求泄漏", async () => {
    const setSessionMode = vi.fn().mockResolvedValue({});
    const { engine } = buildPlanEngine({ setSessionMode });

    await engine.chat({
      user_id: "u1",
      project_id: "proj-1",
      session_id: "ses_plan5",
      prompt: "plan this feature",
      agent_config: { agent_server: { agent_mode: "plan" } },
    });
    await engine.chat({
      user_id: "u1",
      project_id: "proj-1",
      session_id: "ses_plan5",
      prompt: "now implement",
      agent_config: { agent_server: { agent_mode: "yolo" } },
    });

    const calls = setSessionMode.mock.calls.map((c) => c[0]);
    expect(calls).toContainEqual({ sessionId: "ses_plan5", modeId: "plan" });
    expect(calls).toContainEqual({ sessionId: "ses_plan5", modeId: "build" });
    expect((engine as any).permissions.getEffectiveMode("ses_plan5")).toBe(
      "yolo",
    );
  });

  it("current_mode_update：引擎侧退出 plan 后本地镜像同步，重复 plan 请求不重复下发", async () => {
    const setSessionMode = vi.fn().mockResolvedValue({});
    const { engine } = buildPlanEngine({ setSessionMode });

    await engine.chat({
      user_id: "u1",
      project_id: "proj-1",
      session_id: "ses_plan6",
      prompt: "plan this feature",
      agent_config: { agent_server: { agent_mode: "plan" } },
    });
    // ExitPlanMode 批准 → 引擎切回 build 并广播 current_mode_update
    (engine as any).handleAcpSessionUpdate("ses_plan6", {
      sessionUpdate: "current_mode_update",
      currentModeId: "build",
    });
    await engine.chat({
      user_id: "u1",
      project_id: "proj-1",
      session_id: "ses_plan6",
      prompt: "plan again",
      agent_config: { agent_server: { agent_mode: "plan" } },
    });

    const planCalls = setSessionMode.mock.calls.filter(
      (c) => c[0].modeId === "plan",
    );
    // 镜像先被 current_mode_update 重置为 build，第二次 plan 请求才会再次下发
    expect(planCalls).toHaveLength(2);
    expect((engine as any).sessions.get("ses_plan6").acpEngineModeId).toBe(
      "plan",
    );
  });
});

describe("AcpEngine isolated HOME destroy", () => {
  afterEach(() => {
    if (fs.existsSync(mockAppDataDir)) {
      fs.rmSync(mockAppDataDir, { recursive: true, force: true });
    }
  });

  it("preserves real project isolated HOME on destroy", async () => {
    const isolatedPaths = await import("./isolatedHomePaths");
    const engine = new AcpEngine("nuwaxcode");
    const persistentHome = isolatedPaths.resolveProjectIsolatedHomeDir({
      kind: "project",
      userId: "u1",
      workDirId: "p1",
      engine: "nuwaxcode",
    });
    fs.mkdirSync(persistentHome, { recursive: true });
    fs.writeFileSync(path.join(persistentHome, "marker.txt"), "keep");
    (engine as any).isolatedHome = persistentHome;

    await engine.destroy();

    expect(fs.existsSync(path.join(persistentHome, "marker.txt"))).toBe(true);
  });

  it("removes ephemeral isolated HOME on destroy", async () => {
    const engine = new AcpEngine("nuwaxcode");
    const ephemeralHome = fs.mkdtempSync(
      path.join(os.tmpdir(), "acp-ephemeral-"),
    );
    fs.writeFileSync(path.join(ephemeralHome, "marker.txt"), "temp");
    (engine as any).isolatedHome = ephemeralHome;

    await engine.destroy();

    expect(fs.existsSync(ephemeralHome)).toBe(false);
  });
});

describe("AcpEngine switch_mode 批准后 ACP 生效确认", () => {
  const PLAN_REQUEST = {
    toolCall: {
      toolCallId: "tc-exit-plan",
      kind: "switch_mode",
      title: "实施计划",
      status: "pending",
    },
    options: [
      { optionId: "auto", kind: "allow_always", name: 'Yes, and use "auto"' },
      { optionId: "acceptEdits", kind: "allow_always", name: "Yes, auto-accept" },
      { optionId: "default", kind: "allow_once", name: "Yes, manually approve" },
      { optionId: "plan", kind: "reject_once", name: "No, keep planning" },
    ],
  };

  function setupPlanSession() {
    const { engine, sessionId, session } = setupEngine("claude-code");
    (session as any).engineModes = {
      availableModes: [{ id: "default" }, { id: "plan" }],
      currentModeId: "default",
      source: "modes",
    };
    (session as any).acpEngineModeId = "plan";
    const acpConnection = (engine as any).acpConnection;
    acpConnection.setSessionMode = vi.fn().mockResolvedValue({});
    // 缩短确认窗口（默认 1500ms）
    (engine as any).planExitConfirmWindowMs = 60;
    (engine as any).planExitConfirmPollMs = 10;
    (engine as any).setEffectiveMode(sessionId, "ask");
    return { engine, sessionId, setSessionMode: acpConnection.setSessionMode };
  }

  it("引擎自发 current_mode_update 退出 plan：确认日志路径，不重复 set_mode", async () => {
    const { engine, sessionId, setSessionMode } = setupPlanSession();
    const responsePromise = (engine as any).handlePermissionRequest({
      sessionId,
      ...PLAN_REQUEST,
    });

    (engine as any).resolvePermissionIntervention({
      permission_resolve_request: {
        request_permission_response: {
          outcome: { Selected: { option_id: "default" } },
        },
        session_id: sessionId,
        tool_call_id: "tc-exit-plan",
      },
    });

    // 引擎自切（claude 批准后广播 current_mode_update）→ 镜像离开 plan
    (engine as any).handleAcpSessionUpdate(sessionId, {
      sessionUpdate: "current_mode_update",
      currentModeId: "default",
    });

    await expect(responsePromise).resolves.toEqual({
      outcome: { outcome: "selected", optionId: "default" },
    });
    // 等过确认窗口：镜像已离开 plan → 不应触发兜底 set_mode
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(setSessionMode).not.toHaveBeenCalled();
  });

  it("引擎无自发信号：超时后主动 set_mode 恢复初始档", async () => {
    const { engine, sessionId, setSessionMode } = setupPlanSession();
    const responsePromise = (engine as any).handlePermissionRequest({
      sessionId,
      ...PLAN_REQUEST,
    });

    (engine as any).resolvePermissionIntervention({
      permission_resolve_request: {
        request_permission_response: {
          outcome: { Selected: { option_id: "default" } },
        },
        session_id: sessionId,
        tool_call_id: "tc-exit-plan",
      },
    });

    await expect(responsePromise).resolves.toEqual({
      outcome: { outcome: "selected", optionId: "default" },
    });
    // 无 current_mode_update → 窗口超时后兜底恢复进入 plan 前的初始档
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(setSessionMode).toHaveBeenCalledWith({
      sessionId,
      modeId: "default",
    });
    expect((engine as any).sessions.get(sessionId).acpEngineModeId).toBe(
      "default",
    );
  });

  it("拒绝（继续完善计划）与非 switch_mode 批准不触发确认逻辑", async () => {
    const { engine, sessionId, setSessionMode } = setupPlanSession();

    // 拒绝：留在 plan
    const rejectPromise = (engine as any).handlePermissionRequest({
      sessionId,
      ...PLAN_REQUEST,
    });
    (engine as any).resolvePermissionIntervention({
      permission_resolve_request: {
        request_permission_response: {
          outcome: { Selected: { option_id: "plan" } },
        },
        session_id: sessionId,
        tool_call_id: "tc-exit-plan",
      },
    });
    await rejectPromise;

    // 非 switch_mode 批准
    const editPromise = (engine as any).handlePermissionRequest({
      sessionId,
      toolCall: {
        toolCallId: "tc-edit",
        kind: "edit",
        title: "Edit file",
      },
      options: [
        { optionId: "allow-once", kind: "allow_once", name: "allow once" },
        { optionId: "reject-once", kind: "reject_once", name: "reject" },
      ],
    });
    (engine as any).resolvePermissionIntervention({
      permission_resolve_request: {
        request_permission_response: {
          outcome: { Selected: { option_id: "allow-once" } },
        },
        session_id: sessionId,
        tool_call_id: "tc-edit",
      },
    });
    await editPromise;

    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(setSessionMode).not.toHaveBeenCalled();
    // 拒绝后引擎仍处 plan
    expect((engine as any).sessions.get(sessionId).acpEngineModeId).toBe("plan");
  });
});
