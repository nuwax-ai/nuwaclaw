/**
 * 单元测试: AcpPermissionCoordinator — 权限决策链
 *
 * 覆盖内容（决策顺序：question → strict guard → tool_approval_rules → agent_mode）：
 * - question 类型直接 cancel
 * - strict write guard 拦截越界写入
 * - tool_approval_rules 的 deny / allow / ask 三种动作
 * - yolo 自动放行（含 strict write 仅 allow_once 的特殊分支）
 * - ask 模式与默认模式（未设置时按 yolo）
 * - 会话状态维护（setSessionApprovalRules / clearSession / destroy）
 */

import { describe, it, expect, vi } from "vitest";

vi.mock("electron-log", () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock("@main/services/system/platformAdapter", () => ({
  getCurrentPlatform: vi.fn(() => "darwin"),
}));

import { AcpPermissionCoordinator } from "./permissionCoordinator";
import type { PermissionEvaluateContext } from "./permissionCoordinator";
import type { AcpPermissionRequest } from "../acpClient";

const SESSION = "acp-session-1";

function makeRequest(overrides?: {
  kind?: string;
  title?: string;
  rawInput?: unknown;
  options?: Array<{ optionId: string; kind: string; name: string }>;
}): AcpPermissionRequest {
  return {
    sessionId: SESSION,
    toolCall: {
      toolCallId: "tc-1",
      kind: overrides?.kind ?? "execute",
      title: overrides?.title ?? "Run command",
      status: "pending",
      rawInput: overrides?.rawInput ?? { command: "ls" },
      content: [],
    },
    options: overrides?.options ?? [
      { optionId: "allow-always", kind: "allow_always", name: "总是允许" },
      { optionId: "allow-once", kind: "allow_once", name: "允许本次" },
      { optionId: "reject-once", kind: "reject_once", name: "拒绝" },
    ],
  } as unknown as AcpPermissionRequest;
}

function makeCtx(
  overrides?: Partial<PermissionEvaluateContext>,
): PermissionEvaluateContext {
  return {
    strictEnabled: false,
    sandboxMode: "compat",
    workspaceDir: "/tmp/ws",
    projectWorkspaceDir: "/tmp/ws",
    sessionWorkspaceDir: "/tmp/ws",
    isolatedHome: "/tmp/iso-home",
    appDataDir: "/tmp/appdata",
    tempDirs: ["/tmp"],
    ...overrides,
  };
}

describe("AcpPermissionCoordinator.evaluate", () => {
  it("question 类型直接 cancel", () => {
    const c = new AcpPermissionCoordinator("[test]");
    const decision = c.evaluate(makeRequest({ kind: "question" }), makeCtx());
    expect(decision).toEqual({ kind: "cancel", reason: "question_request" });
  });

  it("默认（未设置模式）按 yolo 放行，优先 allow_always", () => {
    const c = new AcpPermissionCoordinator("[test]");
    const decision = c.evaluate(makeRequest(), makeCtx());
    expect(decision).toEqual({
      kind: "select",
      optionId: "allow-always",
      reason: "yolo_auto_approve",
    });
  });

  it("ask 模式返回 ask", () => {
    const c = new AcpPermissionCoordinator("[test]");
    c.setEffectiveMode(SESSION, "ask");
    const decision = c.evaluate(makeRequest(), makeCtx());
    expect(decision).toEqual({ kind: "ask" });
  });

  it("yolo 无可选项时 cancel", () => {
    const c = new AcpPermissionCoordinator("[test]");
    const decision = c.evaluate(makeRequest({ options: [] }), makeCtx());
    expect(decision).toEqual({
      kind: "cancel",
      reason: "no_selectable_options",
    });
  });

  describe("strict write guard", () => {
    it("strict 下 workspace 外写入 cancel", () => {
      const c = new AcpPermissionCoordinator("[test]");
      const decision = c.evaluate(
        makeRequest({
          kind: "write",
          title: "Write",
          rawInput: { file_path: "/etc/passwd" },
        }),
        makeCtx({ strictEnabled: true, sandboxMode: "strict" }),
      );
      expect(decision.kind).toBe("cancel");
    });

    it("strict 下 workspace 内写入仅放行 allow_once", () => {
      const c = new AcpPermissionCoordinator("[test]");
      const decision = c.evaluate(
        makeRequest({
          kind: "edit",
          title: "Edit",
          rawInput: { file_path: "/tmp/ws/a.txt" },
        }),
        makeCtx({ strictEnabled: true, sandboxMode: "strict" }),
      );
      expect(decision).toEqual({
        kind: "select",
        optionId: "allow-once",
        reason: "strict_write_allow_once",
      });
    });

    it("strict write 且无 allow_once 选项时 cancel", () => {
      const c = new AcpPermissionCoordinator("[test]");
      const decision = c.evaluate(
        makeRequest({
          kind: "edit",
          title: "Edit",
          rawInput: { file_path: "/tmp/ws/a.txt" },
          options: [
            { optionId: "allow-always", kind: "allow_always", name: "总是" },
          ],
        }),
        makeCtx({ strictEnabled: true, sandboxMode: "strict" }),
      );
      expect(decision).toEqual({
        kind: "cancel",
        reason: "strict_allow_once_missing",
      });
    });
  });

  describe("tool_approval_rules", () => {
    it("deny 规则命中直接 cancel", () => {
      const c = new AcpPermissionCoordinator("[test]");
      c.setSessionApprovalRules(SESSION, [{ patterns: ["*"], action: "deny" }]);
      const decision = c.evaluate(makeRequest(), makeCtx());
      expect(decision).toEqual({
        kind: "cancel",
        reason: "tool_approval_rules_deny",
      });
    });

    it("allow 规则命中自动放行（优先 allow_always）", () => {
      const c = new AcpPermissionCoordinator("[test]");
      c.setEffectiveMode(SESSION, "ask"); // 即使 ask 模式，allow 规则仍放行
      c.setSessionApprovalRules(SESSION, [
        { patterns: ["ls*"], action: "allow" },
      ]);
      // execute 类工具的匹配目标是 rawInput.command（"ls"），非 title
      const decision = c.evaluate(makeRequest(), makeCtx());
      expect(decision).toEqual({
        kind: "select",
        optionId: "allow-always",
        reason: "tool_approval_rules_allow",
      });
    });

    it("ask 规则命中时强制审批，忽略 yolo 默认放行", () => {
      const c = new AcpPermissionCoordinator("[test]");
      c.setEffectiveMode(SESSION, "yolo");
      c.setSessionApprovalRules(SESSION, [{ patterns: ["*"], action: "ask" }]);
      const decision = c.evaluate(makeRequest(), makeCtx());
      expect(decision).toEqual({ kind: "ask" });
    });

    it("规则未命中时回落 agent_mode 默认行为", () => {
      const c = new AcpPermissionCoordinator("[test]");
      c.setSessionApprovalRules(SESSION, [
        { patterns: ["git push*"], action: "deny" },
      ]);
      const decision = c.evaluate(makeRequest(), makeCtx());
      expect(decision).toEqual({
        kind: "select",
        optionId: "allow-always",
        reason: "yolo_auto_approve",
      });
    });

    it("无 tool_kind 规则命中 other/MCP 工具", () => {
      const c = new AcpPermissionCoordinator("[test]");
      c.setEffectiveMode(SESSION, "yolo");
      c.setSessionApprovalRules(SESSION, [
        { patterns: ["Bash*"], action: "ask" },
      ]);
      const decision = c.evaluate(
        makeRequest({
          kind: "other",
          title: "Bash",
          rawInput: { tool_name: "Bash" },
        }),
        makeCtx(),
      );
      expect(decision).toEqual({ kind: "ask" });
    });

    it("setSessionApprovalRules 支持 kind 别名规范化", () => {
      const c = new AcpPermissionCoordinator("[test]");
      c.setSessionApprovalRules(SESSION, [
        { patterns: ["*"], action: "deny", kind: "Other" },
      ]);
      const decision = c.evaluate(
        makeRequest({
          kind: "other",
          title: "any_tool",
          rawInput: { tool_name: "any_tool" },
        }),
        makeCtx(),
      );
      expect(decision).toEqual({
        kind: "cancel",
        reason: "tool_approval_rules_deny",
      });
    });

    it("clearSession 后规则失效", () => {
      const c = new AcpPermissionCoordinator("[test]");
      c.setSessionApprovalRules(SESSION, [{ patterns: ["*"], action: "deny" }]);
      c.clearSession(SESSION);
      const decision = c.evaluate(makeRequest(), makeCtx());
      expect(decision.kind).toBe("select");
    });

    it("setSessionApprovalRules 传空清除规则（向后兼容）", () => {
      const c = new AcpPermissionCoordinator("[test]");
      c.setSessionApprovalRules(SESSION, [{ patterns: ["*"], action: "deny" }]);
      c.setSessionApprovalRules(SESSION, undefined);
      const decision = c.evaluate(makeRequest(), makeCtx());
      expect(decision.kind).toBe("select");
    });
  });

  describe("状态管理", () => {
    it("clearSession 清除生效模式（回到默认 yolo）", () => {
      const c = new AcpPermissionCoordinator("[test]");
      c.setEffectiveMode(SESSION, "ask");
      expect(c.getEffectiveMode(SESSION)).toBe("ask");
      c.clearSession(SESSION);
      expect(c.getEffectiveMode(SESSION)).toBe("yolo");
    });

    it("destroy 清空全部状态", () => {
      const c = new AcpPermissionCoordinator("[test]");
      c.setEffectiveMode(SESSION, "ask");
      c.setSessionApprovalRules(SESSION, [{ patterns: ["*"], action: "deny" }]);
      c.destroy();
      expect(c.getEffectiveMode(SESSION)).toBe("yolo");
      const decision = c.evaluate(makeRequest(), makeCtx());
      expect(decision.kind).toBe("select");
    });
  });
});
