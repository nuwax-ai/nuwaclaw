/**
 * Unit tests: transport.ts — buildRequestHeaders
 */

import { describe, it, expect } from 'vitest';
import { buildRequestHeaders } from '../src/transport.js';
import type { StreamableServerEntry, SseServerEntry } from '../src/types.js';

describe('buildRequestHeaders', () => {
  it('returns undefined when no headers or authToken', () => {
    const entry: StreamableServerEntry = { url: 'http://example.com' };
    const result = buildRequestHeaders(entry);
    expect(result).toBeUndefined();
  });

  it('includes custom headers', () => {
    const entry: StreamableServerEntry = {
      url: 'http://example.com',
      headers: { 'X-Custom': 'value', 'X-Other': 'other' },
    };
    const result = buildRequestHeaders(entry);
    expect(result).toEqual({ 'X-Custom': 'value', 'X-Other': 'other' });
  });

  it('adds Bearer authorization from authToken', () => {
    const entry: StreamableServerEntry = {
      url: 'http://example.com',
      authToken: 'my-secret-token',
    };
    const result = buildRequestHeaders(entry);
    expect(result).toEqual({ Authorization: 'Bearer my-secret-token' });
  });

  it('merges headers and authToken', () => {
    const entry: StreamableServerEntry = {
      url: 'http://example.com',
      headers: { 'X-Custom': 'value' },
      authToken: 'token123',
    };
    const result = buildRequestHeaders(entry);
    expect(result).toEqual({
      'X-Custom': 'value',
      Authorization: 'Bearer token123',
    });
  });

  it('authToken overrides Authorization in custom headers', () => {
    const entry: StreamableServerEntry = {
      url: 'http://example.com',
      headers: { Authorization: 'Basic abc' },
      authToken: 'bearer-wins',
    };
    const result = buildRequestHeaders(entry);
    expect(result!.Authorization).toBe('Bearer bearer-wins');
  });

  it('works with SseServerEntry', () => {
    const entry: SseServerEntry = {
      url: 'http://example.com/sse',
      transport: 'sse',
      headers: { 'X-SSE': 'yes' },
      authToken: 'sse-token',
    };
    const result = buildRequestHeaders(entry);
    expect(result).toEqual({
      'X-SSE': 'yes',
      Authorization: 'Bearer sse-token',
    });
  });
});
