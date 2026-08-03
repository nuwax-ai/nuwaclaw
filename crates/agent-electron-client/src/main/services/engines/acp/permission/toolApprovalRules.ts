/**
 * nuwaclaw adapter for agent-kit's tool_approval_rules matcher.
 *
 * Matching, normalization and glob semantics are shared. This file only
 * bridges nuwaclaw's extensible AcpPermissionRequest.toolCall.kind string to
 * the narrower ACP SDK 0.26 type exposed by agent-kit 0.2.0.
 */

import type { AcpPermissionRequest } from "../acpClient";
import type {
  ToolApprovalAction,
  ToolApprovalRule,
} from "@shared/types/computerTypes";
import {
  extractMatchTarget as extractSharedMatchTarget,
  extractMatchTargets as extractSharedMatchTargets,
  extractToolNameValues as extractSharedToolNameValues,
  matchToolApprovalRules as matchSharedToolApprovalRules,
} from "@nuwax-ai/agent-kit";

export {
  extractCommandValues,
  globToRegex,
  isCommandLikeKind,
  normalizeRuleToolKind,
  normalizeToolApprovalRules,
} from "@nuwax-ai/agent-kit";
export type { ToolApprovalAction };

type SharedPermissionRequest = Parameters<
  typeof matchSharedToolApprovalRules
>[0];

function asSharedRequest(
  request: AcpPermissionRequest,
): SharedPermissionRequest {
  // Both contracts have the same wire fields. nuwaclaw deliberately permits
  // engine-specific string kinds beyond the SDK enum; the matcher treats kind
  // as a case-insensitive string and does not depend on the enum.
  return request as unknown as SharedPermissionRequest;
}

export function extractToolNameValues(
  request: AcpPermissionRequest,
  rawInput?: unknown,
): string[] {
  return extractSharedToolNameValues(asSharedRequest(request), rawInput);
}

export function extractMatchTargets(
  request: AcpPermissionRequest,
  toolCallKind?: string,
): string[] {
  return extractSharedMatchTargets(asSharedRequest(request), toolCallKind);
}

export function extractMatchTarget(
  request: AcpPermissionRequest,
  toolKind: string,
): string {
  return extractSharedMatchTarget(asSharedRequest(request), toolKind);
}

export function matchToolApprovalRules(
  request: AcpPermissionRequest,
  rules: ToolApprovalRule[],
): ToolApprovalAction | null {
  return matchSharedToolApprovalRules(asSharedRequest(request), rules);
}
