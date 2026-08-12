/**
 * Approval Intervention Service
 *
 * agent-kit owns the pending state machine (dual indexes, duplicate
 * supersession, timeout, option validation and cancellation). nuwaclaw keeps
 * its intervention envelope, revision policy, HTTP error mapping, logs and
 * EventEmitter contract at this boundary.
 */

import { EventEmitter } from "events";
import log from "electron-log/main";
import {
  createPendingService,
  type PendingServiceHandle,
  type ResolveResult,
} from "@nuwax-ai/agent-kit";
import type {
  NotifyResolvedRequest,
  NotifyResolvedResponse,
  AcpPermissionResponse,
  ComputerNotifyResolvedRequest,
} from "@shared/types/intervention";
import type { AcpPermissionRequest } from "../engines/acp/acpClient";
import { buildAcpPermissionInterventionRequest } from "./buildAcpPermissionInterventionRequest";
import { parseComputerPermissionResolveRequest } from "./computerPermissionProtocol";

type SharedRequest = Parameters<
  PendingServiceHandle["createPending"]
>[0]["request"];
type SharedResponse = Parameters<
  PendingServiceHandle["resolveByInterventionId"]
>[1];

export class ApprovalInterventionService extends EventEmitter {
  private readonly resolutionReasons = new Map<string, string>();
  private suppressResolvedEvents = false;

  private readonly pendingService = createPendingService({
    defaultTimeoutMs: 0,
    // Preserve nuwaclaw's existing immediate-delete behavior. Cloud retries
    // after completion receive gone rather than agent-kit's optional cache.
    retentionMs: 0,
    onResolved: ({ interventionId, response, reason }) => {
      const hostReason = this.resolutionReasons.get(interventionId) ?? reason;
      log.info(
        `[Intervention] Resolved: id=${interventionId} reason=${hostReason} outcome=${response.outcome.outcome}`,
      );
      if (!this.suppressResolvedEvents) {
        this.emit("resolved", {
          interventionId,
          reason: hostReason,
          response: response as AcpPermissionResponse,
        });
      }
    },
  });

  createPending(args: {
    engine: string;
    appSessionId: string;
    acpSessionId: string;
    acpRequest: AcpPermissionRequest;
    timeoutMs?: number;
  }): {
    interventionRequest: ReturnType<
      typeof buildAcpPermissionInterventionRequest
    >;
    acpResponsePromise: Promise<AcpPermissionResponse>;
  } {
    const { engine, appSessionId, acpSessionId, acpRequest, timeoutMs } = args;
    const interventionRequest = buildAcpPermissionInterventionRequest({
      engine,
      appSessionId,
      acpRequest,
      timeoutMs,
    });

    const created = this.pendingService.createPending({
      interventionId: interventionRequest.id,
      revision: interventionRequest.revision,
      appSessionId,
      acpSessionId,
      request: acpRequest as unknown as SharedRequest,
      timeoutMs,
    });

    log.info(
      `[Intervention] Pending created: id=${interventionRequest.id} session=${appSessionId} acpSession=${acpSessionId} toolCall=${acpRequest.toolCall.toolCallId}`,
    );

    return {
      interventionRequest,
      acpResponsePromise: created.promise as Promise<AcpPermissionResponse>,
    };
  }

  resolveFromCallback(payload: NotifyResolvedRequest): NotifyResolvedResponse {
    const pending = this.pendingService.getPendingByInterventionId(
      payload.interventionId,
    );
    if (!pending) {
      return this.notFound("not_found");
    }
    if (pending.revision !== payload.revision) {
      return {
        ok: false,
        hostStatus: "superseded",
        error: { code: "revision_mismatch", message: "revision mismatch" },
      };
    }

    return this.mapResolveResult(
      this.resolveByInterventionId(
        payload.interventionId,
        payload.acpResponse,
        "callback",
      ),
      "callback",
    );
  }

  resolveFromComputerPermissionCallback(
    payload: ComputerNotifyResolvedRequest,
  ): NotifyResolvedResponse {
    const parsed = parseComputerPermissionResolveRequest(payload);
    if (!parsed.ok) return parsed.response;

    const { acpSessionId, toolCallId, acpResponse } = parsed.command;
    const pending = this.pendingService.getPendingBySessionTool(
      acpSessionId,
      toolCallId,
    );
    if (!pending) return this.notFound("ERR_PERMISSION_NOT_FOUND");

    return this.mapResolveResult(
      this.resolveByInterventionId(
        pending.interventionId,
        acpResponse,
        "computer_permission_callback",
      ),
      "computer_permission_callback",
    );
  }

  hasPendingForAcpSession(acpSessionId: string): boolean {
    return this.pendingService.hasPendingForAcpSession(acpSessionId);
  }

  cancelByAcpSession(acpSessionId: string, reason = "session_cancel"): void {
    this.pendingService.cancelByAcpSession(acpSessionId, reason);
  }

  cancelByAppSession(appSessionId: string): void {
    this.pendingService.cancelByAppSession(appSessionId, "session_cancel");
  }

  destroy(): void {
    this.suppressResolvedEvents = true;
    try {
      this.pendingService.cancelAll();
    } finally {
      this.suppressResolvedEvents = false;
      this.resolutionReasons.clear();
    }
  }

  get pendingCount(): number {
    return this.pendingService.pendingCount;
  }

  private resolveByInterventionId(
    interventionId: string,
    response: AcpPermissionResponse,
    reason: string,
  ): ResolveResult {
    this.resolutionReasons.set(interventionId, reason);
    try {
      return this.pendingService.resolveByInterventionId(
        interventionId,
        response as SharedResponse,
      );
    } finally {
      this.resolutionReasons.delete(interventionId);
    }
  }

  private mapResolveResult(
    result: ResolveResult,
    source: "callback" | "computer_permission_callback",
  ): NotifyResolvedResponse {
    if (result.ok) {
      return { ok: true, hostStatus: result.hostStatus };
    }

    if (result.error.code === "invalid_acp_response") {
      return {
        ok: false,
        error: {
          code:
            source === "callback" ? "invalid_acp_response" : "ERR_VALIDATION",
          message: result.error.message,
        },
      };
    }
    if (result.error.code === "already_resolved_conflict") {
      return {
        ok: false,
        error: {
          code:
            source === "callback"
              ? "already_resolved_conflict"
              : "ERR_PERMISSION_RESOLVE_FAILED",
          message: result.error.message,
        },
      };
    }
    return this.notFound(
      source === "callback" ? "not_found" : "ERR_PERMISSION_NOT_FOUND",
    );
  }

  private notFound(
    code: "not_found" | "ERR_PERMISSION_NOT_FOUND",
  ): NotifyResolvedResponse {
    return {
      ok: false,
      hostStatus: "gone",
      error: { code, message: "pending permission not found" },
    };
  }
}

export const approvalInterventionService = new ApprovalInterventionService();
