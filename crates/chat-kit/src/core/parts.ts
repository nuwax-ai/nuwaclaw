// Read-only selectors and constructors over `ChatMessagePart[]`.
//
// The streaming reducer (`reducer.ts`) owns live mutation of a message's
// parts during a stream. This module provides the complementary read side:
// lossless projections that consumers (adapters hydrating history from a
// flat payload, renderers walking parts) need in both NuwaClaw Agent Mode
// and Nuwax Web. Pure functions only — no mutation, no React.

import type {
  ChatAttachment,
  ChatInteractionPart,
  ChatMessagePart,
  ChatToolPart,
} from './types';

/**
 * All parts of a given type, narrowed to that variant.
 *
 * `selectParts(parts, 'tool')` returns `ChatToolPart[]` (not the union),
 * so callers can read tool-specific fields without further narrowing.
 */
export function selectParts<T extends ChatMessagePart['type']>(
  parts: ChatMessagePart[],
  type: T,
): Extract<ChatMessagePart, { type: T }>[] {
  return parts.filter(
    (part): part is Extract<ChatMessagePart, { type: T }> => part.type === type,
  );
}

/** First part of a given type, if any (narrowed). */
export function firstPart<T extends ChatMessagePart['type']>(
  parts: ChatMessagePart[],
  type: T,
): Extract<ChatMessagePart, { type: T }> | undefined {
  return parts.find(
    (part): part is Extract<ChatMessagePart, { type: T }> => part.type === type,
  );
}

export const textParts = (parts: ChatMessagePart[]) =>
  selectParts(parts, 'text');
export const thinkingParts = (parts: ChatMessagePart[]) =>
  selectParts(parts, 'thinking');
export const toolParts = (parts: ChatMessagePart[]): ChatToolPart[] =>
  selectParts(parts, 'tool');
export const attachmentParts = (parts: ChatMessagePart[]) =>
  selectParts(parts, 'attachment');
export const interactionParts = (parts: ChatMessagePart[]): ChatInteractionPart[] =>
  selectParts(parts, 'interaction');
export const errorParts = (parts: ChatMessagePart[]) =>
  selectParts(parts, 'error');

/** Concatenate every text part's text, in order. */
export function partsToText(parts: ChatMessagePart[]): string {
  return textParts(parts)
    .map((part) => part.text)
    .join('');
}

/** Concatenate every thinking part's text, in order. */
export function partsToThinking(parts: ChatMessagePart[]): string {
  return thinkingParts(parts)
    .map((part) => part.text)
    .join('');
}

/** First error part's message, if the message carries an error. */
export function errorMessage(parts: ChatMessagePart[]): string | undefined {
  return firstPart(parts, 'error')?.message;
}

/** Flatten attachment parts into their `ChatAttachment` payloads. */
export function attachments(parts: ChatMessagePart[]): ChatAttachment[] {
  return attachmentParts(parts).map((part) => part.attachment);
}

/**
 * The first interaction part that still needs the user to act, or undefined.
 *
 * "Pending" = no terminal status yet: `pending` / `submitting` / absent.
 * Resolved interactions (`complete` / `error`) are skipped so a renderer can
 * locate the live permission / question card attached to a turn.
 */
export function findPendingInteraction(
  parts: ChatMessagePart[],
): ChatInteractionPart | undefined {
  return interactionParts(parts).find(
    (part) =>
      part.status === 'pending' ||
      part.status === 'submitting' ||
      part.status === undefined,
  );
}

/** True if the part list carries any attachment. */
export function hasAttachment(parts: ChatMessagePart[]): boolean {
  return parts.some((part) => part.type === 'attachment');
}
