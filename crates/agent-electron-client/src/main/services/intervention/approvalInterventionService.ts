/**
 * Approval Intervention Service
 *
 * 管理 ACP permission 的 pending 状态机：
 * - ask 模式：创建 pending 并等待 /computer/notify-resolved 回调
 * - timeout/session cancel 自动 cancelled
 * - resolve 校验 optionId 白名单
 * - 同步 resolve 只一次
 */

import { EventEmitter } from "events";
import log from "electron-log/main";
import type {
  PendingAcpPermission,
  NotifyResolvedRequest,
  NotifyResolvedResponse,
  AcpPermissionResponse,
  AcpPermissionOption,
  ComputerNotifyResolvedRequest,
} from "@shared/types/intervention";
import type { AcpPermissionRequest } from "../engines/acp/acpClient";
import { buildAcpPermissionInterventionRequest } from "./buildAcpPermissionInterventionRequest";
import { parseComputerPermissionResolveRequest } from "./computerPermissionProtocol";

export class ApprovalInterventionService extends EventEmitter {
  private pending = new Map<string, PendingAcpPermission>();
  private pendingByAcpPermissionKey = new Map<string, string>();

  private static readonly DEFAULT_TIMEOUT_MS: number | undefined = undefined;

  /**
   * 创建 pending intervention 并返回 intervention request（用于 SSE 抨递）
   * 同时返回 ACP Promise，resolve 后得到 ACP 官方 response。
   */
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
    const toolCallId = acpRequest.toolCall.toolCallId;
    const permissionKey = this.buildAcpPermissionKey(acpSessionId, toolCallId);
    const existingInterventionId =
      this.pendingByAcpPermissionKey.get(permissionKey);
    if (existingInterventionId) {
      log.warn(
        `[Intervention] Duplicate pending permission key; cancelling previous pending: acpSession=${acpSessionId} toolCall=${toolCallId}`,
      );
      this.resolvePendingInternal(
        existingInterventionId,
        { outcome: { outcome: "cancelled" } },
        "superseded",
      );
    }

    const interventionRequest = buildAcpPermissionInterventionRequest({
      engine,
      appSessionId,
      acpRequest,
      timeoutMs,
    });

    const acpResponsePromise = new Promise<AcpPermissionResponse>((resolve) => {
      const effectiveTimeoutMs =
        interventionRequest.timeoutMs ??
        ApprovalInterventionService.DEFAULT_TIMEOUT_MS;
      const timer = effectiveTimeoutMs
        ? setTimeout(() => {
            this.resolvePendingInternal(
              interventionRequest.id,
              { outcome: { outcome: "cancelled" } },
              "timeout",
            );
          }, effectiveTimeoutMs)
        : undefined;

      this.pending.set(interventionRequest.id, {
        interventionId: interventionRequest.id,
        revision: interventionRequest.revision,
        acpSessionId,
        appSessionId,
        toolCallId,
        request: acpRequest,
        options: acpRequest.options,
        status: "pending",
        resolve,
        timer,
        createdAt: Date.now(),
      });
      this.pendingByAcpPermissionKey.set(permissionKey, interventionRequest.id);

      log.info(
        `[Intervention] Pending created: id=${interventionRequest.id} session=${appSessionId} acpSession=${acpSessionId} toolCall=${toolCallId}`,
      );
    });

