// @nuwax-ai/agent-kit — permission decision-chain runner.
//
// Both hosts' coordinators are an ordered list of decision stages where the
// first terminal stage wins. agent-kit provides the runner + stage type; each
// host composes its own chain from the shared stage primitives (classifier,
// allow_always cache, mode policy, tool_approval_rules, question-deny, …) plus
// any product-specific stage (e.g. nuwaclaw's strict write guard, which takes
// sandbox paths the host injects via ctx).
//
// The ctx shape is host-specific and unconstrained — each host defines its own
// context type and passes it through.

import type { RequestPermissionRequest } from "@agentclientprotocol/sdk";
import type { PermissionDecision } from "./types.js";

/**
 * 决策阶段。返回 PermissionDecision 即终结链；返回 null 表示「我不决定，交给下一阶段」。
 * 泛型 C 是宿主自定义的决策上下文（mode / appSessionId / strict 沙箱路径 / 规则 …）。
 */
export type PermissionStage<C> = (
  request: RequestPermissionRequest,
  ctx: C,
) => PermissionDecision | null;

/**
 * 按顺序跑阶段，首个非 null 决策胜出。全部 pass（说明链缺终态阶段，不推荐）
 * 则安全兜底为 ask（升级人工）。
 */
export function runDecisionChain<C>(
  stages: PermissionStage<C>[],
  request: RequestPermissionRequest,
  ctx: C,
): PermissionDecision {
  for (const stage of stages) {
    const decision = stage(request, ctx);
    if (decision) return decision;
  }
  return { kind: "ask", reason: "no_stage_decided" };
}
