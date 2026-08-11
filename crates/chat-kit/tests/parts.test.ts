import { describe, expect, it } from 'vitest';
import type { ChatMessagePart } from '../src/core/types';
import {
  attachments,
  errorMessage,
  findPendingInteraction,
  firstPart,
  hasAttachment,
  partsToText,
  partsToThinking,
  selectParts,
  toolParts,
} from '../src/core/parts';

const parts: ChatMessagePart[] = [
  { type: 'thinking', text: 'reasoning…', status: 'complete' },
  { type: 'text', text: 'Hello ' },
  { type: 'text', text: 'world' },
  {
    type: 'tool',
    id: 't1',
    name: 'search',
    status: 'complete',
    input: { q: 'x' },
    output: { hits: 2 },
    durationMs: 12,
  },
  { type: 'attachment', attachment: { url: 'u', name: 'f.pdf', mimeType: 'application/pdf' } },
  {
    type: 'interaction',
    id: 'p1',
    kind: 'permission',
    status: 'pending',
    payload: { id: 'p1' },
  },
  { type: 'error', message: 'boom' },
];

describe('selectParts / firstPart', () => {
  it('selectParts narrows to the requested variant', () => {
    const tools = selectParts(parts, 'tool');
    expect(tools).toHaveLength(1);
    // narrowed: tool-specific field accessible without casting
    expect(tools[0].input).toEqual({ q: 'x' });
  });

  it('firstPart returns the first match narrowed, or undefined', () => {
    expect(firstPart(parts, 'error')?.message).toBe('boom');
    expect(firstPart(parts, 'thinking')?.status).toBe('complete');
    expect(firstPart(parts, 'text')?.text).toBe('Hello ');
  });
});

describe('text / thinking projection', () => {
  it('partsToText concatenates text parts in order', () => {
    expect(partsToText(parts)).toBe('Hello world');
  });

  it('partsToThinking concatenates thinking parts in order', () => {
    expect(partsToThinking(parts)).toBe('reasoning…');
  });

  it('returns empty string when no part of the type exists', () => {
    expect(partsToText([])).toBe('');
    expect(partsToThinking([parts[1]!])).toBe('');
  });
});

describe('tool / attachment / error selectors', () => {
  it('toolParts returns ChatToolPart[]', () => {
    const tools = toolParts(parts);
    expect(tools).toHaveLength(1);
    expect(tools[0]?.name).toBe('search');
  });

  it('attachments flattens attachment parts', () => {
    expect(attachments(parts)).toEqual([
      { url: 'u', name: 'f.pdf', mimeType: 'application/pdf' },
    ]);
    expect(hasAttachment(parts)).toBe(true);
    expect(hasAttachment([parts[1]!])).toBe(false);
  });

  it('errorMessage surfaces the first error message', () => {
    expect(errorMessage(parts)).toBe('boom');
    expect(errorMessage([parts[1]!])).toBeUndefined();
  });
});

describe('findPendingInteraction', () => {
  it('returns the first unresolved interaction (pending/submitting/absent)', () => {
    expect(findPendingInteraction(parts)?.id).toBe('p1');
  });

  it('skips resolved interactions', () => {
    const resolved: ChatMessagePart[] = [
      { type: 'interaction', id: 'a', kind: 'permission', status: 'complete', payload: {} },
      { type: 'interaction', id: 'b', kind: 'question', status: 'error', payload: {} },
    ];
    expect(findPendingInteraction(resolved)).toBeUndefined();
  });

  it('treats absent status as pending', () => {
    const noStatus: ChatMessagePart[] = [
      { type: 'interaction', id: 'c', kind: 'permission', payload: {} },
    ];
    expect(findPendingInteraction(noStatus)?.id).toBe('c');
  });
});
