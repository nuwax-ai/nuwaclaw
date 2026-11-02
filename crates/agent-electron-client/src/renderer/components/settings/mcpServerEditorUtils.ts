import type { McpServerEntry } from "@shared/types/electron";
import { t } from "../../services/core/i18n";

/**
 * 宽松 JSON 解析：容忍无引号 key、单引号字符串、尾逗号、注释。
 * 先按标准 JSON.parse（零误伤）；失败再做轻量预处理后重试。
 * 仅面向 MCP 配置的人工输入场景，非通用 JSON5；字符串值内若含 `{key:` 这类片段可能被误判。
 */
export function looseJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    const normalized = text
      .replace(/\/\/.*$/gm, "")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/,\s*([}\]])/g, "$1")
      .replace(/'([^'\\]*(?:\\.[^'\\]*)*)'/g, '"$1"')
      .replace(/([{,]\s*)([A-Za-z_$][\w$-]*)(\s*:)/g, '$1"$2"$3');
    return JSON.parse(normalized);
  }
}

/**
 * 将 stdio MCP 的 env 序列化为表单文本（空对象则返回空串，避免多余字段）。
 */
export function serializeEnvToText(env?: Record<string, string>): string {
  if (!env || Object.keys(env).length === 0) return "";
  return JSON.stringify(env, null, 2);
}

/**
 * 解析表单中的 env JSON 对象文本。
 * - 空字符串 → 无 env（ok，env 为 undefined）
 * - 合法 `Record<string, string>` → 写入 entry.env
 * - 非法 JSON / 非对象 / value 非 string → 报错
 */
export function parseEnvText(
  input: string,
): { ok: true; env?: Record<string, string> } | { ok: false; error: string } {
  const raw = input.trim();
  if (!raw) return { ok: true, env: undefined };

  let parsed: unknown;
  try {
    parsed = looseJsonParse(raw);
  } catch {
    return { ok: false, error: t("Claw.MCP.addServer.envInvalid") };
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, error: t("Claw.MCP.addServer.envInvalid") };
  }

  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(
    parsed as Record<string, unknown>,
  )) {
    if (typeof value !== "string") {
      return { ok: false, error: t("Claw.MCP.addServer.envInvalid") };
    }
    // 忽略空 key，避免写入无效环境变量名
    if (!key.trim()) {
      return { ok: false, error: t("Claw.MCP.addServer.envInvalid") };
    }
    env[key] = value;
  }

  if (Object.keys(env).length === 0) {
    return { ok: true, env: undefined };
  }
  return { ok: true, env };
}

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
    parsed = looseJsonParse(text);
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
    // 编辑模式也使用 JSON 中的 key，以支持改名
    const id = parsed.serverId.trim();
    if (!id) {
      return { ok: false, error: t("Claw.MCP.addServer.idRequired") };
    }
    return { ok: true, serverId: id, entry: parsed.entry };
  }
  return input.formPayload();
}

/**
 * 将单条 MCP 草稿合并进完整配置（支持改名：删除 previousServerId）。
 */
export function applyMcpServerDraft(
  config: { mcpServers?: Record<string, McpServerEntry> },
  serverId: string,
  entry: McpServerEntry,
  previousServerId?: string,
): { mcpServers: Record<string, McpServerEntry> } {
  const nextServers = { ...(config.mcpServers ?? {}) };
  if (previousServerId && previousServerId !== serverId) {
    delete nextServers[previousServerId];
  }
  nextServers[serverId] = entry;
  return { ...config, mcpServers: nextServers };
}

/** 检测 serverId 是否与已有条目冲突（可排除正在编辑/草稿中的 id）。 */
export function isMcpServerIdDuplicate(
  serverId: string,
  existingServerIds: string[],
  excludeServerIds: string[] = [],
): boolean {
  const exclude = new Set(excludeServerIds.filter(Boolean));
  return existingServerIds.some((id) => id === serverId && !exclude.has(id));
}
