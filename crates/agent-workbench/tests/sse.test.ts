import { describe, expect, it } from 'vitest';
import { createSseParser, parseSseText } from '../src/sse';

describe('SSE parser', () => {
  it('parses chunk, thought, final, error, and permission events', () => {
    const events = parseSseText(
      [
        'data: plain chunk',
        '',
        'event: thought',
        'data: {"content":"thinking"}',
        '',
        'event: final',
        'data: {"content":"done"}',
        '',
        'event: error',
        'data: {"message":"boom"}',
        '',
        'event: permission',
        'data: {"id":"perm-1","title":"Run command","choices":["once","reject"]}',
        '',
      ].join('\n'),
    );

    expect(events.map((event) => event.type)).toEqual([
      'chunk',
      'thought',
      'final',
      'error',
      'permission',
    ]);
    expect(events[0].content).toBe('plain chunk');
    expect(events[1].content).toBe('thinking');
    expect(events[2].content).toBe('done');
    expect(events[3].error).toBe('boom');
    expect(events[4].permission?.id).toBe('perm-1');
    expect(events[4].permission?.choices?.[0]).toEqual({
      id: 'once',
      label: 'once',
    });
  });

  it('handles chunk boundaries', () => {
    const parser = createSseParser();
    expect(parser.feed('event: thought\ndata: {"content"')).toEqual([]);
    expect(parser.feed(':"split"}\n\n')).toEqual([
      expect.objectContaining({ type: 'thought', content: 'split' }),
    ]);
  });

  it('handles OpenAI-style delta payloads and done sentinels', () => {
    const events = parseSseText(
      [
        'data: {"choices":[{"delta":{"content":"hello"}}]}',
        '',
        'data: [DONE]',
        '',
      ].join('\n'),
    );

    expect(events).toEqual([
      expect.objectContaining({ type: 'chunk', content: 'hello' }),
      expect.objectContaining({ type: 'final' }),
    ]);
  });

  it('parses nuwax ConversationChatResponse eventType envelopes', () => {
    const events = parseSseText(
      [
        'data: {"eventType":"PROCESSING","data":{"text":"working"}}',
        '',
        'data: {"eventType":"MESSAGE","data":{"type":"THINK","text":"reason"}}',
        '',
        'data: {"eventType":"MESSAGE","data":{"type":"CHAT","text":"answer"}}',
        '',
        'data: {"eventType":"FINAL_RESULT","requestId":"req-9","data":{"outputText":"done"}}',
        '',
        'data: {"eventType":"ERROR","error":"failed"}',
        '',
      ].join('\n'),
    );

    expect(events.map((event) => event.type)).toEqual([
      'processing',
      'thought',
      'chunk',
      'final',
      'error',
    ]);
    expect(events[0].content).toBe('working');
    expect(events[0].processingData).toBeDefined();
    expect(events[1].content).toBe('reason');
    expect(events[2].content).toBe('answer');
    expect(events[3].requestId).toBe('req-9');
    expect(events[3].content).toBe('done');
    expect(events[4].error).toBe('failed');
  });

  it('extracts processingData from nuwax PROCESSING events with processingList', () => {
    const events = parseSseText(
      [
        'data: {"eventType":"PROCESSING","data":{"processingList":[{"executeId":"e1","name":"Read file","status":"executing"}]}}',
        '',
      ].join('\n'),
    );

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('processing');
    expect(events[0].processingData).toBeDefined();
    const data = events[0].processingData as Record<string, unknown>;
    expect(Array.isArray(data.processingList)).toBe(true);
    const list = data.processingList as Array<Record<string, unknown>>;
    expect(list[0].name).toBe('Read file');
    expect(list[0].status).toBe('executing');
  });

  it('infers processing type from non-nuwax event names and payloads', () => {
    const events = parseSseText(
      [
        'event: tool_call',
        'data: {"name":"ls","status":"done"}',
        '',
        'event: message',
        'data: {"type":"processing","text":"running"}',
        '',
      ].join('\n'),
    );

    expect(events.map((e) => e.type)).toEqual(['processing', 'processing']);
  });

  it('handles BOM, CRLF, comments, and multi-line data blocks', () => {
    const events = parseSseText(
      [
        '\uFEFF: keepalive',
        'event: thought',
        'data: {"content":',
        'data: "split"}',
        '',
        'event: final',
        'data: done',
        '',
      ].join('\r\n'),
    );

    expect(events).toEqual([
      expect.objectContaining({ type: 'thought', content: 'split' }),
      expect.objectContaining({ type: 'final', content: 'done' }),
    ]);
  });
});
