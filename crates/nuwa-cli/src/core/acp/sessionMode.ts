import pc from "picocolors";
import { AGENT_METHODS, type ClientContext } from "@agentclientprotocol/sdk";
import type { SessionHandle } from "./sessionHandle.js";

/** Tried in order when --yolo is set without an explicit --mode; first one the engine actually offers wins. */
const YOLO_MODE_PREFERENCE = [
  "bypassPermissions",
  "dontAsk",
  "full-access",
  "yolo",
];

/**
 * Applies a session mode (engine-level "don't ask me" setting) on top of
 * whatever the per-call permission policy already does. This is a
 * best-effort optimization — if the mode can't be set, decidePermission()
 * remains the source of truth for individual tool-call approvals.
 */
export async function applySessionMode(
  ctx: ClientContext,
  session: Pick<SessionHandle, "sessionId" | "modes">,
  requestedModeId: string | undefined,
  yolo: boolean,
): Promise<void> {
  const available = session.modes?.availableModes?.map((m) => m.id) ?? [];

  let modeId = requestedModeId;
  if (!modeId && yolo) {
    modeId = YOLO_MODE_PREFERENCE.find((id) => available.includes(id));
  }
  if (!modeId) return;

  if (available.length > 0 && !available.includes(modeId)) {
    console.error(
      pc.yellow(
        `[nuwa-cli] 引擎不支持 mode "${modeId}"，可用：${available.join(", ")}`,
      ),
    );
    return;
  }

  try {
    await ctx.request(AGENT_METHODS.session_set_mode, {
      sessionId: session.sessionId,
      modeId,
    });
  } catch (err) {
    console.error(
      pc.yellow(
        `[nuwa-cli] 设置 mode "${modeId}" 失败：${(err as Error).message}`,
      ),
    );
  }
}
