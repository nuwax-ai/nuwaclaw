import { describe, it, expect } from "vitest";
import {
  globToRegex,
  extractMatchTarget,
  extractMatchTargets,
  matchToolApprovalRules,
  normalizeToolApprovalRules,
  isCommandLikeKind,
} from "./toolApprovalRules";
import type { AcpPermissionRequest } from "../acpClient";
import type { ToolApprovalRule } from "@shared/types/computerTypes";

// --- globToRegex ---

describe("globToRegex", () => {
  it("* 匹配任意内容", () => {
    expect(globToRegex("rm *").test("rm -rf /tmp")).toBe(true);
    expect(globToRegex("rm *").test("rm")).toBe(false);
    expect(globToRegex("*delete*").test("file_delete")).toBe(true);
    expect(globToRegex("*delete*").test("read_file")).toBe(false);
  });

  it("? 匹配单个字符", () => {
    expect(globToRegex("rm ?").test("rm f")).toBe(true);
    expect(globToRegex("rm ?").test("rm")).toBe(false);
    expect(globToRegex("rm ?").test("rm ab")).toBe(false);
  });

  it("[abc] 匹配括号内字符", () => {
    expect(globToRegex("[rc]m").test("rm")).toBe(true);
    expect(globToRegex("[rc]m").test("cm")).toBe(true);
    expect(globToRegex("[rc]m").test("xm")).toBe(false);
  });

  it("[a-z] 匹配范围", () => {
    expect(globToRegex("[a-z]m").test("am")).toBe(true);
    expect(globToRegex("[a-z]m").test("zm")).toBe(true);
    expect(globToRegex("[a-z]m").test("1m")).toBe(false);
  });

  it("[!...] 取反", () => {
    expect(globToRegex("[!0-9]*").test("abc")).toBe(true);
    expect(globToRegex("[!0-9]*").test("123")).toBe(false);
  });

  it("大小写不敏感", () => {
    expect(globToRegex("RM *").test("rm -rf /")).toBe(true);
    expect(globToRegex("rm *").test("RM -rf /")).toBe(true);
  });

  it("特殊字符转义", () => {
    expect(globToRegex("git push*").test("git push origin main")).toBe(true);
    expect(globToRegex("git push*").test("git pull")).toBe(false);
    expect(globToRegex("sudo *").test("sudo rm -rf")).toBe(true);
    expect(globToRegex("sudo *").test("pseudo")).toBe(false);
  });

  it("* 全匹配", () => {
    expect(globToRegex("*").test("anything")).toBe(true);
    expect(globToRegex("*").test("")).toBe(true);
  });
});

// --- extractMatchTarget ---

function makeRequest(
  kind: string | null,
  rawInput: unknown,
  title?: string,
): AcpPermissionRequest {
  return {
    sessionId: "sess-1",
    toolCall: { toolCallId: "tc-1", kind, rawInput, title },
    options: [],
  };
}

describe("extractMatchTarget", () => {
  it("Execute → rawInput.command", () => {
    const req = makeRequest("Execute", { command: "rm -rf /tmp" });
    expect(extractMatchTarget(req, "Execute")).toBe("rm -rf /tmp");
  });

  it("Execute → 空字符串（无 command）", () => {
    const req = makeRequest("Execute", {});
    expect(extractMatchTarget(req, "Execute")).toBe("");
  });

  it("非 Execute → rawInput.tool_name", () => {
    const req = makeRequest("Delete", { tool_name: "file_delete" });
    expect(extractMatchTarget(req, "Delete")).toBe("file_delete");
  });

  it("非 Execute → rawInput.toolName 回退", () => {
    const req = makeRequest("Read", { toolName: "read_file" });
    expect(extractMatchTarget(req, "Read")).toBe("read_file");
  });

  it("非 Execute → title 首词回退", () => {
    const req = makeRequest("Edit", null, "write_file /path/to/file");
    expect(extractMatchTarget(req, "Edit")).toBe("write_file");
  });

  it('非 Execute → "tool" 兜底', () => {
    const req = makeRequest("Other", null);
    expect(extractMatchTarget(req, "Other")).toBe("tool");
  });

  it("bash → rawInput.command", () => {
    const req = makeRequest("bash", { command: "sudo rm -rf /tmp" });
    expect(extractMatchTarget(req, "bash")).toBe("sudo rm -rf /tmp");
  });

  it("bash → rawInput.cmd 回退", () => {
    const req = makeRequest("bash", { cmd: "sudo rm -rf /tmp" });
    expect(extractMatchTarget(req, "bash")).toBe("sudo rm -rf /tmp");
  });
});

