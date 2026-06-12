import type {
  WorkbenchPermissionChoice,
  WorkbenchAcpToolCall,
  WorkbenchAcpToolKind,
  WorkbenchPermissionOptionKind,
  WorkbenchPermissionRequest,
  WorkbenchMcpAskInteraction,
  WorkbenchStreamEvent,
  WorkbenchStreamEventType,
} from './types';

interface RawSseMessage {
  event?: string;
  data: string;
  id?: string;
}

export interface SseParser {
  feed(chunk: string): WorkbenchStreamEvent[];
  flush(): WorkbenchStreamEvent[];
}

function parseJsonMaybe(value: string): unknown {
  const trimmed = value.trim();
  if (!trimmed) return '';
  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
}

function getRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readString(value: unknown, paths: string[][]): string | undefined {
  for (const path of paths) {
    let current: unknown = value;
    for (const key of path) {
      if (Array.isArray(current)) {
        const index = Number(key);
        if (!Number.isInteger(index) || index < 0 || index >= current.length) {
          current = undefined;
          break;
        }
        current = current[index];
        continue;
      }
      const record = getRecord(current);
      if (!record || !(key in record)) {
        current = undefined;
        break;
      }
      current = record[key];
    }
    if (typeof current === 'string') return current;
    if (typeof current === 'number' || typeof current === 'boolean') {
      return String(current);
    }
  }
  return undefined;
}

function readPermission(value: unknown): WorkbenchPermissionRequest | undefined {
  const record = getRecord(value);
  const source =
    getRecord(record?.permission) ??
    getRecord(record?.request) ??
    getRecord(record?.data) ??
    record;
  if (!source) return undefined;

  // --- ACP structured permission detection ---
  // nuwax feat-2026.6.18 sends ACP permissions in several envelope shapes:
  //   1. messageType/message_type = 'acpRequestPermission'
  //   2. subType/sub_type = 'AcpRequestPermission' or 'request_permission'
  //   3. PROCESSING events with nested result.input.request_permission_request
  const messageType =
    readString(source, [['messageType'], ['message_type']])?.toLowerCase() ?? '';
  const subType =
    readString(source, [['subType'], ['sub_type']])?.toLowerCase() ?? '';
  const subEventType =
    readString(source, [['subEventType']])?.toLowerCase() ?? '';
  const innerData = getRecord(source?.data) ?? source;
  const result = getRecord(innerData?.result);
  const processingInput = getRecord(result?.input);
  const reqPerm =
    getRecord(innerData?.request_permission_request) ??
    getRecord(processingInput?.request_permission_request);
  const intervention =
    getRecord(innerData?._intervention) ??
    getRecord(innerData?.interventionRequest);

  const isAcpPermission =
    messageType === 'acprequestpermission' ||
    subType === 'acprequestpermission' ||
    subType === 'request_permission' ||
    subEventType === 'request_permission' ||
    Boolean(reqPerm) ||
    Boolean(intervention?.acp);

  if (isAcpPermission) {
    if (reqPerm) return parseAcpPermission(reqPerm, intervention);
    const acpReq = getRecord(getRecord(intervention?.acp)?.request);
    if (acpReq) return parseAcpPermission(acpReq, intervention);
  }

  return parseFlatPermission(source);
}

const VALID_TOOL_KINDS: WorkbenchAcpToolKind[] = [
  'read', 'edit', 'delete', 'move', 'search',
  'execute', 'think', 'fetch', 'switch_mode', 'other',
];

function normalizeToolKind(raw: unknown): WorkbenchAcpToolKind {
  if (typeof raw === 'string' && (VALID_TOOL_KINDS as string[]).includes(raw)) {
    return raw as WorkbenchAcpToolKind;
  }
  return 'other';
}

const VALID_OPTION_KINDS: WorkbenchPermissionOptionKind[] = [
  'allow_once', 'allow_always', 'reject_once', 'reject_always',
];

function normalizeOptionKind(raw: unknown): WorkbenchPermissionOptionKind | undefined {
  if (typeof raw === 'string' && (VALID_OPTION_KINDS as string[]).includes(raw)) {
    return raw as WorkbenchPermissionOptionKind;
  }
  return undefined;
}

