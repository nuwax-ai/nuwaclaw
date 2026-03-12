/**
 * HTTP headers utilities
 */

import type { StreamableServerEntry, SseServerEntry } from '../types.js';

/**
 * Build HTTP headers from entry config (merge headers + authToken)
 */
export function buildRequestHeaders(
  entry: StreamableServerEntry | SseServerEntry,
): Record<string, string> | undefined {
  const headers: Record<string, string> = {};
  if (entry.headers) {
    Object.assign(headers, entry.headers);
  }
  if (entry.authToken) {
    headers['Authorization'] = `Bearer ${entry.authToken}`;
  }
  return Object.keys(headers).length > 0 ? headers : undefined;
}
