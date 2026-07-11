import { toErrorMessage } from "./acpPromptRetry";
import {
  isSessionModelInSync,
  normalizeModelSyncErrorMessage,
} from "./acpSessionModelSync";

export interface PromptErrorNormalizationInput {
  error: unknown;
  engineName: string;
  currentModelId?: string | null;
  resumedModelId?: string | null;
  targetModelId?: string | null;
}

export function normalizePromptErrorForDisplay(
  input: PromptErrorNormalizationInput,
): string {
  const raw = toErrorMessage(input.error);
  const lower = raw.toLowerCase();
  const currentModelId = input.currentModelId || input.resumedModelId || "";
  const targetModelId = input.targetModelId || "";

  if (
    lower.includes("providermodelnotfound") ||
    lower.includes("modelnotfounderror")
  ) {
    return normalizeModelSyncErrorMessage({
      currentModelId: currentModelId || "(unknown)",
      targetModelId: targetModelId || "(unknown)",
    });
  }

  if (
    input.engineName === "nuwaxcode" &&
    lower.includes("internal error: opencode service failure") &&
    currentModelId &&
    targetModelId &&
    !isSessionModelInSync(currentModelId, targetModelId)
  ) {
    return normalizeModelSyncErrorMessage({
      currentModelId,
      targetModelId,
    });
  }

  return raw;
}
