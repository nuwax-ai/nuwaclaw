import { useElapsed, formatElapsed } from './hooks/useElapsed';

export interface ConversationStatusProps {
  streaming: boolean;
  /** Status text to display (e.g., "Thinking...", "Calling tool...") */
  statusText?: string;
}

/**
 * ConversationStatus — shows a real-time elapsed timer and status indicator
 * during streaming. Positioned between message list and chat input, mirroring
 * nuwax's ConversationStatus component.
 *
 * Layout:
 * ┌─────────────────────────────────┐
 * │ [spinner] statusText    02:35   │
 * └─────────────────────────────────┘
 */
export function ConversationStatus({
  streaming,
  statusText = '正在思考...',
}: ConversationStatusProps): JSX.Element | null {
  const elapsed = useElapsed(streaming);

  if (!streaming) return null;

  return (
    <div className="conversation-status">
      <div className="conversation-status-left">
        <span className="conversation-status-spinner" aria-hidden>
          <svg
            viewBox="0 0 24 24"
            width="1em"
            height="1em"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M21 12a9 9 0 1 1-6.219-8.56" />
          </svg>
        </span>
        <span className="conversation-status-text">{statusText}</span>
      </div>
      <div className="conversation-status-timer">
        {formatElapsed(elapsed)}
      </div>
    </div>
  );
}

export default ConversationStatus;