function parseAcpPermission(
  reqPerm: Record<string, unknown>,
  intervention?: Record<string, unknown> | null,
): WorkbenchPermissionRequest | undefined {
  const sessionId =
    readString(reqPerm, [['sessionId'], ['session_id']]) ??
    readString(intervention, [['sessionId']]) ?? '';
  const toolCallRaw =
    getRecord(reqPerm?.toolCall) ??
    getRecord(reqPerm?.tool_call) ??
    getRecord(getRecord(getRecord(intervention?.acp)?.request)?.toolCall);
  const toolCallId =
    readString(reqPerm, [['tool_call_id']]) ??
    readString(toolCallRaw, [['toolCallId'], ['tool_call_id']]) ?? '';

  if (!sessionId && !toolCallId) return undefined;

  const optionsRaw = Array.isArray(reqPerm?.options)
    ? reqPerm.options
    : Array.isArray(getRecord(getRecord(intervention?.acp)?.request)?.options)
      ? getRecord(getRecord(intervention?.acp)?.request)?.options
      : [];

  const choices: WorkbenchPermissionChoice[] = (optionsRaw as unknown[])
    .map((optionRaw): WorkbenchPermissionChoice | null => {
      const opt = getRecord(optionRaw);
      if (!opt) return null;
      const optionId = readString(opt, [['optionId'], ['option_id']]);
      if (!optionId) return null;
      const kind = normalizeOptionKind(opt.kind);
      const name = readString(opt, [['name']]) ?? optionId;
      return {
        id: optionId,
        label: name,
        kind,
        destructive: kind === 'reject_once' || kind === 'reject_always',
      };
    })
    .filter((c): c is WorkbenchPermissionChoice => Boolean(c));

  const toolCall: WorkbenchAcpToolCall | undefined = toolCallRaw
    ? {
        toolCallId: toolCallId || undefined,
        title: readString(toolCallRaw, [['title']]) ?? undefined,
        kind: normalizeToolKind(toolCallRaw?.kind),
        status: readString(toolCallRaw, [['status']]) ?? undefined,
        locations: Array.isArray(toolCallRaw?.locations)
          ? toolCallRaw.locations
          : undefined,
        rawInput: toolCallRaw?.rawInput ?? toolCallRaw?.raw_input,
      }
    : undefined;

  const id =
    readString(intervention, [['id']]) ??
    readString(reqPerm, [['_meta', 'nuwaclaw_intervention_id']]) ??
    `itv_${sessionId || 'unknown'}_${toolCallId || Date.now()}`;

  return {
    id,
    title: toolCall?.title ?? 'Permission required',
    choices: choices.length > 0 ? choices : undefined,
    toolCall,
    metadata: intervention ?? reqPerm,
  };
}

function parseFlatPermission(
  source: Record<string, unknown>,
): WorkbenchPermissionRequest | undefined {
  const id = readString(source, [['id'], ['permissionId'], ['permission_id']]);
  if (!id) return undefined;

  const rawChoices = source.choices;
  const choices = Array.isArray(rawChoices)
    ? rawChoices
        .map((choice): WorkbenchPermissionChoice | null => {
          if (typeof choice === 'string') {
            return { id: choice, label: choice };
          }
          const choiceRecord = getRecord(choice);
          const choiceId = readString(choiceRecord, [['id'], ['value']]);
          if (!choiceRecord || !choiceId) return null;
          return {
            id: choiceId,
            label: readString(choiceRecord, [['label'], ['title']]) ?? choiceId,
            destructive: Boolean(choiceRecord.destructive),
          };
        })
        .filter((choice): choice is WorkbenchPermissionChoice => Boolean(choice))
    : undefined;

  return {
    id,
    title:
      readString(source, [['title'], ['name'], ['permission']]) ??
      'Permission required',
    description: readString(source, [['description'], ['reason'], ['message']]),
    choices,
    metadata: source,
  };
}

// ---------------------------------------------------------------------------
// MCP Ask (nuwax_ask_question) detection and parsing
// ---------------------------------------------------------------------------

/**
 * Checks whether a PROCESSING/tool_call SSE event contains a nuwax_ask_question
 * tool call input and, if so, returns a WorkbenchMcpAskInteraction.
 *
 * The raw input can appear in several locations:
 *   - data.raw_input / data.rawInput
 *   - data.ext.raw_input / data.ext.rawInput
 *   - data.result.input
 *   - data.result.ext.raw_input / data.result.ext.rawInput
 */