describe("isCommandLikeKind", () => {
  it("识别命令类 kind", () => {
    expect(isCommandLikeKind("execute")).toBe(true);
    expect(isCommandLikeKind("bash")).toBe(true);
    expect(isCommandLikeKind("terminal")).toBe(true);
    expect(isCommandLikeKind("Other")).toBe(false);
  });
});

describe("extractMatchTargets", () => {
  it("收集 command、tool_name、title 等多字段", () => {
    const req = makeRequest(
      "other",
      { command: "ls -la", tool_name: "Bash" },
      "Bash run",
    );
    expect(extractMatchTargets(req, "other")).toEqual([
      "ls -la",
      "Bash",
      "Bash run",
    ]);
  });

  it("rawInput 为字符串时纳入 command 候选", () => {
    const req = makeRequest("other", "sudo rm -rf /tmp");
    expect(extractMatchTargets(req, "other")).toEqual(["sudo rm -rf /tmp"]);
  });
});

describe("normalizeToolApprovalRules", () => {
  it("kind 别名映射到 tool_kind", () => {
    expect(
      normalizeToolApprovalRules([
        { patterns: ["*"], action: "ask", kind: "Delete" },
      ]),
    ).toEqual([{ patterns: ["*"], action: "ask", tool_kind: "Delete" }]);
  });

  it("无 tool_kind/kind 时保持全量匹配语义", () => {
    expect(
      normalizeToolApprovalRules([{ patterns: ["sudo *"], action: "ask" }]),
    ).toEqual([{ patterns: ["sudo *"], action: "ask" }]);
  });

  it("tool_kind 优先于 kind 别名", () => {
    expect(
      normalizeToolApprovalRules([
        {
          patterns: ["*"],
          action: "ask",
          tool_kind: "Execute",
          kind: "Other",
        },
      ]),
    ).toEqual([{ patterns: ["*"], action: "ask", tool_kind: "Execute" }]);
  });
});

// --- matchToolApprovalRules ---

