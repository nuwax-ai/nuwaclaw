import { describe, it, expect } from "vitest";
import { evaluateStrictWritePermission } from "./strictPermissionGuard";
import type { AcpPermissionRequest } from "./acpClient";

function makeRequest(
  overrides?: Partial<AcpPermissionRequest>,
): AcpPermissionRequest {
  const overrideToolCall = overrides?.toolCall || {};
  return {
    sessionId: "s-1",
    toolCall: {
      toolCallId: "tc-1",
      kind: "edit",
      title: "Edit",
      rawInput: { file_path: "/workspace/a.txt" },
      ...overrideToolCall,
    },
    options: [
      { optionId: "allow-once", kind: "allow_once", name: "allow once" },
      { optionId: "allow-always", kind: "allow_always", name: "allow always" },
    ],
    ...overrides,
  };
}

describe("strictPermissionGuard", () => {
  it("strict 关闭时不拦截", () => {
    const result = evaluateStrictWritePermission(makeRequest(), {
      strictEnabled: false,
      workspaceDir: "/workspace",
      appDataDir: "/home/me/.nuwaclaw",
      tempDirs: ["/tmp"],
    });

    expect(result.blocked).toBe(false);
    expect(result.reason).toBe("strict_not_active");
  });

  it("允许 workspace 内写入", () => {
    const result = evaluateStrictWritePermission(
      makeRequest({
        toolCall: {
          toolCallId: "tc-2",
          kind: "edit",
          title: "Edit",
          rawInput: { file_path: "/workspace/src/a.ts" },
        },
      }),
      {
        strictEnabled: true,
        workspaceDir: "/workspace",
        appDataDir: "/home/me/.nuwaclaw",
        tempDirs: ["/tmp"],
      },
    );

    expect(result.isWriteRequest).toBe(true);
    expect(result.blocked).toBe(false);
    expect(result.reason).toBe("strict_paths_allowed");
  });

  it("相对路径按 workspace 解析，允许写入", () => {
    const result = evaluateStrictWritePermission(
      makeRequest({
        toolCall: {
          toolCallId: "tc-2b",
          kind: "edit",
          title: "Edit",
          rawInput: { file_path: "src/a.ts" },
        },
      }),
      {
        strictEnabled: true,
        workspaceDir: "/workspace",
        appDataDir: "/home/me/.nuwaclaw",
        tempDirs: ["/tmp"],
      },
    );

    expect(result.blocked).toBe(false);
    expect(result.reason).toBe("strict_paths_allowed");
    expect(result.resolvedPaths[0]).toBe("/workspace/src/a.ts");
  });

  it("允许 temp 目录写入", () => {
    const result = evaluateStrictWritePermission(
      makeRequest({
        toolCall: {
          toolCallId: "tc-3",
          kind: "write",
          title: "Write",
          rawInput: { file_path: "/tmp/a.log" },
        },
      }),
      {
        strictEnabled: true,
        workspaceDir: "/workspace",
        appDataDir: "/home/me/.nuwaclaw",
        tempDirs: ["/tmp"],
      },
    );

    expect(result.blocked).toBe(false);
    expect(result.reason).toBe("strict_paths_allowed");
  });

  it("~ 路径按 isolatedHome 解析，允许写入", () => {
    const result = evaluateStrictWritePermission(
      makeRequest({
        toolCall: {
          toolCallId: "tc-3b",
          kind: "write",
          title: "Write",
          rawInput: { file_path: "~/notes/a.txt" },
        },
      }),
      {
        strictEnabled: true,
        workspaceDir: "/workspace",
        isolatedHome: "/sandbox/home",
        appDataDir: "/home/me/.nuwaclaw",
        tempDirs: ["/tmp"],
      },
    );

    expect(result.blocked).toBe(false);
    expect(result.reason).toBe("strict_paths_allowed");
    expect(result.resolvedPaths[0]).toBe("/sandbox/home/notes/a.txt");
  });

  it("Windows: 绝对路径按 win32 语义解析且大小写不敏感", () => {
    const result = evaluateStrictWritePermission(
      makeRequest({
        toolCall: {
          toolCallId: "tc-win-1",
          kind: "write",
          title: "Write",
          rawInput: { file_path: "c:\\workspace\\src\\a.ts" },
        },
      }),
      {
        strictEnabled: true,
        workspaceDir: "C:\\Workspace",
        appDataDir: "C:\\Users\\me\\.nuwaclaw",
        tempDirs: ["C:\\Temp"],
        platform: "win32",
      },
    );

    expect(result.blocked).toBe(false);
    expect(result.reason).toBe("strict_paths_allowed");
    expect(result.resolvedPaths[0]).toBe("c:\\workspace\\src\\a.ts");
  });

  it("Windows: 绝对路径超出 writable roots 时拒绝", () => {
    const result = evaluateStrictWritePermission(
      makeRequest({
        toolCall: {
          toolCallId: "tc-win-2",
          kind: "write",
          title: "Write",
          rawInput: { file_path: "D:\\outside\\a.ts" },
        },
      }),
      {
        strictEnabled: true,
        workspaceDir: "C:\\Workspace",
        appDataDir: "C:\\Users\\me\\.nuwaclaw",
        tempDirs: ["C:\\Temp"],
        platform: "win32",
      },
    );

    expect(result.blocked).toBe(true);
    expect(result.reason).toBe("strict_path_outside_roots");
  });

  it("拒绝 workspace/temp/appData 外写入", () => {
    const result = evaluateStrictWritePermission(
      makeRequest({
        toolCall: {
          toolCallId: "tc-4",
          kind: "write",
          title: "Write",
          rawInput: { file_path: "/etc/passwd" },
        },
      }),
      {
        strictEnabled: true,
        workspaceDir: "/workspace",
        appDataDir: "/home/me/.nuwaclaw",
        tempDirs: ["/tmp"],
      },
    );

    expect(result.blocked).toBe(true);
    expect(result.reason).toBe("strict_path_outside_roots");
  });

  it("strict 写入请求缺少路径时 fail-closed", () => {
    const result = evaluateStrictWritePermission(
      makeRequest({
        toolCall: {
          toolCallId: "tc-5",
          kind: "edit",
          title: "Edit",
          rawInput: {},
        },
      }),
      {
        strictEnabled: true,
        workspaceDir: "/workspace",
        appDataDir: "/home/me/.nuwaclaw",
        tempDirs: ["/tmp"],
      },
    );

    expect(result.blocked).toBe(true);
    expect(result.reason).toBe("strict_missing_path");
  });

  it("非写入请求不触发 strict 路径拦截", () => {
    const result = evaluateStrictWritePermission(
      makeRequest({
        toolCall: {
          toolCallId: "tc-6",
          kind: "bash",
          title: "Bash",
          rawInput: { command: "ls -la" },
        },
      }),
      {
        strictEnabled: true,
        workspaceDir: "/workspace",
        appDataDir: "/home/me/.nuwaclaw",
        tempDirs: ["/tmp"],
      },
    );

    expect(result.isWriteRequest).toBe(false);
    expect(result.blocked).toBe(false);
    expect(result.reason).toBe("not_write_request");
  });
});
