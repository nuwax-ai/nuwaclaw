import type { ComputerChatRequest } from "@shared/types/computerTypes";
import {
  modelsEquivalentForProvider,
  resolveOpenAICompatModel,
} from "./openAICompatRouting";

export interface SessionModelRuntimeState {
  acpCurrentModelId?: string | null;
  resumedModelId?: string | null;
}

export interface SessionModelConfigLike {
  model?: string;
  env?: {
    OPENCODE_MODEL?: string;
    ANTHROPIC_MODEL?: string;
  } | null;
}

export type SessionModelSyncPlan =
  | {
      kind: "noop";
      targetModelId: string;
      currentModelId: string;
    }
  | {
      kind: "update";
      targetModelId: string;
      currentModelId: string;
      method: "unstable_setSessionModel" | "setSessionConfigOption";
    }
  | {
      kind: "error";
      targetModelId: string;
      currentModelId: string;
      message: string;
    };

export function parseAcpCurrentModelId(configOptions: unknown): string | null {
  if (!Array.isArray(configOptions)) return null;
  for (const option of configOptions) {
    if (!option || typeof option !== "object") continue;
    const candidate = option as { id?: unknown; currentValue?: unknown };
    if (candidate.id !== "model") continue;
    return typeof candidate.currentValue === "string" &&
      candidate.currentValue.trim()
      ? candidate.currentValue.trim()
      : null;
  }
  return null;
}

export function normalizeModelSyncErrorMessage(input: {
  currentModelId: string;
  targetModelId: string;
}): string {
  return (
    "Session model is out of sync with the current request model. " +
    `Session=${input.currentModelId}, request=${input.targetModelId}. ` +
    "Try creating a new session or reloading the session model."
  );
}

export function resolveTargetModelForChat(
  request: ComputerChatRequest,
  config: SessionModelConfigLike | null | undefined,
): string | null {
  const requestModel =
    request.model_provider?.model || request.model_provider?.default_model;
  const envModel =
    request.agent_config?.agent_server?.env?.OPENCODE_MODEL ||
    request.agent_config?.agent_server?.env?.ANTHROPIC_MODEL;
  const resolved = resolveOpenAICompatModel({
    model: requestModel,
    envModel:
      envModel ||
      config?.env?.OPENCODE_MODEL ||
      config?.env?.ANTHROPIC_MODEL ||
      config?.model,
  });
  return (
    resolved?.rawModel || requestModel || envModel || config?.model || null
  );
}

export function resolveCurrentSessionModelId(
  session: SessionModelRuntimeState | null | undefined,
  currentEngineModelHint?: string | null,
): string {
  return (
    currentEngineModelHint?.trim() ||
    session?.acpCurrentModelId?.trim() ||
    session?.resumedModelId?.trim() ||
    ""
  );
}

export function isSessionModelInSync(
  currentModelId: string | null | undefined,
  targetModelId: string | null | undefined,
): boolean {
  const current = currentModelId?.trim() || "";
  const target = targetModelId?.trim() || "";
  return !!current && !!target && modelsEquivalentForProvider(current, target);
}

/** ACP agent 未实现 session model sync RPC 时（Method not found），nuwaclaw 可继续 prompt。 */
export function isAcpMethodNotFoundError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const candidate = err as { code?: unknown; message?: unknown };
  if (candidate.code === -32601) return true;
  const message =
    typeof candidate.message === "string" ? candidate.message : String(err);
  return /method not found/i.test(message);
}

/**
 * 仅当「本次 model sync 调用的 RPC」未实现时返回 true，避免吞掉其它 -32601。
 */
export function isAcpSessionModelSyncMethodNotFound(
  err: unknown,
  method: "unstable_setSessionModel" | "setSessionConfigOption",
): boolean {
  if (!isAcpMethodNotFoundError(err)) return false;
  const message =
    err &&
    typeof err === "object" &&
    typeof (err as { message?: unknown }).message === "string"
      ? (err as { message: string }).message
      : String(err);
  if (method === "setSessionConfigOption") {
    return /set_config_option|setSessionConfigOption/i.test(message);
  }
  return /setSessionModel|unstable_setSessionModel|set_session_model/i.test(
    message,
  );
}

export function buildSessionModelSyncPlan(input: {
  targetModelId: string | null | undefined;
  currentEngineModelHint?: string | null;
  session: SessionModelRuntimeState | null | undefined;
  supportsDedicatedModelSync: boolean;
  supportsConfigOptionSync: boolean;
}): SessionModelSyncPlan | null {
  const targetModelId = input.targetModelId?.trim() || "";
  if (!targetModelId) return null;

  const currentModelId = resolveCurrentSessionModelId(
    input.session,
    input.currentEngineModelHint,
  );

  if (isSessionModelInSync(currentModelId, targetModelId)) {
    return {
      kind: "noop",
      targetModelId,
      currentModelId,
    };
  }

  if (input.supportsDedicatedModelSync) {
    return {
      kind: "update",
      targetModelId,
      currentModelId,
      method: "unstable_setSessionModel",
    };
  }

  if (input.supportsConfigOptionSync) {
    return {
      kind: "update",
      targetModelId,
      currentModelId,
      method: "setSessionConfigOption",
    };
  }

  if (currentModelId) {
    return {
      kind: "error",
      targetModelId,
      currentModelId,
      message: normalizeModelSyncErrorMessage({
        currentModelId,
        targetModelId,
      }),
    };
  }

  return null;
}