describe("matchToolApprovalRules", () => {
  it("无规则时返回 null", () => {
    const req = makeRequest("Execute", { command: "rm -rf /tmp" });
    expect(matchToolApprovalRules(req, [])).toBeNull();
  });

  it("Execute 危险命令命中 ask", () => {
    const req = makeRequest("Execute", { command: "rm -rf /tmp" });
    const rules: ToolApprovalRule[] = [
      { patterns: ["rm -rf *", "sudo *"], action: "ask" },
    ];
    expect(matchToolApprovalRules(req, rules)).toBe("ask");
  });

  it("Execute 安全命令不命中", () => {
    const req = makeRequest("Execute", { command: "ls -la" });
    const rules: ToolApprovalRule[] = [
      { patterns: ["rm -rf *", "sudo *"], action: "ask" },
    ];
    expect(matchToolApprovalRules(req, rules)).toBeNull();
  });

  it("Execute 安全命令命中 allow", () => {
    const req = makeRequest("Execute", { command: "ls -la" });
    const rules: ToolApprovalRule[] = [
      { patterns: ["ls *", "cat *", "grep *"], action: "allow" },
    ];
    expect(matchToolApprovalRules(req, rules)).toBe("allow");
  });

  it("Delete 工具命中 deny", () => {
    const req = makeRequest("Delete", { tool_name: "file_delete" });
    const rules: ToolApprovalRule[] = [
      { patterns: ["*delete*", "*drop*"], action: "deny", tool_kind: "Delete" },
    ];
    expect(matchToolApprovalRules(req, rules)).toBe("deny");
  });

  it("Delete 工具不命中（工具名不含 delete）", () => {
    const req = makeRequest("Delete", { tool_name: "remove_item" });
    const rules: ToolApprovalRule[] = [
      { patterns: ["*delete*"], action: "deny", tool_kind: "Delete" },
    ];
    expect(matchToolApprovalRules(req, rules)).toBeNull();
  });

  it("tool_kind 不匹配时跳过规则", () => {
    // Execute 请求，规则只匹配 Delete
    const req = makeRequest("Execute", { command: "rm -rf /" });
    const rules: ToolApprovalRule[] = [
      { patterns: ["*"], action: "deny", tool_kind: "Delete" },
    ];
    expect(matchToolApprovalRules(req, rules)).toBeNull();
  });

  it("首条命中规则生效（顺序优先）", () => {
    const req = makeRequest("Execute", { command: "sudo rm -rf /" });
    const rules: ToolApprovalRule[] = [
      { patterns: ["sudo *"], action: "deny" },
      { patterns: ["*"], action: "allow" },
    ];
    expect(matchToolApprovalRules(req, rules)).toBe("deny");
  });

  it("patterns 为空数组时该规则不命中", () => {
    const req = makeRequest("Execute", { command: "rm -rf /" });
    const rules: ToolApprovalRule[] = [
      { patterns: [], action: "deny" },
      { patterns: ["*"], action: "allow" },
    ];
    expect(matchToolApprovalRules(req, rules)).toBe("allow");
  });

  it("patterns 中空字符串被忽略", () => {
    const req = makeRequest("Execute", { command: "rm -rf /" });
    const rules: ToolApprovalRule[] = [
      { patterns: ["", "rm *"], action: "ask" },
    ];
    expect(matchToolApprovalRules(req, rules)).toBe("ask");
  });

  it("kind 为 null 时当作 Other 处理", () => {
    const req = makeRequest(null, { tool_name: "any_tool" });
    const rules: ToolApprovalRule[] = [
      { patterns: ["*"], action: "deny", tool_kind: "Other" },
    ];
    expect(matchToolApprovalRules(req, rules)).toBe("deny");
  });

  it("大小写不敏感匹配", () => {
    const req = makeRequest("Execute", { command: "RM -rf /tmp" });
    const rules: ToolApprovalRule[] = [
      { patterns: ["rm -rf *"], action: "ask" },
    ];
    expect(matchToolApprovalRules(req, rules)).toBe("ask");
  });

  it("tool_kind 比较大小写不敏感", () => {
    const req = makeRequest("execute", { command: "rm -rf /tmp" });
    const rules: ToolApprovalRule[] = [
      { patterns: ["rm *"], action: "ask", tool_kind: "Execute" },
    ];
    expect(matchToolApprovalRules(req, rules)).toBe("ask");
  });

  it("* 全匹配 Delete 工具", () => {
    const req = makeRequest("Delete", { tool_name: "any_delete_tool" });
    const rules: ToolApprovalRule[] = [
      { patterns: ["*"], action: "deny", tool_kind: "Delete" },
    ];
    expect(matchToolApprovalRules(req, rules)).toBe("deny");
  });

  it("无 tool_kind 时 Other/MCP 工具名命中", () => {
    const req = makeRequest("other", { tool_name: "Bash" }, "Bash");
    const rules: ToolApprovalRule[] = [{ patterns: ["Bash*"], action: "ask" }];
    expect(matchToolApprovalRules(req, rules)).toBe("ask");
  });

  it("无 tool_kind 时 bash 命令命中", () => {
    const req = makeRequest("bash", { command: "sudo rm -rf /tmp" });
    const rules: ToolApprovalRule[] = [
      { patterns: ["sudo *"], action: "deny" },
    ];
    expect(matchToolApprovalRules(req, rules)).toBe("deny");
  });

  it("无 tool_kind 时 other + 字符串 rawInput 命令命中", () => {
    const req = makeRequest("other", "sudo rm -rf /tmp");
    const rules: ToolApprovalRule[] = [
      { patterns: ["sudo *"], action: "deny" },
    ];
    expect(matchToolApprovalRules(req, rules)).toBe("deny");
  });

  it("显式 tool_kind Execute 时不匹配 other", () => {
    const req = makeRequest("other", { tool_name: "Bash" }, "Bash");
    const rules: ToolApprovalRule[] = [
      { patterns: ["Bash*"], action: "deny", tool_kind: "Execute" },
    ];
    expect(matchToolApprovalRules(req, rules)).toBeNull();
  });

  it("显式 tool_kind Other 仅匹配 other 类", () => {
    const req = makeRequest("other", { tool_name: "mcp_tool" });
    const rules: ToolApprovalRule[] = [
      { patterns: ["mcp_*"], action: "ask", tool_kind: "Other" },
    ];
    expect(matchToolApprovalRules(req, rules)).toBe("ask");

    const executeReq = makeRequest("execute", { command: "mcp_tool run" });
    expect(matchToolApprovalRules(executeReq, rules)).toBeNull();
  });
});
