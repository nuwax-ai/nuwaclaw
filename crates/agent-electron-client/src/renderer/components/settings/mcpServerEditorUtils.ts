import type { McpServerEntry } from "@shared/types/electron";
import { t } from "../../services/core/i18n";

export function serializeEntryToJson(
  serverId: string,
  entry: McpServerEntry,
): string {
  const obj: Record<string, unknown> = {};
  obj[serverId] = entry;
  return JSON.stringify(obj, null, 2);
}

export function parseServerFromJson(
  text: string,
):
  | { ok: true; serverId: string; entry: McpServerEntry }
  | { ok: false; error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, error: t("Claw.MCP.message.invalidJson") };
  }

  const obj = parsed as Record<string, unknown>;

  if (
    obj.mcpServers &&
    typeof obj.mcpServers === "object" &&
    !Array.isArray(obj.mcpServers)
  ) {
    const servers = obj.mcpServers as Record<string, unknown>;
    const keys = Object.keys(servers);
    for (const key of keys) {
      const val = servers[key];
      if (
        val &&
        typeof val === "object" &&
        ("command" in val || "url" in val)
      ) {
        return { ok: true, serverId: key, entry: val as McpServerEntry };
      }
    }
  }

  const keys = Object.keys(obj);
  for (const key of keys) {
    if (key === "mcpServers" || key === "allowTools" || key === "denyTools")
      continue;
    const val = obj[key];
    if (val && typeof val === "object" && ("command" in val || "url" in val)) {
      return { ok: true, serverId: key, entry: val as McpServerEntry };
    }
  }

  return { ok: false, error: t("Claw.MCP.message.invalidJson") };
}

/** Resolves save/test payload from form fields or JSON editor text. */
export function resolveMcpEditorPayload(input: {
  editorTab: "form" | "json";
  jsonText: string;
  isEdit: boolean;
  editingServerId?: string;
  formPayload: () =>
    | { ok: true; serverId: string; entry: McpServerEntry }
    | { ok: false; error: string };
}):
  | { ok: true; serverId: string; entry: McpServerEntry }
  | { ok: false; error: string } {
  if (input.editorTab === "json") {
    if (!input.jsonText.trim()) {
      return { ok: false, error: t("Claw.MCP.message.invalidJson") };
    }
    const parsed = parseServerFromJson(input.jsonText);
    if (!parsed.ok) return parsed;
    const id =
      input.isEdit && input.editingServerId
        ? input.editingServerId
        : parsed.serverId.trim();
    if (!id) {
      return { ok: false, error: t("Claw.MCP.addServer.idRequired") };
    }
    return { ok: true, serverId: id, entry: parsed.entry };
  }
  return input.formPayload();
}
