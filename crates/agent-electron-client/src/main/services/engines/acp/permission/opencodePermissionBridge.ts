/**
 * 将 tool_approval_rules 中 action:"ask" 的 patterns 桥接到 OpenCode permission 配置，
 * 使 nuwaxcode 在引擎层发出 permission.asked → ACP requestPermission，
 * 再由 Electron client 的 tool_approval_rules 做最终决策。
 *
 * MCP 工具默认 ask 由 nuwaxcode agent 默认权限兜底（>= v1.3.0-beta.10）。
 * 旧版引擎临时测试可在 chat 请求传入 agent_server.env.OPENCODE_PERMISSION。
 */

import type {
  ToolApprovalRule,
  ToolApprovalRuleInput,
} from "@shared/types/computerTypes";
import {
  isCommandLikeKind,
  normalizeToolApprovalRules,
} from "./toolApprovalRules";

export type OpencodePermissionValue = string | Record<string, string>;

export type OpencodePermissionConfig = Record<string, OpencodePermissionValue>;

type AskBridgeEntry = {
  tool_kind: string;
  pattern: string;
};

/**
 * 用于判断是否需要 reinit nuwaxcode 进程（OPENCODE_CONFIG_CONTENT 仅在 spawn 时读取）。
 */
export function computeOpencodePermissionBridgeKey(
  rules: ToolApprovalRuleInput[] | undefined,
): string {
  const normalized = normalizeToolApprovalRules(rules);
  if (!normalized?.length) return "";

  const entries: AskBridgeEntry[] = [];
  for (const rule of normalized) {
    if (rule.action !== "ask") continue;
    const toolKind = rule.tool_kind?.trim() ?? "";
    for (const pattern of rule.patterns) {
      const trimmed = pattern?.trim();
      if (!trimmed) continue;
      entries.push({ tool_kind: toolKind, pattern: trimmed });
    }
  }

  entries.sort((a, b) => {
    const kindCmp = a.tool_kind.localeCompare(b.tool_kind);
    if (kindCmp !== 0) return kindCmp;
    return a.pattern.localeCompare(b.pattern);
  });

  return entries.length > 0 ? JSON.stringify(entries) : "";
}

function ensureNestedPermission(
  permission: OpencodePermissionConfig,
  key: string,
): Record<string, string> {
  const existing = permission[key];
  if (typeof existing === "object" && existing !== null) {
    return { ...existing };
  }
  if (typeof existing === "string") {
    return { "*": existing };
  }
  return {};
}

/**
 * 把 ask 规则合并进 OpenCode permission（不修改 deny/allow 规则）。
 * - 未设 tool_kind：pattern 作为 permission 键（适配 MCP 工具名，支持 glob）
 * - 命令类 tool_kind：合并进 bash 子规则
 * - edit：合并进 edit 子规则
 * - 其他显式 tool_kind：pattern 作为 permission 键
 */
export function mergeAskToolApprovalRulesIntoOpencodePermission(
  basePermission: OpencodePermissionConfig,
  rules: ToolApprovalRule[] | undefined,
): OpencodePermissionConfig {
  if (!rules?.length) {
    return { ...basePermission };
  }

  const merged: OpencodePermissionConfig = { ...basePermission };
  const bashPatterns: Record<string, string> = {};
  const editPatterns: Record<string, string> = {};

  for (const rule of rules) {
    if (rule.action !== "ask") continue;

    const toolKind = rule.tool_kind?.trim();
    const normalizedKind = toolKind?.toLowerCase();

    if (!toolKind) {
      for (const pattern of rule.patterns) {
        const trimmed = pattern?.trim();
        if (trimmed) merged[trimmed] = "ask";
      }
      continue;
    }

    if (isCommandLikeKind(toolKind)) {
      for (const pattern of rule.patterns) {
        const trimmed = pattern?.trim();
        if (trimmed) bashPatterns[trimmed] = "ask";
      }
      continue;
    }

    if (normalizedKind === "edit") {
      for (const pattern of rule.patterns) {
        const trimmed = pattern?.trim();
        if (trimmed) editPatterns[trimmed] = "ask";
      }
      continue;
    }

    for (const pattern of rule.patterns) {
      const trimmed = pattern?.trim();
      if (trimmed) merged[trimmed] = "ask";
    }
  }

  if (Object.keys(bashPatterns).length > 0) {
    merged.bash = {
      ...ensureNestedPermission(merged, "bash"),
      ...bashPatterns,
    };
  }
  if (Object.keys(editPatterns).length > 0) {
    merged.edit = {
      ...ensureNestedPermission(merged, "edit"),
      ...editPatterns,
    };
  }

  return merged;
}

export function buildOpencodePermissionWithAskBridge(
  basePermission: OpencodePermissionConfig,
  rules: ToolApprovalRuleInput[] | undefined,
): OpencodePermissionConfig {
  const normalized = normalizeToolApprovalRules(rules);
  return mergeAskToolApprovalRulesIntoOpencodePermission(
    basePermission,
    normalized,
  );
}
