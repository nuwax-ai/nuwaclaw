// @nuwax-ai/agent-kit — tool_approval_rules matching engine.
//
// Ported from nuwaclaw (crates/agent-electron-client/.../permission/toolApprovalRules.ts),
// aligned to rcoder tool-approval-rules-spec. Pure functions, no side effects.
//
// Decision-chain role (client side, spec §7): this is ONE stage — match the
// request against per-session tool_approval_rules and return the first hit's
// action (allow/deny/ask), or null (caller falls back to agent_mode default).
// Dangerous-command handling is NOT here (rcoder logs a warn; client doesn't).

import type { RequestPermissionRequest } from "@agentclientprotocol/sdk";

/** 规则命中后的动作。 */
export type ToolApprovalAction = "allow" | "deny" | "ask";

/** 规范化后的规则。tool_kind 缺失/空白 → 匹配全部 kind。 */
export interface ToolApprovalRule {
  patterns: string[];
  action: ToolApprovalAction;
  tool_kind?: string;
}

/** 宿主传入的规则（允许 kind 别名，normalizeToolApprovalRules 映射到 tool_kind）。 */
export interface ToolApprovalRuleInput {
  patterns: string[];
  action: ToolApprovalAction;
  tool_kind?: string;
  /** legacy 别名，等价于 tool_kind。 */
  kind?: string;
}

const COMMAND_LIKE_KINDS = new Set([
  "execute",
  "bash",
  "terminal",
  "shell",
  "command",
]);

/** raw_input 中视为「命令内容」的字段（按优先级）。 */
const COMMAND_KEYS = ["command", "cmd", "script"] as const;
/** raw_input 中视为「工具名」的字段（按优先级）；`tool` 为 nuwaxcode MCP 实际 key。 */
const TOOL_NAME_KEYS = ["tool", "tool_name", "toolName"] as const;

/**
 * 将 glob 通配符模式转换为大小写不敏感的正则表达式。
 * 支持 * ? [abc] [a-z] [!abc]；不支持 {a,b} brace、** 目录语义。
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
      let j = i + 1;
      if (j < pattern.length && pattern[j] === "!") j++;
      if (j < pattern.length && pattern[j] === "]") j++;
      while (j < pattern.length && pattern[j] !== "]") j++;
      if (j < pattern.length) {
        let bracketContent = pattern.slice(i + 1, j);
        if (bracketContent.startsWith("!")) {
          bracketContent = "^" + bracketContent.slice(1);
        }
        regexStr += "[" + bracketContent + "]";
        i = j + 1;
      } else {
        regexStr += "\\[";
        i++;
      }
    } else {
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

function pushNonempty(values: string[], s: string): void {
  const trimmed = s.trim();
  if (trimmed) values.push(trimmed);
}

function dedupPreserveOrder(values: string[]): string[] {
  const seen = new Set<string>();
  return values.filter((s) => {
    if (seen.has(s)) return false;
    seen.add(s);
    return true;
  });
}

function getRawInputValue(request: RequestPermissionRequest): unknown {
  return request.toolCall.rawInput;
}

/**
 * 收集 raw_input 中所有命令类字段值：command/cmd/script + 字符串 rawInput。
 * 对齐 spec §3 / rcoder extract_command_values。
 */
export function extractCommandValues(rawInput: unknown): string[] {
  const values: string[] = [];
  if (typeof rawInput === "string") {
    pushNonempty(values, rawInput);
    return values;
  }
  if (!rawInput || typeof rawInput !== "object") return values;

  const record = rawInput as Record<string, unknown>;
  for (const key of COMMAND_KEYS) {
    const value = record[key];
    if (typeof value === "string") {
      pushNonempty(values, value);
    }
  }
  return values;
}

/**
 * 收集工具名字段：tool/tool_name/toolName + title 首词。
 * 对齐 spec §3 / rcoder extract_tool_name_values。
 */
export function extractToolNameValues(
  request: RequestPermissionRequest,
  rawInput?: unknown,
): string[] {
  const values: string[] = [];
  const input = rawInput ?? getRawInputValue(request);

  if (input && typeof input === "object") {
    const record = input as Record<string, unknown>;
    for (const key of TOOL_NAME_KEYS) {
      const value = record[key];
      if (typeof value === "string") {
        pushNonempty(values, value);
      }
    }
  }

  const word = firstWord(request.toolCall.title);
  if (word) values.push(word);

  return values;
}

/** execute / bash / terminal / shell / command 视为命令类 kind。 */
export function isCommandLikeKind(kind: string): boolean {
  return COMMAND_LIKE_KINDS.has(kind.toLowerCase());
}

/** tool_kind 缺失或空白 → null（匹配全部 kind）；否则返回 trim 后的值。 */
export function normalizeRuleToolKind(rule: ToolApprovalRule): string | null {
  const kind = rule.tool_kind?.trim();
  return kind ? kind : null;
}

/** 规范化入参规则：kind 别名映射到 tool_kind。 */
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
 * 通用规则（tool_kind=None）的多字段目标：command 族 + tool_name 族 + title 完整。
 * 对齐 spec §3 / rcoder extract_all_targets。
 */
export function extractMatchTargets(
  request: RequestPermissionRequest,
  _toolCallKind?: string,
): string[] {
  const rawInput = getRawInputValue(request);
  const targets: string[] = [
    ...extractCommandValues(rawInput),
    ...extractToolNameValues(request, rawInput),
  ];

  const title = request.toolCall.title?.trim();
  if (title) targets.push(title);

  return dedupPreserveOrder(targets);
}

/**
 * 显式 tool_kind 的单字段目标：
 * - 命令类 kind → command 族首个非空
 * - 其他 → tool_name 族首个非空，兜底 "tool"
 */
export function extractMatchTarget(
  request: RequestPermissionRequest,
  toolKind: string,
): string {
  const rawInput = getRawInputValue(request);
  if (isCommandLikeKind(toolKind)) {
    return extractCommandValues(rawInput).find(Boolean) ?? "";
  }
  return extractToolNameValues(request, rawInput).find(Boolean) ?? "tool";
}

function patternMatchesAnyTarget(pattern: string, targets: string[]): boolean {
  if (!pattern) return false;
  try {
    const regex = globToRegex(pattern);
    return targets.some((target) => regex.test(target));
  } catch {
    return false;
  }
}

/**
 * 按数组顺序匹配 tool_approval_rules，返回首条命中规则的 action。
 * 无命中返回 null，调用方回退到 agent_mode 默认行为。
 */
export function matchToolApprovalRules(
  request: RequestPermissionRequest,
  rules: ToolApprovalRule[],
): ToolApprovalAction | null {
  const toolCallKind = (request.toolCall.kind ?? "Other").toLowerCase();

  for (const rule of rules) {
    const ruleToolKind = normalizeRuleToolKind(rule);
    if (ruleToolKind !== null && toolCallKind !== ruleToolKind.toLowerCase()) {
      continue;
    }
    if (rule.patterns.length === 0) continue;

    const targets = (
      ruleToolKind === null
        ? extractMatchTargets(request)
        : [extractMatchTarget(request, ruleToolKind)]
    ).filter((t) => t.length > 0);
    if (targets.length === 0) continue;

    for (const pattern of rule.patterns) {
      const pat = pattern.trim();
      if (!pat) continue;
      if (patternMatchesAnyTarget(pat, targets)) {
        return rule.action;
      }
    }
  }

  return null;
}
