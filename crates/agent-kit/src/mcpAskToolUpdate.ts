const MCP_ASK_TOOL_NAME = "nuwax_ask_question";
const MCP_ASK_SCHEMA_VERSION = "nuwax.mcp_ask.v2";
const MCP_ASK_UI_VERSION = "nuwax.interaction.v2";

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : undefined;
}

function isAskToolName(value: unknown): boolean {
  return (
    typeof value === "string" &&
    (value === MCP_ASK_TOOL_NAME || value.endsWith(`.${MCP_ASK_TOOL_NAME}`) ||
      value.endsWith(`__${MCP_ASK_TOOL_NAME}`))
  );
}

function looksLikeAskInput(value: unknown): value is UnknownRecord {
  const input = asRecord(value);
  if (!input) return false;
  const ui = asRecord(input.ui);
  if (!ui || !Array.isArray(ui.fields)) return false;
  return (
    isAskToolName(input.toolName) ||
    (typeof input.schemaVersion === "string" &&
      input.schemaVersion.startsWith("nuwax.mcp_ask")) ||
    (typeof ui.version === "string" &&
      ui.version.startsWith("nuwax.interaction")) ||
    typeof input.requestId === "string"
  );
}

function parseJson(value: string): unknown {
  const trimmed = value.trim();
  if (!trimmed || (trimmed[0] !== "{" && trimmed[0] !== "[")) {
    return undefined;
  }
  try {
    return JSON.parse(trimmed);
  } catch {
    return undefined;
  }
}

/**
 * Find the server-normalized ask input in MCP results emitted by different
 * adapters. Codex exposes `result.structuredContent.input`; Claude Code often
 * exposes the same object as JSON text in `rawOutput`/content blocks.
 */
export function extractMcpAskCanonicalInput(
  value: unknown,
  depth = 0,
): UnknownRecord | undefined {
  if (depth > 8 || value === null || value === undefined) return undefined;
  if (typeof value === "string") {
    const parsed = parseJson(value);
    return parsed === undefined
      ? undefined
      : extractMcpAskCanonicalInput(parsed, depth + 1);
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = extractMcpAskCanonicalInput(item, depth + 1);
      if (found) return found;
    }
    return undefined;
  }

  const record = asRecord(value);
  if (!record) return undefined;
  if (looksLikeAskInput(record)) return record;

  // Ordered from strongest MCP contract to looser ACP content wrappers.
  for (const key of [
    "input",
    "structuredContent",
    "result",
    "rawOutput",
    "raw_output",
    "content",
    "data",
    "text",
  ]) {
    const found = extractMcpAskCanonicalInput(record[key], depth + 1);
    if (found) return found;
  }
  return undefined;
}

function readRawInput(update: UnknownRecord): unknown {
  return update.rawInput ?? update.raw_input;
}

function readRawOutput(update: UnknownRecord): unknown {
  return update.rawOutput ?? update.raw_output;
}

function updateIsAsk(update: UnknownRecord, rawInput: unknown): boolean {
  const input = asRecord(rawInput);
  const meta = asRecord(update._meta);
  const claudeCode = asRecord(meta?.claudeCode);
  return (
    isAskToolName(update.title) ||
    isAskToolName(update.name) ||
    isAskToolName(update.toolName) ||
    isAskToolName(meta?.toolName) ||
    isAskToolName(claudeCode?.toolName) ||
    isAskToolName(input?.tool) ||
    isAskToolName(input?.toolName) ||
    (typeof input?.schemaVersion === "string" &&
      input.schemaVersion.startsWith("nuwax.mcp_ask"))
  );
}

function normalizeAskInput(input: UnknownRecord): UnknownRecord {
  const ui = asRecord(input.ui);
  return {
    ...input,
    toolName: MCP_ASK_TOOL_NAME,
    schemaVersion:
      typeof input.schemaVersion === "string"
        ? input.schemaVersion
        : MCP_ASK_SCHEMA_VERSION,
    ...(ui
      ? {
          ui: {
            ...ui,
            version:
              typeof ui.version === "string" ? ui.version : MCP_ASK_UI_VERSION,
          },
        }
      : {}),
  };
}

/**
 * Normalize an ACP `tool_call` / `tool_call_update` without depending on a
 * specific ACP SDK version. Unrelated updates are returned by identity.
 */
export function normalizeMcpAskToolUpdate<T extends UnknownRecord>(update: T): T {
  const rawInput = readRawInput(update);
  const outputInput = extractMcpAskCanonicalInput(readRawOutput(update));
  const wrapper = asRecord(rawInput);
  const wrappedArguments = asRecord(wrapper?.arguments);
  const isAsk = updateIsAsk(update, rawInput) || !!outputInput;
  if (!isAsk) return update;

  const candidate = outputInput ?? wrappedArguments ?? asRecord(rawInput);
  if (!candidate || !asRecord(candidate.ui)) return update;

  const normalizedInput = normalizeAskInput(candidate);
  const hasSnakeRawInput = Object.prototype.hasOwnProperty.call(
    update,
    "raw_input",
  );
  return {
    ...update,
    rawInput: normalizedInput,
    ...(hasSnakeRawInput ? { raw_input: normalizedInput } : {}),
  } as T;
}
