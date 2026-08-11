/**
 * Message-row + permission-card + empty-state subcomponents for the OpenApp
 * chat shell.
 *
 * Extracted from `NuwaxOpenApp.tsx` so that ChatArea (and any future host) can
 * import these directly without round-tripping through the root file. The
 * rendering behaviour is identical to the pre-extraction inlined versions —
 * the only differences are the import sites for `Icon` / `AgentAvatar` /
 * label types, which now live in their own modules.
 */

import { useMemo, useState } from 'react';
import { ChatMessageItem } from '@nuwax-ai/chat-kit/react';
import { attachments, partsToText, partsToThinking, toolParts } from '@nuwax-ai/chat-kit/core';
import { MarkdownRenderer, type RunOverStep } from '../MarkdownRenderer';
import type {
  WorkbenchAgentDetail,
  WorkbenchGuidQuestion,
  WorkbenchMessage,
  WorkbenchPermissionChoice,
  WorkbenchPermissionRequest,
} from '../../types';
import { AgentAvatar, Icon } from './icons';
import type { Labels } from './labels';
import { applyTemplate, questionText } from './utils';
import { toChatMessage } from '../../adapters/chatKitAdapter';

/**
 * Renders a single transcript row.
 *
 * Thinking trace + RunOver step rendering are driven through
 * `message.metadata`:
 *   - `metadata.thinking`        → string passed to MarkdownRenderer.thinking
 *   - `metadata.runOverSteps`    → RunOverStep[] passed to runOverSteps
 *   - `metadata.runOverStatus`   → 'running' | 'done' | 'error'
 *
 * These are read with a `Record<string, unknown>` cast for now since the
 * wire-protocol shape will be finalized in a follow-up types.ts pass; the
 * rendering side (MarkdownRenderer + RunOver) already accepts the typed
 * contract.
 */
export function ChatMessage({
  message,
  agent,
  labels,
  onFilePreview,
  conversationId,
}: {
  message: WorkbenchMessage;
  agent: WorkbenchAgentDetail | null;
  labels: Labels;
  onFilePreview?: (fileId: string, context?: { conversationId?: string }) => void;
  conversationId?: string;
}): JSX.Element {
  const isUser = message.role === 'user';
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    if (!message.content) return;
    void navigator.clipboard?.writeText(message.content).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    });
  };
  // Render natively from chat-kit structured `parts` when present (the live
  // path always supplies them via fromChatMessage). Fall back to the legacy
  // flat `content` + `metadata` shape for any WorkbenchMessage without parts.
  const parts = message.parts ?? [];
  const hasParts = parts.length > 0;
  const meta = (message.metadata ?? {}) as Record<string, unknown>;
  const text = hasParts ? partsToText(parts) : message.content;
  const thinking = hasParts
    ? partsToThinking(parts)
    : typeof meta.thinking === 'string' && meta.thinking.length > 0
      ? (meta.thinking as string)
      : undefined;
  const runOverSteps: RunOverStep[] | undefined = hasParts
    ? toolParts(parts).map((part) => ({
        id: part.id,
        name: part.name,
        status:
          part.status === 'complete'
            ? 'done'
            : part.status === 'error'
              ? 'error'
              : 'executing',
        durationMs: part.durationMs,
        args:
          typeof part.input === 'string'
            ? part.input
            : part.input == null
              ? undefined
              : JSON.stringify(part.input),
        output:
          typeof part.output === 'string'
            ? part.output
            : part.output == null
              ? undefined
              : JSON.stringify(part.output),
      }))
    : Array.isArray(meta.runOverSteps)
      ? (meta.runOverSteps as RunOverStep[])
      : undefined;
  const runOverStatus =
    meta.runOverStatus === 'running' ||
    meta.runOverStatus === 'done' ||
    meta.runOverStatus === 'error'
      ? (meta.runOverStatus as 'running' | 'done' | 'error')
      : undefined;
  const msgAttachments = hasParts ? attachments(parts) : undefined;
  // Show the streaming spinner inside ThinkingBlock when the assistant is
  // mid-stream but has not emitted final text yet.
  const thinkingStreaming =
    message.status === 'streaming' && !text && !!thinking;
  return (
    <ChatMessageItem
      message={toChatMessage(message)}
      className={
        isUser ? 'open-app-message user' : `open-app-message ${message.kind ?? 'assistant'}`
      }
      header={!isUser && (
        <div className="open-app-message-meta">
          <div className="open-app-message-avatar">
            <AgentAvatar agent={agent} />
          </div>
          <span>{agent?.name || 'Agent'}</span>
        </div>
      )}
      contentClassName="open-app-message-content"
      renderContent={() => (
        <div className="open-app-message-text">
          {!text &&
            !thinking &&
            (!runOverSteps || runOverSteps.length === 0) &&
            message.status === 'streaming' && (
              <span className="open-app-streaming-indicator">
                <span className="open-app-streaming-text">Thinking</span>
                <span className="md-thinking-dots">
                  <span className="md-thinking-dot" />
                  <span className="md-thinking-dot" />
                  <span className="md-thinking-dot" />
                </span>
              </span>
            )}
          {text && isUser && <span>{text}</span>}
          {msgAttachments && msgAttachments.length > 0 && (
            <div className="open-app-message-attachments">
              {msgAttachments.map((attachment, index) => (
                <a
                  key={`${attachment.url}-${index}`}
                  className="open-app-message-attachment"
                  href={attachment.url}
                  target="_blank"
                  rel="noreferrer"
                >
                  <Icon name="attachment" />
                  <span>{attachment.name}</span>
                </a>
              ))}
            </div>
          )}
          {!isUser && (text || thinking || (runOverSteps && runOverSteps.length > 0)) && (
            <MarkdownRenderer
              content={text}
              thinking={thinking}
              thinkingStreaming={thinkingStreaming}
              runOverSteps={runOverSteps}
              runOverStatus={runOverStatus}
              onFilePreview={onFilePreview}
              conversationId={conversationId}
            />
          )}
        </div>
      )}
      actions={!isUser && message.content ? (
        <div className="open-app-message-actions">
          <button
            type="button"
            className="open-app-message-action"
            onClick={handleCopy}
            title={copied ? labels.copied : labels.copy}
            aria-label={copied ? labels.copied : labels.copy}
          >
            <Icon name={copied ? 'check' : 'copy'} />
          </button>
        </div>
      ) : undefined}
    />
  );
}

