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
  ToolApprovalRuleInput,
  ToolApprovalAction,
} from "@shared/types/computerTypes";

export type { ToolApprovalAction };

const COMMAND_LIKE_KINDS = new Set([
  "execute",
  "bash",
  "terminal",
  "shell",
  "command",
]);

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

function getRawInput(
  request: AcpPermissionRequest,
): Record<string, unknown> | null | undefined {
  return request.toolCall.rawInput as
    | Record<string, unknown>
    | null
    | undefined;
}

/** 从 rawInput 提取命令文本（对齐 computerPermissionProtocol.extractCommand） */
function extractCommandValue(rawInput: unknown): string | undefined {
  if (typeof rawInput === "string") {
    const command = rawInput.trim();
    return command || undefined;
  }
  if (!rawInput || typeof rawInput !== "object") return undefined;

  const record = rawInput as Record<string, unknown>;
  for (const key of ["command", "cmd", "script"]) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

/** execute / bash / terminal / shell / command 视为命令类 kind */
export function isCommandLikeKind(kind: string): boolean {
  return COMMAND_LIKE_KINDS.has(kind.toLowerCase());
}

/** tool_kind 缺失或空白 → null（匹配全部 kind）；否则返回 trim 后的值 */
export function normalizeRuleToolKind(rule: ToolApprovalRule): string | null {
  const kind = rule.tool_kind?.trim();
  return kind ? kind : null;
}

/** 规范化入参规则：kind 别名映射到 tool_kind */
export function normalizeToolApprovalRules(
  rules: ToolApprovalRuleInput[] | undefined,
): ToolApprovalRule[] | undefined {
  if (!rules?.length) return undefined;
  return rules.map((rule) => {
    const toolKind = rule.tool_kind?.trim() || rule.kind?.trim() || undefined;
    return {
      patterns: rule.patterns,
      action: rule.action,
      ...(toolKind ? { tool_kind: toolKind } : {}),
    };
  });
}

/**
 * 全量匹配时从权限请求提取多个候选目标（去重）：
 * command → tool_name/toolName → title → title 首词
 */
export function extractMatchTargets(
  request: AcpPermissionRequest,
  _toolCallKind: string,
): string[] {
  const rawInput = getRawInput(request);
  const targets: string[] = [];

  const command = extractCommandValue(rawInput ?? request.toolCall.rawInput);
  if (command) {
    targets.push(command);
  }

  const toolName = (rawInput?.tool_name ?? rawInput?.toolName) as
    | string
    | undefined;
  if (typeof toolName === "string" && toolName) {
    targets.push(toolName);
  }

  const title = request.toolCall.title?.trim();
  if (title) {
    targets.push(title);
    const word = firstWord(title);
    if (word) {
      targets.push(word);
    }
  }

  return [...new Set(targets)];
}

/**
 * 根据 tool_kind 从权限请求中提取单个匹配目标（显式 tool_kind 规则使用）：
 * - 命令类 kind → rawInput.command
 * - 其他 → rawInput.tool_name / rawInput.toolName / title 首词（工具名称）
 */
export function extractMatchTarget(
  request: AcpPermissionRequest,
  toolKind: string,
): string {
  const rawInput = getRawInput(request);
  if (isCommandLikeKind(toolKind)) {
    return extractCommandValue(rawInput ?? request.toolCall.rawInput) ?? "";
  }
  return (
    (rawInput?.tool_name as string) ??
    (rawInput?.toolName as string) ??
    firstWord(request.toolCall.title) ??
    "tool"
  );
}

function patternMatchesAnyTarget(pattern: string, targets: string[]): boolean {
  if (!pattern) return false;
  try {
    const regex = globToRegex(pattern);
    return targets.some((target) => regex.test(target));
  } catch {
    // 无效通配符语法，跳过此 pattern
    return false;
  }
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
    const ruleToolKind = normalizeRuleToolKind(rule);
    if (ruleToolKind !== null && toolCallKind !== ruleToolKind.toLowerCase()) {
      continue;
    }
    if (rule.patterns.length === 0) continue;

    const targets =
      ruleToolKind === null
        ? extractMatchTargets(request, toolCallKind)
        : [extractMatchTarget(request, ruleToolKind)];

    for (const pattern of rule.patterns) {
      if (patternMatchesAnyTarget(pattern, targets)) {
        return rule.action;
      }
    }
  }

  return null;
}
