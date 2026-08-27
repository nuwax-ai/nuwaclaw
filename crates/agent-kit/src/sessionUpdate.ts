// ACP session-update classification shared by nuwa-cli & nuwaclaw.
//
// Hosts keep their own event shapes (nuwaclaw's `message.part.updated`
// events, nuwa-cli's verbatim SSE broadcast); this module only normalizes the
// plan-family and mode-change payloads so both hosts consume one canonical
// shape. Structural typing throughout — no ACP SDK runtime import.

export type PlanEntryStatus = "pending" | "in_progress" | "completed";
export type PlanEntryPriority = "high" | "medium" | "low";

/** Canonical ACP plan entry (v1 stable shape, identical across SDK 0.26/1.x). */
export interface PlanEntry {
  content: string;
  priority: PlanEntryPriority;
  status: PlanEntryStatus;
}

const ENTRY_STATUSES: readonly PlanEntryStatus[] = [
  "pending",
  "in_progress",
  "completed",
];
const ENTRY_PRIORITIES: readonly PlanEntryPriority[] = [
  "high",
  "medium",
  "low",
];

/**
 * Lenient single-entry normalization: unknown statuses (e.g. legacy nuwax
 * `failed`) fall back to `pending`, unknown priorities to `medium`, so a
 * partial payload never breaks rendering.
 */
export function normalizePlanEntry(value: unknown): PlanEntry | undefined {
  if (value === null || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const status = ENTRY_STATUSES.includes(record.status as PlanEntryStatus)
    ? (record.status as PlanEntryStatus)
    : "pending";
  const priority = ENTRY_PRIORITIES.includes(record.priority as PlanEntryPriority)
    ? (record.priority as PlanEntryPriority)
    : "medium";
  return {
    content: typeof record.content === "string" ? record.content : "",
    priority,
    status,
  };
}

/** Normalize an `entries` array; non-object members are dropped. */
export function normalizePlanEntries(value: unknown): PlanEntry[] {
  if (!Array.isArray(value)) return [];
  return value
    .map(normalizePlanEntry)
    .filter((entry): entry is PlanEntry => !!entry);
}

export interface PlanUpdatePayload {
  /** Complete replacement list — the spec requires clients to replace fully. */
  entries: PlanEntry[];
  /** True for `plan_removed` (plan no longer applies). */
  removed: boolean;
}

export interface ModeChangePayload {
  modeId: string | null;
}

export interface ClassifiedSessionUpdate {
  /** Value of `sessionUpdate`, or "unknown" when absent/non-string. */
  kind: string;
  plan?: PlanUpdatePayload;
  modeChange?: ModeChangePayload;
}

/**
 * Classify a raw ACP `session/update` payload without SDK types. Only the
 * plan family and `current_mode_update` carry normalized payloads; every
 * other kind passes through as `{ kind }` for host-side handling.
 */
export function classifySessionUpdate(
  update: Record<string, unknown>,
): ClassifiedSessionUpdate {
  const kind =
    typeof update.sessionUpdate === "string" ? update.sessionUpdate : "unknown";

  switch (kind) {
    case "plan":
    case "plan_update":
      return {
        kind,
        plan: { entries: normalizePlanEntries(update.entries), removed: false },
      };
    case "plan_removed":
      return { kind, plan: { entries: [], removed: true } };
    case "current_mode_update":
      return {
        kind,
        modeChange: {
          // SDK 0.26/1.x schema field is `currentModeId`; accept `modeId` too
          // as a defensive read for non-conforming agents.
          modeId:
            typeof update.currentModeId === "string"
              ? update.currentModeId
              : typeof update.modeId === "string"
                ? update.modeId
                : null,
        },
      };
    default:
      return { kind };
  }
}
