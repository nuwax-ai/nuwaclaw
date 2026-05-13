/**
 * 构造 ACP Permission Intervention Request
 *
 * 将 ACP 官方 RequestPermissionRequest 包装成跨端 intervention envelope。
 * Host 不生成 InteractionUISchema，只透传 ACP 官方 request。
 */

import { randomUUID } from "crypto";
import type { AcpPermissionRequest } from "../engines/acp/acpClient";
import type { AcpPermissionInterventionRequest } from "@shared/types/intervention";
import { getDeviceId } from "../system/deviceId";

function createOpaqueInterventionId(): string {
  // opaque id，不让外部可从中推断 ACP session/tool call
  return `itv_${randomUUID().replace(/-/g, "")}`;
}

export function buildAcpPermissionInterventionRequest(args: {
  engine: string;
  appSessionId: string;
  acpRequest: AcpPermissionRequest;
  timeoutMs?: number;
}): AcpPermissionInterventionRequest {
  return {
    id: createOpaqueInterventionId(),
    revision: 1,
    kind: "approval",
    status: "pending",
    sessionId: args.appSessionId,
    source: "acp_permission",
    engine: args.engine,
    protocol: "acp",
    callbackTarget: {
      kind: "electron",
      targetId: getDeviceId(),
    },
    schemaRef:
      "https://github.com/agentclientprotocol/agent-client-protocol/blob/main/schema/schema.json",
    acp: {
      method: "session/request_permission",
      request: args.acpRequest,
    },
    timeoutMs: args.timeoutMs ?? 120_000,
    createdAt: Date.now(),
  };
}