function readMcpAsk(value: unknown): WorkbenchMcpAskInteraction | undefined {
  const record = getRecord(value);
  if (!record) return undefined;
  const innerData = getRecord(record?.data) ?? record;

  // Extract raw_input from the various nested locations.
  const ext = getRecord(innerData?.ext);
  const result = getRecord(innerData?.result);
  const resultExt = getRecord(result?.ext);

  function nonEmptyObj(rec: unknown): Record<string, unknown> | undefined {
    return rec && typeof rec === 'object' && !Array.isArray(rec) && Object.keys(rec).length > 0
      ? (rec as Record<string, unknown>)
      : undefined;
  }

  const rawInput =
    nonEmptyObj(innerData?.raw_input) ??
    nonEmptyObj(innerData?.rawInput) ??
    nonEmptyObj(ext?.raw_input) ??
    nonEmptyObj(ext?.rawInput) ??
    nonEmptyObj(result?.input) ??
    nonEmptyObj(resultExt?.raw_input) ??
    nonEmptyObj(resultExt?.rawInput);

  if (!rawInput) return undefined;

  // Validate schema version + toolName.
  if (typeof rawInput.schemaVersion !== 'string') return undefined;
  if (
    !['nuwaclaw.mcp_ask.v1', 'nuwax.mcp_ask.v1'].includes(rawInput.schemaVersion)
  ) {
    return undefined;
  }
  const toolName = rawInput.toolName ?? 'nuwax_ask_question';
  if (toolName !== 'nuwax_ask_question') return undefined;
  if (typeof rawInput.requestId !== 'string') return undefined;
  if (!rawInput.ui || typeof rawInput.ui !== 'object') return undefined;

  const ui = rawInput.ui as Record<string, unknown>;
  if (typeof ui.version !== 'string') return undefined;
  if (!['nuwaclaw.interaction.v1', 'nuwax.interaction.v1'].includes(ui.version)) {
    return undefined;
  }

  const toolCallId =
    readString(innerData, [['tool_call_id'], ['toolCallId']]) ??
    readString(innerData, [['executeId']]) ??
    readString(result, [['executeId']]) ??
    rawInput.requestId;

  return {
    input: { ...rawInput, toolName: 'nuwax_ask_question' } as WorkbenchMcpAskInteraction['input'],
    toolCallId,
    responseStatus: 'pending',
  };
}

/**
 * nuwax OpenApp SSE：ConversationChatResponse.eventType
 * 可用值 PROCESSING | MESSAGE | FINAL_RESULT | ERROR
 */
function inferNuwaxEnvelopeType(payload: unknown): WorkbenchStreamEventType | null {
  const record = getRecord(payload);
  if (!record) return null;
  const eventType = readString(record, [['eventType'], ['event_type']])?.toUpperCase();
  if (!eventType) return null;

  // ACP permission events can arrive as their own eventType or nested inside
  // PROCESSING. Check before the generic PROCESSING → 'processing' mapping
  // so the permission parser gets a chance to extract structured data.
  if (
    eventType === 'ACP_REQUEST_PERMISSION' ||
    eventType === 'ACP_REQUEST_PERM'
  ) {
    return 'permission';
  }
  const data = getRecord(record.data) ?? record;
  const messageType = readString(data, [['messageType'], ['message_type']])?.toLowerCase();
  const subType = readString(data, [['subType'], ['sub_type']])?.toLowerCase();
  if (
    messageType === 'acprequestpermission' ||
    subType === 'acprequestpermission' ||
    subType === 'request_permission'
  ) {
    return 'permission';
  }
 // PROCESSING events that carry a nested request_permission_request
 if (eventType === 'PROCESSING') {
   const result = getRecord(data?.result);
   const procInput = getRecord(result?.input);
   if (
     getRecord(data?.request_permission_request) ||
     getRecord(procInput?.request_permission_request) ||
     getRecord(data?._intervention) ||
     getRecord(data?.interventionRequest)
   ) {
     return 'permission';
   }
  // MCP Ask (nuwax_ask_question) tool calls
  const subType = readString(data, [['subType'], ['sub_type']])?.toLowerCase();
  const ext = getRecord(data?.ext);
  const rawInputSource =
    getRecord(data?.raw_input) ??
    getRecord(data?.rawInput) ??
    getRecord(ext?.raw_input) ??
    getRecord(ext?.rawInput) ??
    getRecord(procInput) ??
    getRecord(getRecord(result?.ext)?.raw_input) ??
    getRecord(getRecord(result?.ext)?.rawInput);
  if (
   (subType === 'tool_call' || subType === 'tool_call_update') &&
    rawInputSource &&
   typeof (rawInputSource as Record<string, unknown>).schemaVersion === 'string'
  ) {
    return 'mcp_ask';
  }
  // Also detect via executeId + result.input even without explicit subType.
  if (
    rawInputSource &&
    typeof (rawInputSource as Record<string, unknown>).schemaVersion === 'string' &&
    ['nuwaclaw.mcp_ask.v1', 'nuwax.mcp_ask.v1'].includes(
      (rawInputSource as Record<string, unknown>).schemaVersion as string,
    )
  ) {
    return 'mcp_ask';
  }
}

if (eventType === 'PROCESSING') return 'processing';
  if (eventType === 'FINAL_RESULT') return 'final';
  if (eventType === 'ERROR') return 'error';
  if (eventType === 'MESSAGE') {
   const data = getRecord(record.data) ?? record;
    const messageMode = readString(data, [['type']])?.toUpperCase();
    if (messageMode === 'THINK') return 'thought';
    return 'chunk';
  }
  return null;
}

