// @nuwax-ai/agent-kit — ACP permission pending state machine (configurable core).
//
// Shared by nuwa-cli (ApprovalPendingService) and nuwaclaw (ApprovalInterventionService,
// next round). Both keep pending ACP permissions awaiting human approval, indexed by
// interventionId AND acpSessionId+toolCallId, with supersession-on-duplicate-key,
// optionId-whitelist validation, timeout→cancelled, and short already_resolved
// retention for idempotent cloud retries. agent-kit holds the configurable core;
// each host wraps it (nuwaclaw adds revision checks + EventEmitter + its intervention
// envelope around the outside).
//
// Faithful port of nuwa-cli's ApprovalPendingService behavior.

import { randomUUID } from "node:crypto";
import type {
  RequestPermissionRequest,
  RequestPermissionResponse,
} from "@agentclientprotocol/sdk";

/** 默认 120s 超时；超时以 cancelled 结束。 */
const DEFAULT_TIMEOUT_MS = 120_000;
/** 已 resolve 的记录保留多久，供云端 idempotent 重试返回 already_resolved。 */
const DEFAULT_RESOLVED_RETENTION_MS = 60_000;

/** resolveInternal 的原因（用于 onResolved 回调）。 */
export type PendingResolveReason =
  | "resolved"
  | "superseded"
  | "timeout"
  | "session_cancel"
  | "cancel_all"
  | (string & {});

export interface PendingPermission {
  interventionId: string;
  appSessionId: string;
  acpSessionId: string;
  toolCallId: string;
  request: RequestPermissionRequest;
  /** 命中的敏感分类器 id（若有），用于 allow_always 缓存。 */
  classifierId?: string;
  /** nuwaclaw 下轮用：legacy 回执超集检测的 revision；nuwa-cli 不设。 */
  revision?: number;
  status: "pending" | "resolved";
  createdAt: number;
  resolve: (response: RequestPermissionResponse) => void;
  timer?: ReturnType<typeof setTimeout>;
  resolvedResponse?: RequestPermissionResponse;
}

export interface CreatePendingArgs {
  /** Host-created opaque id; omitted to use the service idFactory. */
  interventionId?: string;
  appSessionId: string;
  acpSessionId: string;
  request: RequestPermissionRequest;
  classifierId?: string;
  /** nuwaclaw 下轮用：透传 revision 到 pending 记录。 */
  revision?: number;
  /** 默认用 createPendingService 配置的 defaultTimeoutMs。 */
  timeoutMs?: number;
}

export type ResolveResult =
  | {
      ok: true;
      hostStatus: "resolved" | "already_resolved";
      pending: PendingPermission;
    }
  | {
      ok: false;
      hostStatus?: "gone";
      error: { code: string; message: string };
    };

export interface PendingServiceOptions {
  /** 干预 id 工厂；默认 `itv_<uuid>`（nuwa-cli / nuwaclaw 同款）。 */
  idFactory?: () => string;
  /** 默认超时（ms）；nuwa-cli 120000，nuwaclaw 下轮可传 Infinity/0 等表示不限。 */
  defaultTimeoutMs?: number;
  /** 已解决保留窗（ms）；0 = 不保留（仅 inline 状态检查）。默认 60000。 */
  retentionMs?: number;
  /** resolve 成功时回调（nuwaclaw 下轮桥接 EventEmitter）。 */
  onResolved?: (info: {
    interventionId: string;
    pending: PendingPermission;
    response: RequestPermissionResponse;
    reason: PendingResolveReason;
  }) => void;
}

export interface PendingServiceHandle {
  createPending(args: CreatePendingArgs): {
    interventionId: string;
    promise: Promise<RequestPermissionResponse>;
    pending: PendingPermission;
  };
  /** 按 acpSessionId + toolCallId 回执（/computer/notify-resolved 主路径）。 */
  resolveBySessionTool(
    acpSessionId: string,
    toolCallId: string,
    response: RequestPermissionResponse,
  ): ResolveResult;
  resolveByInterventionId(
    interventionId: string,
    response: RequestPermissionResponse,
  ): ResolveResult;
  /** Read-only lookup for host-owned revision/audit checks. */
  getPendingByInterventionId(
    interventionId: string,
  ): PendingPermission | undefined;
  getPendingBySessionTool(
    acpSessionId: string,
    toolCallId: string,
  ): PendingPermission | undefined;
  cancelByAppSession(appSessionId: string, reason?: PendingResolveReason): void;
  cancelByAcpSession(acpSessionId: string, reason?: PendingResolveReason): void;
  cancelAll(): void;
  hasPendingForAcpSession(acpSessionId: string): boolean;
  readonly pendingCount: number;
}

