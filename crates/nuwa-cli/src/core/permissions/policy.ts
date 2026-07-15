import * as clack from "@clack/prompts";
import pc from "picocolors";
import type {
  RequestPermissionRequest,
  RequestPermissionResponse,
} from "@agentclientprotocol/sdk";

export type PermissionMode = "interactive" | "yolo" | "deny-noninteractive";

function firstOptionOfKind(request: RequestPermissionRequest, kinds: string[]) {
  for (const kind of kinds) {
    const found = request.options.find((option) => option.kind === kind);
    if (found) return found;
  }
  return undefined;
}

/**
 * Decides the outcome of an ACP `session/request_permission` call.
 *
 * - interactive: ask the user via a TTY select prompt.
 * - yolo: auto-approve, preferring an "allow_always" option over "allow_once".
 * - deny-noninteractive: no TTY and no --yolo — refuse writes and tell the
 *   user how to unblock (`--yolo` / `--mode`), rather than hanging forever.
 */
export async function decidePermission(
  request: RequestPermissionRequest,
  mode: PermissionMode,
): Promise<RequestPermissionResponse> {
  if (mode === "yolo") {
    // Only ever auto-select an *allow* option. If none exists (an ACP agent
    // offering only reject options would be unusual, but not impossible),
    // cancel rather than silently picking a reject/deny option — --yolo
    // must never end up denying a call the user asked to auto-approve.
    const option = firstOptionOfKind(request, ["allow_always", "allow_once"]);
    if (!option) return { outcome: { outcome: "cancelled" } };
    return { outcome: { outcome: "selected", optionId: option.optionId } };
  }

  if (mode === "deny-noninteractive") {
    const option = firstOptionOfKind(request, ["reject_once", "reject_always"]);
    console.error(
      pc.yellow(
        `[nuwa-cli] 工具调用需要授权但当前是非交互模式，已自动拒绝。加 --yolo 或 --mode <mode> 以允许工具调用。`,
      ),
    );
    if (!option) return { outcome: { outcome: "cancelled" } };
    return { outcome: { outcome: "selected", optionId: option.optionId } };
  }

  const toolTitle = request.toolCall.title ?? request.toolCall.toolCallId;
  const selected = await clack.select({
    message: `是否允许工具调用「${toolTitle}」？`,
    options: request.options.map((option) => ({
      value: option.optionId,
      label: option.name,
    })),
  });

  if (clack.isCancel(selected)) {
    return { outcome: { outcome: "cancelled" } };
  }
  return { outcome: { outcome: "selected", optionId: selected } };
}
