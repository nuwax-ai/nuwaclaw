import type { AcpSessionUpdate } from "./acpClient";

export interface PermissionGatedToolUpdateNormalization {
  update: AcpSessionUpdate;
  delay: boolean;
}

export interface PermissionGatedToolInputCache {
  rawInput: unknown;
  title?: string;
}

export function normalizePermissionGatedToolUpdate(
  update: AcpSessionUpdate,
  rawInputsByToolCallId: Map<string, PermissionGatedToolInputCache>,
): PermissionGatedToolUpdateNormalization {
  const toolUpdate = update as Record<string, any>;
  const toolCallId = readToolCallId(toolUpdate);
  const rawInput = readRawInput(toolUpdate);
  const title = readTitle(toolUpdate);
  const hasCachedInteractiveInput =
    !!toolCallId && rawInputsByToolCallId.has(toolCallId);
  const hasInteractiveInput = isInteractiveToolInput(rawInput);

  if (!hasInteractiveInput && !hasCachedInteractiveInput) {
    return { update, delay: false };
  }

  if (toolCallId && hasInteractiveInput) {
    rawInputsByToolCallId.set(toolCallId, { rawInput, title });
  }

  const isCompletedResult =
    update.sessionUpdate === "tool_call_update" &&
    toolUpdate.status === "completed" &&
    readRawOutput(toolUpdate) !== undefined;
  if (!isCompletedResult) {
    return { update, delay: !isCompletedResult };
  }

  if (rawInput !== undefined) {
    if (toolCallId) {
      rawInputsByToolCallId.delete(toolCallId);
    }
    return {
      update: withInferredTitle(toolUpdate, title),
      delay: false,
    };
  }

  if (!toolCallId) {
    return { update, delay: false };
  }

  const cached = rawInputsByToolCallId.get(toolCallId);
  if (!cached) {
    return { update, delay: false };
  }

  rawInputsByToolCallId.delete(toolCallId);
  return {
    update: withInferredTitle(
      {
        ...toolUpdate,
        rawInput: cached.rawInput,
      },
      title ?? cached.title,
    ),
    delay: false,
  };
}

function readToolCallId(toolUpdate: Record<string, any>): string | null {
  const toolCallId = toolUpdate.toolCallId ?? toolUpdate.tool_call_id;
  return typeof toolCallId === "string" && toolCallId ? toolCallId : null;
}

function readRawInput(toolUpdate: Record<string, any>): unknown {
  return toolUpdate.rawInput ?? toolUpdate.raw_input;
}

function readRawOutput(toolUpdate: Record<string, any>): unknown {
  return toolUpdate.rawOutput ?? toolUpdate.raw_output;
}

function readTitle(toolUpdate: Record<string, any>): string | undefined {
  const title =
    toolUpdate.title ??
    toolUpdate.name ??
    toolUpdate._meta?.claudeCode?.toolName ??
    toolUpdate._meta?.toolName;
  return typeof title === "string" && title ? title : undefined;
}

function withInferredTitle(
  toolUpdate: Record<string, any>,
  title?: string,
): AcpSessionUpdate {
  if (toolUpdate.title || !title) {
    return toolUpdate as AcpSessionUpdate;
  }
  return {
    ...toolUpdate,
    title,
  } as AcpSessionUpdate;
}

function isInteractiveToolInput(rawInput: unknown): boolean {
  if (!rawInput || typeof rawInput !== "object") {
    return false;
  }
  const input = rawInput as Record<string, unknown>;
  // nuwax_ask_question MCP 工具的 rawInput 包含 ui 字段（交互式表单），
  // 但它不是权限门控工具——它需要被实时转发给前端渲染表单。
  // 通过 schemaVersion 识别并排除（rawInput 中没有 toolName 字段）。
  if (
    typeof input.schemaVersion === "string" &&
    input.schemaVersion.startsWith("nuwax.mcp_ask")
  ) {
    return false;
  }
  return !!input.ui && typeof input.ui === "object";
}