function permissionKey(acpSessionId: string, toolCallId: string): string {
  return `${acpSessionId}::${toolCallId}`;
}

function isValidResponse(
  response: RequestPermissionResponse,
  request: RequestPermissionRequest,
): boolean {
  if (response.outcome.outcome === "cancelled") return true;
  if (response.outcome.outcome === "selected") {
    const optionId = response.outcome.optionId;
    return request.options.some((opt) => opt.optionId === optionId);
  }
  return false;
}

function sameResponse(
  a?: RequestPermissionResponse,
  b?: RequestPermissionResponse,
): boolean {
  if (!a || !b) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

/** 默认 id 工厂：opaque id，不让外部推断 ACP session/tool call。 */
function defaultIdFactory(): string {
  return `itv_${randomUUID().replace(/-/g, "")}`;
}

/**
 * 创建 pending 权限服务。配置项见 PendingServiceOptions；行为对齐 nuwa-cli
 * ApprovalPendingService（recentResolved 保留窗 + already_resolved 幂等）。
 */
export function createPendingService(
  opts: PendingServiceOptions = {},
): PendingServiceHandle {
  const idFactory = opts.idFactory ?? defaultIdFactory;
  const defaultTimeoutMs = opts.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS;
  const retentionMs = opts.retentionMs ?? DEFAULT_RESOLVED_RETENTION_MS;
  const onResolved = opts.onResolved;

  const pending = new Map<string, PendingPermission>();
  const byPermissionKey = new Map<string, string>();
  /** key = permissionKey；resolve 后短暂保留。 */
  const recentResolved = new Map<string, PendingPermission>();

  function resolveInternal(
    interventionId: string,
    response: RequestPermissionResponse,
    reason: PendingResolveReason,
  ): void {
    const entry = pending.get(interventionId);
    if (!entry || entry.status !== "pending") return;
    entry.status = "resolved";
    entry.resolvedResponse = response;
    if (entry.timer) clearTimeout(entry.timer);
    const key = permissionKey(entry.acpSessionId, entry.toolCallId);
    byPermissionKey.delete(key);
    pending.delete(interventionId);
    if (retentionMs > 0) {
      recentResolved.set(key, entry);
      setTimeout(() => {
        const cur = recentResolved.get(key);
        if (cur?.interventionId === interventionId) {
          recentResolved.delete(key);
        }
      }, retentionMs).unref?.();
    }
    entry.resolve(response);
    onResolved?.({ interventionId, pending: entry, response, reason });
  }

  return {
    createPending(args) {
      const toolCallId = args.request.toolCall.toolCallId;
      const key = permissionKey(args.acpSessionId, toolCallId);
      const existingId = byPermissionKey.get(key);
      if (existingId) {
        resolveInternal(
          existingId,
          { outcome: { outcome: "cancelled" } },
          "superseded",
        );
      }
      // 新请求覆盖同 key 的 already_resolved 缓存
      recentResolved.delete(key);

      const interventionId = args.interventionId ?? idFactory();
      if (pending.has(interventionId)) {
        throw new Error(`duplicate intervention id: ${interventionId}`);
      }
      const timeoutMs = args.timeoutMs ?? defaultTimeoutMs;

      let resolveFn!: (response: RequestPermissionResponse) => void;
      const promise = new Promise<RequestPermissionResponse>((resolve) => {
        resolveFn = resolve;
      });

      const timer =
        timeoutMs > 0
          ? setTimeout(() => {
              resolveInternal(
                interventionId,
                { outcome: { outcome: "cancelled" } },
                "timeout",
              );
            }, timeoutMs)
          : undefined;

      const entry: PendingPermission = {
        interventionId,
        appSessionId: args.appSessionId,
        acpSessionId: args.acpSessionId,
        toolCallId,
        request: args.request,
        classifierId: args.classifierId,
        revision: args.revision,
        status: "pending",
        createdAt: Date.now(),
        resolve: resolveFn,
        timer,
      };

      pending.set(interventionId, entry);
      byPermissionKey.set(key, interventionId);

      return { interventionId, promise, pending: entry };
    },

    resolveBySessionTool(acpSessionId, toolCallId, response) {
      const key = permissionKey(acpSessionId, toolCallId);
      const interventionId = byPermissionKey.get(key);
      if (interventionId) {
        return this.resolveByInterventionId(interventionId, response);
      }

      const recent = recentResolved.get(key);
      if (recent) {
        if (sameResponse(recent.resolvedResponse, response)) {
          return { ok: true, hostStatus: "already_resolved", pending: recent };
        }
        return {
          ok: false,
          error: {
            code: "already_resolved_conflict",
            message: "permission already resolved with different response",
          },
        };
      }

      return {
        ok: false,
        hostStatus: "gone",
        error: {
          code: "ERR_PERMISSION_NOT_FOUND",
          message: "pending permission not found",
        },
      };
    },

    resolveByInterventionId(interventionId, response) {
      const entry = pending.get(interventionId);
      if (!entry) {
        // 可能已 resolve 并迁到 recentResolved
        for (const recent of recentResolved.values()) {
          if (recent.interventionId === interventionId) {
            if (sameResponse(recent.resolvedResponse, response)) {
              return {
                ok: true,
                hostStatus: "already_resolved",
                pending: recent,
              };
            }
            return {
              ok: false,
              error: {
                code: "already_resolved_conflict",
                message: "permission already resolved with different response",
              },
            };
          }
        }
        return {
          ok: false,
          hostStatus: "gone",
          error: {
            code: "ERR_PERMISSION_NOT_FOUND",
            message: "pending permission not found",
          },
        };
      }

      if (entry.status !== "pending") {
        if (sameResponse(entry.resolvedResponse, response)) {
          return { ok: true, hostStatus: "already_resolved", pending: entry };
        }
        return {
          ok: false,
          error: {
            code: "already_resolved_conflict",
            message: "permission already resolved with different response",
          },
        };
      }

      if (!isValidResponse(response, entry.request)) {
        return {
          ok: false,
          error: {
            code: "invalid_acp_response",
            message: "invalid ACP permission response",
          },
        };
      }

      resolveInternal(interventionId, response, "resolved");
      return { ok: true, hostStatus: "resolved", pending: entry };
    },

    getPendingByInterventionId(interventionId) {
      return pending.get(interventionId);
    },

    getPendingBySessionTool(acpSessionId, toolCallId) {
      const interventionId = byPermissionKey.get(
        permissionKey(acpSessionId, toolCallId),
      );
      return interventionId ? pending.get(interventionId) : undefined;
    },

    cancelByAppSession(appSessionId, reason = "session_cancel") {
      for (const entry of [...pending.values()]) {
        if (entry.appSessionId === appSessionId && entry.status === "pending") {
          resolveInternal(
            entry.interventionId,
            { outcome: { outcome: "cancelled" } },
            reason,
          );
        }
      }
    },

    cancelByAcpSession(acpSessionId, reason = "session_cancel") {
      for (const entry of [...pending.values()]) {
        if (entry.acpSessionId === acpSessionId && entry.status === "pending") {
          resolveInternal(
            entry.interventionId,
            { outcome: { outcome: "cancelled" } },
            reason,
          );
        }
      }
    },

    cancelAll() {
      for (const entry of [...pending.values()]) {
        if (entry.status === "pending") {
          resolveInternal(
            entry.interventionId,
            { outcome: { outcome: "cancelled" } },
            "cancel_all",
          );
        }
      }
    },

    hasPendingForAcpSession(acpSessionId) {
      for (const entry of pending.values()) {
        if (entry.acpSessionId === acpSessionId && entry.status === "pending") {
          return true;
        }
      }
      return false;
    },

    get pendingCount() {
      return pending.size;
    },
  };
}
