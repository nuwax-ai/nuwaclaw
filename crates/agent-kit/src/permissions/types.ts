// @nuwax-ai/agent-kit — ACP permission decision primitives.
//
// Shared by nuwa-cli and nuwaclaw. The two hosts run DIFFERENT decision chains
// (nuwa-cli: sensitive-classifier + allow_always cache + approve policy;
// nuwaclaw: question-deny + strict write guard + tool_approval_rules + agent_mode),
// so agent-kit does NOT ship a coordinator class — it ships the building blocks
// (option pickers, classifier framework, the chain runner) each host assembles.
// See ./chain.ts (runDecisionChain), ./classifiers.ts, ./toolApprovalRules.ts.

import type {
  RequestPermissionRequest,
  RequestPermissionResponse,
} from "@agentclientprotocol/sdk";

/** 权限策略模式（nuwa-cli --approve/--yolo；nuwaclaw 用 AcpMode 自行映射到此处）。 */
export type ApprovePolicyMode = "yolo" | "ask" | "deny";

/** 决策链的产出。ask 由调用方挂起走人工审批（见 ./pending.ts）。 */
export type PermissionDecision =
  | { kind: "select"; optionId: string; reason: string }
  | { kind: "cancel"; reason: string }
  | { kind: "ask"; reason: string; classifierId?: string };

/** 在 request.options 里找第一个 kind 命中的选项。 */
export function firstOptionOfKind(
  request: RequestPermissionRequest,
  kinds: string[],
): { optionId: string } | undefined {
  for (const kind of kinds) {
    const found = request.options.find((option) => option.kind === kind);
    if (found) return { optionId: found.optionId };
  }
  return undefined;
}

/** 选 allow_always / allow_once（缺则 cancel）。 */
export function pickAllow(
  request: RequestPermissionRequest,
): PermissionDecision {
  const option = firstOptionOfKind(request, ["allow_always", "allow_once"]);
  if (!option) return { kind: "cancel", reason: "no_allow_option" };
  return { kind: "select", optionId: option.optionId, reason: "auto_allow" };
}

/** 选 reject_once / reject_always（缺则 cancel）。 */
export function pickReject(
  request: RequestPermissionRequest,
): PermissionDecision {
  const option = firstOptionOfKind(request, ["reject_once", "reject_always"]);
  if (!option) return { kind: "cancel", reason: "no_reject_option" };
  return { kind: "select", optionId: option.optionId, reason: "auto_deny" };
}

/**
 * 把非-ask 决策落成 ACP Response。ask 返回 null（调用方挂起，走 pending 审批）。
 */
export function decisionToResponse(
  decision: PermissionDecision,
): RequestPermissionResponse | null {
  if (decision.kind === "ask") return null;
  if (decision.kind === "cancel") return { outcome: { outcome: "cancelled" } };
  return { outcome: { outcome: "selected", optionId: decision.optionId } };
}
