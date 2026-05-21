/**
 * ID coercion boundary between workbench and nuwax API.
 *
 * Convention:
 * - Inside `crates/agent-workbench` (state, props, types.ts), **all IDs are
 *   `string`**. This includes agentId, conversationId, messageId, skillIds,
 *   modelId, sandboxId.
 * - The nuwax API expects **numeric IDs** for agent/conversation/message/etc.
 *   Some legacy/string-shaped IDs may also occur; we preserve those as a
 *   string fallback.
 *
 * All boundary conversion happens **here**. Adapters should call:
 *   - {@link toApiId} when sending an ID to the nuwax API (outbound).
 *   - {@link fromApiId} when receiving an ID from the nuwax API (inbound).
 *
 * Do NOT use `Number(id)` / `String(raw)` directly on IDs in adapter code; use
 * these helpers so the boundary stays explicit and testable.
 */

/**
 * Outbound: workbench `string` → nuwax API value.
 *
 * - Pure-integer string within safe-integer range → `number` (nuwax common case).
 * - Anything else (non-numeric, decimal, too-large, empty) → original `string`
 *   as a safe fallback. nuwax accepts the string form for some endpoints, and
 *   this avoids silent precision loss on >2^53 IDs.
 *
 * Non-string inputs are coerced to string first so callers do not have to
 * defensively guard the rare runtime case where a number leaks through.
 */
export function toApiId(workbenchId: string | number | null | undefined): number | string {
  if (workbenchId === null || workbenchId === undefined) return '';
  if (typeof workbenchId === 'number') {
    return Number.isSafeInteger(workbenchId) ? workbenchId : String(workbenchId);
  }
  const trimmed = String(workbenchId).trim();
  if (!trimmed) return workbenchId as string;
  if (/^\d+$/.test(trimmed)) {
    const parsed = Number(trimmed);
    // Reject precision loss: 9999999999999999999 → fall back to string.
    if (Number.isSafeInteger(parsed) && String(parsed) === trimmed) {
      return parsed;
    }
  }
  return workbenchId as string;
}

/**
 * Inbound: nuwax API value → workbench `string`.
 *
 * Always returns a string. `null` / `undefined` become an empty string `""`,
 * which matches how upstream `normalize*` helpers in `webApiAdapter.ts` treat
 * missing IDs (they fall back to a generated id elsewhere if needed).
 *
 * Note: callers that want to distinguish "missing" from "empty" should branch
 * on the input themselves before calling this function.
 */
export function fromApiId(apiId: number | string | null | undefined): string {
  if (apiId === null || apiId === undefined) return '';
  if (typeof apiId === 'number') {
    if (!Number.isFinite(apiId)) return '';
    return String(apiId);
  }
  return apiId;
}

/**
 * Legacy alias kept for backward compatibility with code that still imports
 * `coerceNumericId`. New code should call {@link toApiId} directly.
 *
 * @deprecated Use {@link toApiId}.
 */
export function coerceNumericId(value: string | number): number | string {
  return toApiId(value);
}