export function PermissionCard({
  request,
  onRespond,
  labels,
}: {
  request: WorkbenchPermissionRequest;
  onRespond: (choiceId: string) => void;
  labels: Labels;
}): JSX.Element {
  const tc = request.toolCall;

  // Build choices: use structured ACP options if available, otherwise fall
  // back to the flat choices[] or a default allow/reject pair.
  let choices: Array<{
    id: string;
    label: string;
    destructive?: boolean;
    kind?: string;
  }>;

  if (request.choices && request.choices.length > 0) {
    // Filter out reject_always — hidden in UI per nuwax convention.
    choices = request.choices
      .filter((c) => c.kind !== 'reject_always')
      .map((c) => ({ ...c }));
  } else {
    choices = [
      { id: 'once', label: labels.allowOnce },
      { id: 'reject', label: labels.reject, destructive: true },
    ];
  }

  return (
    <div className="open-app-permission-card">
      <div className="open-app-permission-info">
        <div className="open-app-permission-kicker">{labels.permissionTitle}</div>
        <div className="open-app-permission-title">{request.title}</div>
        {request.description && (
          <div className="open-app-permission-desc">{request.description}</div>
        )}
        {tc?.locations && tc.locations.length > 0 && (
          <div className="open-app-permission-locations">
            {tc.locations.map((loc, i) => (
              <span key={i} className="open-app-permission-location">
                {loc.path}
                {loc.line ? `:${loc.line}` : ''}
              </span>
            ))}
          </div>
        )}
      </div>
      <div className="open-app-permission-actions">
        {tc?.kind && (
          <span className="open-app-permission-kind-tag">{tc.kind}</span>
        )}
        {choices.map((choice) => (
          <button
            key={choice.id}
            type="button"
            className={
              choice.destructive ? 'open-app-btn danger' : 'open-app-btn primary'
            }
            onClick={() => onRespond(choice.id)}
          >
            {choice.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * Empty / welcome state shown when a chat session has no messages yet.
 *
 * Optionally renders nuwax-style preset question chips beneath the welcome
 * blurb when the host passes `guidQuestions` + `onSelectQuestion`. ChatArea
 * still renders its own `.open-app-recommend-list` below the transcript, so
 * when those props are omitted (the current call site) the empty state stays
 * identical to its previous appearance.
 */
export function AgentChatEmpty({
  agent,
  labels,
  agentId,
  guidQuestions,
  onSelectQuestion,
}: {
  agent: WorkbenchAgentDetail | null;
  labels: Labels;
  agentId: string;
  guidQuestions?: Array<string | WorkbenchGuidQuestion>;
  onSelectQuestion?: (text: string) => void;
}): JSX.Element {
  const name = agent?.name ?? `Agent ${agentId}`;
  const chips = useMemo(() => {
    if (!guidQuestions || guidQuestions.length === 0) return [] as string[];
    const out: string[] = [];
    for (const item of guidQuestions) {
      const text = typeof item === 'string' ? item.trim() : questionText(item);
      if (text) out.push(text);
    }
    return out;
  }, [guidQuestions]);
  return (
    <div className="open-app-chat-empty">
      <AgentAvatar agent={agent} />
      <h1>{name}</h1>
      <p>{agent?.openingChatMsg || applyTemplate(labels.emptyTitle, { name })}</p>
      {chips.length > 0 && (
        <div className="open-app-empty-questions">
          {chips.map((text, index) => (
            <button
              key={`${text}-${index}`}
              type="button"
              className="open-app-empty-question-chip"
              onClick={() => onSelectQuestion?.(text)}
            >
              {text}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
