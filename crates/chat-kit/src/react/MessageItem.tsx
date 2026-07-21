import type { ReactNode } from 'react';
import type { ChatMessage, ChatMessagePart } from '../core';

export interface ChatMessageItemProps {
  message: ChatMessage;
  renderPart?: (part: ChatMessagePart, message: ChatMessage) => ReactNode;
  renderContent?: (message: ChatMessage) => ReactNode;
  header?: ReactNode;
  actions?: ReactNode;
  className?: string;
  contentClassName?: string;
}

export function renderDefaultChatPart(part: ChatMessagePart): ReactNode {
  if (part.type === 'text') return <div className="nuwax-chat-message__text">{part.text}</div>;
  if (part.type === 'thinking') {
    return <details className="nuwax-chat-message__thinking"><summary>Thinking</summary>{part.text}</details>;
  }
  if (part.type === 'attachment') return <a href={part.attachment.url}>{part.attachment.name}</a>;
  if (part.type === 'tool') return <div className="nuwax-chat-message__tool">{part.name} · {part.status}</div>;
  if (part.type === 'error') return <div className="nuwax-chat-message__error">{part.message}</div>;
  return null;
}

export function ChatMessageItem({
  message,
  renderPart,
  renderContent,
  header,
  actions,
  className,
  contentClassName,
}: ChatMessageItemProps): JSX.Element {
  return (
    <article
      className={`nuwax-chat-message nuwax-chat-message--${message.role}${className ? ` ${className}` : ''}`}
      data-message-id={message.id}
    >
      {header}
      <div className={contentClassName}>
        {renderContent
          ? renderContent(message)
          : message.parts.map((part, index) => (
              <div key={`${part.type}-${index}`}>
                {renderPart?.(part, message) ?? renderDefaultChatPart(part)}
              </div>
            ))}
      </div>
      {actions}
    </article>
  );
}