function inferType(eventName: string | undefined, payload: unknown): WorkbenchStreamEventType {
  const nuwaxType = inferNuwaxEnvelopeType(payload);
  if (nuwaxType) return nuwaxType;

  const normalized = eventName?.trim().toLowerCase().replace(/[.-]/g, '_') ?? '';
  if (
    ['thought', 'thinking', 'reasoning', 'agent_thought'].includes(normalized)
  ) {
    return 'thought';
  }
  if (
    ['final', 'done', 'complete', 'completed', 'end', 'end_turn'].includes(
      normalized,
    )
  ) {
    return 'final';
  }
  if (['error', 'exception', 'failed'].includes(normalized)) {
    return 'error';
  }
  if (
    ['permission', 'permission_request', 'permission_updated'].includes(
      normalized,
    )
  ) {
    return 'permission';
  }
  if (
    ['processing', 'tool_call', 'tool_use', 'tool_execution'].includes(
      normalized,
    )
  ) {
    return 'processing';
  }

  const record = getRecord(payload);
  const explicitType = readString(record, [['type'], ['event'], ['subType']])
    ?.toLowerCase()
    .replace(/[.-]/g, '_');
  if (explicitType) {
    if (explicitType.includes('thought') || explicitType.includes('reasoning')) {
      return 'thought';
    }
    if (
      explicitType.includes('final') ||
      explicitType.includes('done') ||
      explicitType === 'end_turn'
    ) {
      return 'final';
    }
    if (explicitType.includes('error')) return 'error';
    if (explicitType.includes('permission')) return 'permission';
    if (
      explicitType.includes('processing') ||
      explicitType.includes('tool_call') ||
      explicitType.includes('tool_use')
    ) {
      return 'processing';
    }
  }

  if (readPermission(payload)) return 'permission';
  return 'chunk';
}

function contentFromPayload(payload: unknown): string | undefined {
  if (typeof payload === 'string') return payload;
  const record = getRecord(payload);
  const data = getRecord(record?.data) ?? record;
  const fromNuwax =
    readString(data, [['text'], ['outputText'], ['output_text']]) ??
    readString(record, [['text'], ['outputText'], ['output_text']]);
  if (fromNuwax) return fromNuwax;

  return readString(payload, [
    ['content'],
    ['text'],
    ['message'],
    ['delta'],
    ['data', 'content'],
    ['data', 'text'],
    ['data', 'delta'],
    ['data', 'content', 'text'],
    ['data', 'message'],
    ['choices', '0', 'delta', 'content'],
  ]);
}

function idsFromPayload(
  payload: unknown,
): Pick<WorkbenchStreamEvent, 'conversationId' | 'messageId' | 'requestId'> {
  const record = getRecord(payload);
  const data = getRecord(record?.data) ?? record;
  return {
    conversationId: readString(payload, [
      ['conversationId'],
      ['conversation_id'],
      ['sessionId'],
      ['session_id'],
      ['data', 'conversationId'],
      ['data', 'sessionId'],
    ]),
    messageId: readString(payload, [
      ['messageId'],
      ['message_id'],
      ['id'],
      ['data', 'messageId'],
      ['data', 'id'],
    ]) ?? readString(data, [['id']]),
    requestId: readString(payload, [['requestId'], ['request_id']]),
  };
}

