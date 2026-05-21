/**
 * Shared utility helpers for the OpenApp subtree.
 *
 * These helpers are pure (no React, no DOM beyond `Intl.DateTimeFormat`) and
 * can be safely imported from any component file. They were originally inlined
 * in `NuwaxOpenApp.tsx`; the extraction keeps the same behaviour so existing
 * call sites and snapshots remain identical.
 *
 * NOTE: `createLocalId`, `nowIso`, and `getMessageIndex` ALSO live in
 * `OpenApp/hooks/useConversation.ts` for hook-internal use. The duplicates are
 * intentional — `useConversation.ts` is the canonical source the unit tests
 * exercise, and we keep these copies here so general components do not need to
 * pull in the hook module. The implementations are identical; if you change
 * one, change the other.
 */

import type { WorkbenchAgentDetail, WorkbenchGuidQuestion, WorkbenchMessage } from '../../types';

export function createLocalId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function formatTime(value?: string): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat(undefined, {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

export function applyTemplate(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, key) => values[key] ?? '');
}

export function fallbackAgent(agentId: string): WorkbenchAgentDetail {
  return {
    agentId,
    name: `Agent ${agentId}`,
    customPageMenus: [],
    guidQuestionDtos: [],
    variables: [],
    hasPermission: true,
  };
}

export function isAbsoluteUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

export function normalizeBaseUrl(baseUrl?: string): string {
  return (baseUrl ?? '').replace(/\/+$/, '');
}

export function buildPreviewUrl(baseUrl: string | undefined, path: string): string {
  if (!path) return '';
  if (isAbsoluteUrl(path)) return path;
  return `${normalizeBaseUrl(baseUrl)}${path.startsWith('/') ? path : `/${path}`}`;
}

/**
 * Coerce the various forms of "user-visible question" we get from the host
 * payload (nuwax wire format) into a trimmed string. Empty strings are returned
 * when none of the candidate fields is set, so callers can drop falsy values.
 */
export function questionText(item: WorkbenchGuidQuestion): string {
  return String(item.question ?? item.content ?? item.title ?? item.info ?? '').trim();
}

export function agentInitial(name: string): string {
  return name.trim().slice(0, 1).toUpperCase() || 'A';
}

/** Read the nuwax pagination cursor `index` from a message's metadata bag. */
export function getMessageIndex(message: WorkbenchMessage): number | undefined {
  const meta = message.metadata;
  if (!meta || typeof meta !== 'object') return undefined;
  const raw =
    (meta as Record<string, unknown>).index ??
    (meta as Record<string, unknown>).messageIndex ??
    (meta as Record<string, unknown>).message_index;
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (typeof raw === 'string' && raw.trim()) {
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}
