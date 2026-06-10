/**
 * tool_approval_rules 匹配逻辑
 *
 * 纯函数模块，无副作用，便于单测。
 *
 * 决策优先级（调用方负责按顺序调用）：
 * ① RuleStore（已保存的历史审批规则，ACP 协议层处理）
 * ② matchToolApprovalRules（本模块）
 * ③ agent_mode 默认行为（调用方处理）
 */

import type { AcpPermissionRequest } from "../acpClient";
import type {
  ToolApprovalRule,
  ToolApprovalAction,
} from "@shared/types/computerTypes";

export type { ToolApprovalAction };

/**
 * 将 glob 通配符模式转换为大小写不敏感的正则表达式。
 * 支持 * ? [abc] [a-z] [!abc] 语法。
 */
export function globToRegex(pattern: string): RegExp {
  let regexStr = "^";
  let i = 0;
  while (i < pattern.length) {
    const ch = pattern[i];
    if (ch === "*") {
      regexStr += ".*";
      i++;
    } else if (ch === "?") {
      regexStr += ".";
      i++;
    } else if (ch === "[") {
      // 找到匹配的 ]，处理 [!abc] → [^abc]
      let j = i + 1;
      if (j < pattern.length && pattern[j] === "!") j++;
      if (j < pattern.length && pattern[j] === "]") j++; // ] 作为字面量在首位
      while (j < pattern.length && pattern[j] !== "]") j++;
      if (j < pattern.length) {
        let bracketContent = pattern.slice(i + 1, j);
        if (bracketContent.startsWith("!")) {
          bracketContent = "^" + bracketContent.slice(1);
        }
        regexStr += "[" + bracketContent + "]";
        i = j + 1;
      } else {
        // 没有匹配的 ]，当作字面量
        regexStr += "\\[";
        i++;
      }
    } else {
      // 转义 regex 特殊字符（. + ^ $ { } ( ) | \），* ? [ ] 已在上面处理
      regexStr += /[.+^${}()|\\]/.test(ch) ? "\\" + ch : ch;
      i++;
    }
  }
  regexStr += "$";
  return new RegExp(regexStr, "i");
}

function firstWord(title: string | null | undefined): string | undefined {
  const trimmed = title?.trim();
  if (!trimmed) return undefined;
  return trimmed.split(/\s+/)[0];
}

/**
 * 根据 tool_kind 从权限请求中提取匹配目标：
 * - Execute → rawInput.command（命令内容）
 * - 其他 → rawInput.tool_name / rawInput.toolName / title 首词（工具名称）
 */
export function extractMatchTarget(
  request: AcpPermissionRequest,
  toolKind: string,
): string {
  const rawInput = request.toolCall.rawInput as
    | Record<string, unknown>
    | null
    | undefined;
  if (toolKind.toLowerCase() === "execute") {
    return (rawInput?.command as string) ?? "";
  }
  return (
    (rawInput?.tool_name as string) ??
    (rawInput?.toolName as string) ??
    firstWord(request.toolCall.title) ??
    "tool"
  );
}

/**
 * 按数组顺序匹配 tool_approval_rules，返回首条命中规则的 action。
 * 无命中返回 null，调用方回退到 agent_mode 默认行为。
 */
export function matchToolApprovalRules(
  request: AcpPermissionRequest,
  rules: ToolApprovalRule[],
): ToolApprovalAction | null {
  // kind 缺失时当作 "Other" 处理
  const toolCallKind = (request.toolCall.kind ?? "Other").toLowerCase();

  for (const rule of rules) {
    const ruleToolKind = (rule.tool_kind ?? "Execute").toLowerCase();
    if (toolCallKind !== ruleToolKind) continue;
    if (rule.patterns.length === 0) continue;

    const target = extractMatchTarget(request, ruleToolKind);

    for (const pattern of rule.patterns) {
      if (!pattern) continue; // 忽略空字符串
      try {
        if (globToRegex(pattern).test(target)) {
          return rule.action;
        }
      } catch {
        // 无效通配符语法，跳过此 pattern
      }
    }
  }

  return null;
}
