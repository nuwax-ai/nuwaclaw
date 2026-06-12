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

describe('SSE parser — ACP structured permission events', () => {
  it('parses acpRequestPermission messageType event', () => {
    const events = parseSseText(
      [
        'data: {"eventType":"PROCESSING","data":{"messageType":"acpRequestPermission","subType":"AcpRequestPermission","data":{"sessionId":"s1","tool_call_id":"tc1","request_permission_request":{"sessionId":"s1","toolCall":{"toolCallId":"tc1","title":"Edit file.ts","kind":"edit","status":"pending","locations":[{"path":"/src/file.ts","line":42}]},"options":[{"optionId":"opt-1","kind":"allow_once","name":"Allow once"},{"optionId":"opt-2","kind":"allow_always","name":"Allow always"},{"optionId":"opt-3","kind":"reject_once","name":"Reject"},{"optionId":"opt-4","kind":"reject_always","name":"Reject always"}]}}}}',
        '',
      ].join('\n'),
    );
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('permission');
    const perm = events[0].permission!;
    expect(perm.id).toContain('s1');
    expect(perm.title).toBe('Edit file.ts');
    expect(perm.toolCall?.kind).toBe('edit');
    expect(perm.toolCall?.locations?.[0].path).toBe('/src/file.ts');
    expect(perm.choices).toHaveLength(4);
    expect(perm.choices?.[0]).toEqual({
      id: 'opt-1', label: 'Allow once', kind: 'allow_once', destructive: false,
    });
    expect(perm.choices?.[3]).toEqual({
      id: 'opt-4', label: 'Reject always', kind: 'reject_always', destructive: true,
    });
  });

  it('parses PROCESSING event with nested result.input.request_permission_request', () => {
    const events = parseSseText(
      [
        'data: {"eventType":"PROCESSING","data":{"subEventType":"REQUEST_PERMISSION","result":{"input":{"request_permission_request":{"sessionId":"s2","tool_call_id":"tc2","toolCall":{"toolCallId":"tc2","title":"Run command","kind":"execute"},"options":[{"optionId":"a1","kind":"allow_once","name":"Yes"},{"optionId":"r1","kind":"reject_once","name":"No"}]}}}}}',
        '',
      ].join('\n'),
    );
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('permission');
    expect(events[0].permission?.title).toBe('Run command');
    expect(events[0].permission?.toolCall?.kind).toBe('execute');
    expect(events[0].permission?.choices).toHaveLength(2);
  });

  it('parses intervention-wrapped ACP permission', () => {
    const events = parseSseText(
      [
        'data: {"eventType":"PROCESSING","data":{"_intervention":{"id":"itv-abc","sessionId":"s3","acp":{"method":"session/request_permission","request":{"sessionId":"s3","toolCall":{"toolCallId":"tc3","title":"Delete file","kind":"delete","locations":[{"path":"/tmp/danger.txt"}]},"options":[{"optionId":"ok","kind":"allow_once","name":"Allow"},{"optionId":"no","kind":"reject_once","name":"Deny"}]}}}}}',
        '',
      ].join('\n'),
    );
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('permission');
    expect(events[0].permission?.id).toBe('itv-abc');
    expect(events[0].permission?.title).toBe('Delete file');
    expect(events[0].permission?.toolCall?.kind).toBe('delete');
  });

  it('still handles flat permission events (backwards compatible)', () => {
    const events = parseSseText(
      [
        'event: permission',
        'data: {"id":"p-old","title":"Old style","choices":[{"id":"yes","label":"OK"}]}',
        '',
      ].join('\n'),
    );
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('permission');
    expect(events[0].permission?.id).toBe('p-old');
    expect(events[0].permission?.title).toBe('Old style');
    expect(events[0].permission?.choices?.[0]).toEqual({ id: 'yes', label: 'OK', destructive: false });
  });
});

describe('SSE parser — MCP Ask (nuwax_ask_question) events', () => {
  it('parses tool_call event with nuwax_ask_question raw_input', () => {
    const payload = JSON.stringify({
      eventType: 'PROCESSING',
      data: {
        subType: 'tool_call',
        tool_call_id: 'tc-ask-1',
        raw_input: {
          toolName: 'nuwax_ask_question',
          schemaVersion: 'nuwaclaw.mcp_ask.v1',
          requestId: 'req-1',
          revision: 1,
          sessionId: 's1',
          title: 'Choose option',
          ui: {
            version: 'nuwaclaw.interaction.v1',
            presentation: 'inline',
            title: 'Choose option',
            schema: {
              type: 'object',
              properties: {
                choice: { type: 'string', enum: ['a', 'b'], title: 'Choice' },
              },
              required: ['choice'],
            },
          },
        },
      },
    });
    const events = parseSseText(`data: ${payload}\n\n`);
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('mcp_ask');
    expect(events[0].mcpAsk?.input.requestId).toBe('req-1');
    expect(events[0].mcpAsk?.input.title).toBe('Choose option');
    expect(events[0].mcpAsk?.toolCallId).toBe('tc-ask-1');
    expect(events[0].mcpAsk?.input.ui.presentation).toBe('inline');
  });

  it('parses PROCESSING event with result.input containing mcp_ask data', () => {
    const payload = JSON.stringify({
      eventType: 'PROCESSING',
      data: {
        executeId: 'tc-ask-2',
        result: {
          input: {
            toolName: 'nuwax_ask_question',
            schemaVersion: 'nuwax.mcp_ask.v1',
            requestId: 'req-2',
            revision: 1,
            sessionId: 's2',
            title: 'Feedback',
            ui: {
              version: 'nuwax.interaction.v1',
              presentation: 'modal',
              title: 'Feedback',
              schema: {
                type: 'object',
                properties: {
                  rating: { type: 'string', enum: ['good', 'bad'] },
                },
              },
            },
          },
        },
      },
    });
    const events = parseSseText(`data: ${payload}\n\n`);
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('mcp_ask');
    expect(events[0].mcpAsk?.input.requestId).toBe('req-2');
    expect(events[0].mcpAsk?.toolCallId).toBe('tc-ask-2');
  });

  it('falls back to processing when raw_input is not an mcp_ask tool', () => {
    const payload = JSON.stringify({
      eventType: 'PROCESSING',
      data: {
        subType: 'tool_call',
        tool_call_id: 'tc-other',
        raw_input: { toolName: 'read_file', path: '/tmp/test.txt' },
      },
    });
    const events = parseSseText(`data: ${payload}\n\n`);
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('processing');
  });
});
