import type { ReactNode } from 'react';
import type { ChatConversation } from '../core';

export interface ChatConversationListProps {
  conversations: ChatConversation[];
  activeConversationId?: string | null;
  onSelect: (conversation: ChatConversation) => void | Promise<void>;
  renderContent?: (conversation: ChatConversation) => ReactNode;
  renderActions?: (conversation: ChatConversation) => ReactNode;
  renderSubtitle?: (conversation: ChatConversation) => ReactNode;
  empty?: ReactNode;
  rowClassName?: string | ((conversation: ChatConversation) => string | undefined);
  buttonClassName?: string | ((conversation: ChatConversation) => string | undefined);
  className?: string;
}

export function ChatConversationList({
  conversations,
  activeConversationId,
  onSelect,
  renderContent,
  renderActions,
  renderSubtitle,
  empty,
  rowClassName,
  buttonClassName,
  className,
}: ChatConversationListProps): JSX.Element {
  if (conversations.length === 0) {
    return <div className={className}>{empty}</div>;
  }
  return (
    <div className={`nuwax-chat-conversation-list${className ? ` ${className}` : ''}`}>
      {conversations.map((conversation) => (
        <article
          key={conversation.id}
          className={`${
            conversation.id === activeConversationId
              ? 'nuwax-chat-conversation nuwax-chat-conversation--active'
              : 'nuwax-chat-conversation'
          }${
            (typeof rowClassName === 'function' ? rowClassName(conversation) : rowClassName)
              ? ` ${typeof rowClassName === 'function' ? rowClassName(conversation) : rowClassName}`
              : ''
          }`}
        >
          <button
            type="button"
            className={
              typeof buttonClassName === 'function'
                ? buttonClassName(conversation)
                : buttonClassName
            }
            onClick={() => void onSelect(conversation)}
          >
            {renderContent?.(conversation) ?? (
              <>
                <strong>{conversation.title}</strong>
                {renderSubtitle?.(conversation) ??
                  (conversation.summary ? <span>{conversation.summary}</span> : null)}
              </>
            )}
          </button>
          {renderActions?.(conversation)}
        </article>
      ))}
    </div>
  );
}