export function normalizeSseMessage(message: RawSseMessage): WorkbenchStreamEvent | null {
  const trimmedData = message.data.trim();
  if (!trimmedData) return null;
  if (trimmedData === '[DONE]' || trimmedData === 'DONE') {
    return { type: 'final', raw: trimmedData };
  }
  if (trimmedData.includes('"ping"') || trimmedData.includes('heartbeat')) {
    return null;
  }

  const payload = parseJsonMaybe(trimmedData);
  const type = inferType(message.event, payload);
  const ids = idsFromPayload(payload);

  if (type === 'permission') {
    const permission = readPermission(payload);
    if (!permission) {
      return {
        type: 'error',
        error: 'Malformed permission event',
        raw: payload,
        ...ids,
      };
    }
   return { type, permission, raw: payload, ...ids };
 }

  if (type === 'mcp_ask') {
    const mcpAsk = readMcpAsk(payload);
    if (!mcpAsk) {
      return {
        type: 'processing',
        content: contentFromPayload(payload) ?? '',
        processingData: getRecord(getRecord(payload)?.data) ?? undefined,
        raw: payload,
        ...ids,
      };
    }
    return { type, mcpAsk, raw: payload, ...ids };
  }

 if (type === 'error') {
    const record = getRecord(payload);
    const data = getRecord(record?.data) ?? record;
    return {
      type,
      error:
        readString(payload, [
          ['error'],
          ['message'],
          ['data', 'error'],
          ['data', 'message'],
        ]) ??
        readString(data, [['error'], ['message']]) ??
        readString(record, [['error']]) ??
        contentFromPayload(payload) ??
        'Unknown stream error',
      raw: payload,
      ...ids,
    };
  }

  if (type === 'processing') {
    const record = getRecord(payload);
    const data = getRecord(record?.data) ?? record;
    return {
      type,
      content: contentFromPayload(payload) ?? '',
      processingData: data ?? undefined,
      raw: payload,
      ...ids,
    };
  }

  return {
    type,
    content: contentFromPayload(payload) ?? '',
    raw: payload,
    ...ids,
  };
}

function parseBlock(block: string): WorkbenchStreamEvent | null {
  const lines = block.split(/\r?\n/);
  const dataLines: string[] = [];
  let event: string | undefined;
  let id: string | undefined;

  for (const line of lines) {
    if (!line || line.startsWith(':')) continue;
    const separator = line.indexOf(':');
    const field = (separator >= 0 ? line.slice(0, separator) : line).replace(
      /^\uFEFF/,
      '',
    );
    const rawValue = separator >= 0 ? line.slice(separator + 1) : '';
    const value = rawValue.startsWith(' ') ? rawValue.slice(1) : rawValue;

    if (field === 'event') event = value;
    if (field === 'id') id = value;
    if (field === 'data') dataLines.push(value);
  }

  if (dataLines.length === 0) return null;
  return normalizeSseMessage({ event, id, data: dataLines.join('\n') });
}

export function createSseParser(): SseParser {
  let buffer = '';

  return {
    feed(chunk: string): WorkbenchStreamEvent[] {
      buffer += chunk;
      const events: WorkbenchStreamEvent[] = [];
      const parts = buffer.split(/\r?\n\r?\n/);
      buffer = parts.pop() ?? '';

      for (const part of parts) {
        const event = parseBlock(part);
        if (event) events.push(event);
      }

      return events;
    },
    flush(): WorkbenchStreamEvent[] {
      const event = buffer.trim() ? parseBlock(buffer) : null;
      buffer = '';
      return event ? [event] : [];
    },
  };
}

export function parseSseText(input: string): WorkbenchStreamEvent[] {
  const parser = createSseParser();
  return [...parser.feed(input), ...parser.flush()];
}

export async function* parseSseStream(
  stream: ReadableStream<Uint8Array>,
): AsyncGenerator<WorkbenchStreamEvent> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  const parser = createSseParser();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = decoder.decode(value, { stream: true });
    for (const event of parser.feed(chunk)) {
      yield event;
    }
  }

  const rest = decoder.decode();
  for (const event of parser.feed(rest)) {
    yield event;
  }
  for (const event of parser.flush()) {
    yield event;
  }
}
