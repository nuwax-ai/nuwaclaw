import type {
  WorkbenchPermissionChoice,
  WorkbenchPermissionRequest,
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

/**
 * nuwax OpenApp SSE：ConversationChatResponse.eventType
 * 可用值 PROCESSING | MESSAGE | FINAL_RESULT | ERROR
 */
function inferNuwaxEnvelopeType(payload: unknown): WorkbenchStreamEventType | null {
  const record = getRecord(payload);
  if (!record) return null;
  const eventType = readString(record, [['eventType'], ['event_type']])?.toUpperCase();
  if (!eventType) return null;

  if (eventType === 'PROCESSING') return 'thought';
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