    return { interventionRequest, acpResponsePromise };
  }

  /**
   * 通过 /computer/notify-resolved 回调 resolve pending
   */
  resolveFromCallback(payload: NotifyResolvedRequest): NotifyResolvedResponse {
    const pending = this.pending.get(payload.interventionId);
    if (!pending) {
      return {
        ok: false,
        hostStatus: "gone",
        error: { code: "not_found", message: "pending permission not found" },
      };
    }

    if (pending.revision !== payload.revision) {
      return {
        ok: false,
        hostStatus: "superseded",
        error: { code: "revision_mismatch", message: "revision mismatch" },
      };
    }

    if (pending.status !== "pending") {
      if (this.sameAcpResponse(pending.resolvedResponse, payload.acpResponse)) {
        return { ok: true, hostStatus: "already_resolved" };
      }
      return {
        ok: false,
        error: {
          code: "already_resolved_conflict",
          message: "permission already resolved with different response",
        },
      };
    }

    if (
      !this.isValidAcpPermissionResponse(payload.acpResponse, pending.options)
    ) {
      return {
        ok: false,
        error: {
          code: "invalid_acp_response",
          message: "invalid ACP permission response",
        },
      };
    }

    this.resolvePendingInternal(
      payload.interventionId,
      payload.acpResponse,
      "callback",
    );

    return { ok: true, hostStatus: "resolved" };
  }

  /**
   * 通过 /computer/notify-resolved 的 permission_resolve_request 回调 resolve pending
   */
  resolveFromComputerPermissionCallback(
    payload: ComputerNotifyResolvedRequest,
  ): NotifyResolvedResponse {
    const parsed = parseComputerPermissionResolveRequest(payload);
    if (!parsed.ok) {
      return parsed.response;
    }

    const { acpSessionId, toolCallId, acpResponse } = parsed.command;
    const permissionKey = this.buildAcpPermissionKey(acpSessionId, toolCallId);
    const interventionId = this.pendingByAcpPermissionKey.get(permissionKey);
    if (!interventionId) {
      return {
        ok: false,
        hostStatus: "gone",
        error: {
          code: "ERR_PERMISSION_NOT_FOUND",
          message: "pending permission not found",
        },
      };
    }

    const pending = this.pending.get(interventionId);
    if (!pending) {
      this.pendingByAcpPermissionKey.delete(permissionKey);
      return {
        ok: false,
        hostStatus: "gone",
        error: {
          code: "ERR_PERMISSION_NOT_FOUND",
          message: "pending permission not found",
        },
      };
    }

    if (pending.status !== "pending") {
      if (this.sameAcpResponse(pending.resolvedResponse, acpResponse)) {
        return { ok: true, hostStatus: "already_resolved" };
      }
      return {
        ok: false,
        error: {
          code: "ERR_PERMISSION_RESOLVE_FAILED",
          message: "permission already resolved with different response",
        },
      };
    }

    if (!this.isValidAcpPermissionResponse(acpResponse, pending.options)) {
      return {
        ok: false,
        error: {
          code: "ERR_VALIDATION",
          message: "invalid ACP permission response",
        },
      };
    }

    this.resolvePendingInternal(
      interventionId,
      acpResponse,
      "computer_permission_callback",
    );
    return { ok: true, hostStatus: "resolved" };
  }

  hasPendingForAcpSession(acpSessionId: string): boolean {
    for (const pending of this.pending.values()) {
      if (
        pending.acpSessionId === acpSessionId &&
        pending.status === "pending"
      ) {
        return true;
      }
    }
    return false;
  }

  /**
   * 按 acpSessionId 取消所有 pending（session cancel / 新 chat 顶替时调用）
   */
  cancelByAcpSession(acpSessionId: string, reason = "session_cancel"): void {
    for (const [id, pending] of this.pending) {
      if (pending.acpSessionId === acpSessionId) {
        this.resolvePendingInternal(
          id,
          { outcome: { outcome: "cancelled" } },
          reason,
        );
      }
    }
  }

  /**
   * 按 appSessionId 取消所有 pending
   */
  cancelByAppSession(appSessionId: string): void {
    for (const [id, pending] of this.pending) {
      if (pending.appSessionId === appSessionId) {
        this.resolvePendingInternal(
          id,
          { outcome: { outcome: "cancelled" } },
          "session_cancel",
        );
      }
    }
  }

  /**
   * 销毁：清理所有 pending
   */
  destroy(): void {
    for (const [id, pending] of this.pending) {
      if (pending.timer) clearTimeout(pending.timer);
      pending.resolve({ outcome: { outcome: "cancelled" } });
    }
    this.pending.clear();
    this.pendingByAcpPermissionKey.clear();
  }

  get pendingCount(): number {
    return this.pending.size;
  }

  // === Private ===

  private resolvePendingInternal(
    interventionId: string,
    response: AcpPermissionResponse,
    reason: string,
  ): void {
    const pending = this.pending.get(interventionId);
    if (!pending || pending.status !== "pending") return;

    pending.status =
      response.outcome.outcome === "cancelled" ? "cancelled" : "resolved";
    pending.resolvedResponse = response;
    if (pending.timer) clearTimeout(pending.timer);

    log.info(
      `[Intervention] Resolved: id=${interventionId} reason=${reason} outcome=${response.outcome.outcome}`,
    );

    // 同步删除，再 resolve Promise
    this.pending.delete(interventionId);
    this.pendingByAcpPermissionKey.delete(
      this.buildAcpPermissionKey(pending.acpSessionId, pending.toolCallId),
    );
    pending.resolve(response);

    this.emit("resolved", { interventionId, reason, response });
  }

  private isValidAcpPermissionResponse(
    response: AcpPermissionResponse,
    options: AcpPermissionOption[],
  ): boolean {
    if (response.outcome.outcome === "cancelled") return true;
    if (response.outcome.outcome !== "selected") return false;
    return options.some(
      (option) =>
        option.optionId ===
        (response.outcome as { outcome: "selected"; optionId: string })
          .optionId,
    );
  }

  private sameAcpResponse(
    a?: AcpPermissionResponse,
    b?: AcpPermissionResponse,
  ): boolean {
    if (!a || !b) return false;
    return JSON.stringify(a) === JSON.stringify(b);
  }

  private buildAcpPermissionKey(acpSessionId: string, toolCallId: string) {
    return `${acpSessionId}\u0000${toolCallId}`;
  }
}

/** 单例 */
export const approvalInterventionService = new ApprovalInterventionService();
