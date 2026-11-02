import { describe, it, expect } from "vitest";
import {
  buildOpencodePermissionWithAskBridge,
  computeOpencodePermissionBridgeKey,
  mergeAskToolApprovalRulesIntoOpencodePermission,
} from "./opencodePermissionBridge";
import { DEFAULT_OPENCODE_ACP_PERMISSION } from "../sandbox/opencodeAcpSpawnConfig";

describe("opencodePermissionBridge", () => {
  it("computeOpencodePermissionBridgeKey 仅包含 ask 规则且稳定排序", () => {
    const key = computeOpencodePermissionBridgeKey([
      { patterns: ["*b"], action: "deny" },
      { patterns: ["*get_stock_data"], action: "ask" },
      { patterns: ["*a"], action: "ask", tool_kind: "execute" },
    ]);
    expect(key).toBe(
      JSON.stringify([
        { tool_kind: "", pattern: "*get_stock_data" },
        { tool_kind: "execute", pattern: "*a" },
      ]),
    );
  });

  it("未设 tool_kind 时将 pattern 注入为 OpenCode permission 键", () => {
    const merged = mergeAskToolApprovalRulesIntoOpencodePermission(
      { ...DEFAULT_OPENCODE_ACP_PERMISSION },
      [{ patterns: ["*get_stock_data", "mcp__*"], action: "ask" }],
    );
    expect(merged["*get_stock_data"]).toBe("ask");
    expect(merged["mcp__*"]).toBe("ask");
    expect(merged.bash).toBe("ask");
  });

  it("命令类 tool_kind 合并进 bash 子规则", () => {
    const merged = mergeAskToolApprovalRulesIntoOpencodePermission(
      { bash: "allow" },
      [{ patterns: ["rm *"], action: "ask", tool_kind: "execute" }],
    );
    expect(merged.bash).toEqual({ "*": "allow", "rm *": "ask" });
  });

  it("buildOpencodePermissionWithAskBridge 支持 kind 别名", () => {
    const merged = buildOpencodePermissionWithAskBridge(
      { ...DEFAULT_OPENCODE_ACP_PERMISSION },
      [{ patterns: ["*foo"], action: "ask", kind: "Other" }],
    );
    expect(merged["*foo"]).toBe("ask");
  });
});
