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

import { useMemo } from 'react';
import { MarkdownRenderer, type RunOverStep } from '../MarkdownRenderer';
import type {
  WorkbenchAgentDetail,
  WorkbenchGuidQuestion,
  WorkbenchMessage,
  WorkbenchPermissionRequest,
} from '../../types';
import { AgentAvatar } from './icons';
import type { Labels } from './labels';
import { applyTemplate, formatTime, questionText } from './utils';

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
  onFilePreview,
  conversationId,
}: {
  message: WorkbenchMessage;
  agent: WorkbenchAgentDetail | null;
  onFilePreview?: (fileId: string, context?: { conversationId?: string }) => void;
  conversationId?: string;
}): JSX.Element {
  const isUser = message.role === 'user';
  // TODO(types): extend WorkbenchMessage / WorkbenchMessageMetadata with
  // dedicated `thinking` + `runOverSteps` fields so the cast goes away.
  const meta = (message.metadata ?? {}) as Record<string, unknown>;
  const thinking =
    typeof meta.thinking === 'string' && meta.thinking.length > 0
      ? (meta.thinking as string)
      : undefined;
  const runOverSteps = Array.isArray(meta.runOverSteps)
    ? (meta.runOverSteps as RunOverStep[])
    : undefined;
  const runOverStatus =
    meta.runOverStatus === 'running' ||
    meta.runOverStatus === 'done' ||
    meta.runOverStatus === 'error'
      ? (meta.runOverStatus as 'running' | 'done' | 'error')
      : undefined;
  // Show the streaming spinner inside ThinkingBlock when the assistant is
  // mid-stream but has not emitted final text yet.
  const thinkingStreaming =
    message.status === 'streaming' && !message.content && !!thinking;
  return (
    <article
      className={
        isUser ? 'open-app-message user' : `open-app-message ${message.kind ?? 'assistant'}`
      }
    >
      <div className="open-app-message-avatar">
        {isUser ? <span>U</span> : <AgentAvatar agent={agent} />}
      </div>
      <div className="open-app-message-content">
        <div className="open-app-message-meta">
          <span>{isUser ? 'You' : agent?.name || 'Agent'}</span>
          <span>{formatTime(message.createdAt)}</span>
        </div>
        <div className="open-app-message-text">
          {!message.content &&
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
          {message.content && isUser && <span>{message.content}</span>}
          {!isUser && (message.content || thinking || runOverSteps) && (
            <MarkdownRenderer
              content={message.content}
              thinking={thinking}
              thinkingStreaming={thinkingStreaming}
              runOverSteps={runOverSteps}
              runOverStatus={runOverStatus}
              onFilePreview={onFilePreview}
              conversationId={conversationId}
            />
          )}
        </div>
      </div>
    </article>
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
  const choices =
    request.choices && request.choices.length > 0
      ? request.choices
      : [
          { id: 'once', label: labels.allowOnce },
          { id: 'reject', label: labels.reject, destructive: true },
        ];
  return (
    <div className="open-app-permission-card">
      <div>
        <div className="open-app-permission-kicker">{labels.permissionTitle}</div>
        <div className="open-app-permission-title">{request.title}</div>
        {request.description && (
          <div className="open-app-permission-desc">{request.description}</div>
        )}
      </div>
      <div className="open-app-permission-actions">
        {choices.map((choice) => (
          <button
            key={choice.id}
            type="button"
            className={choice.destructive ? 'open-app-btn danger' : 'open-app-btn primary'}
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
