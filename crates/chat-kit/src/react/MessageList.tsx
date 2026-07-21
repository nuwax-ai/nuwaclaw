import type { ReactNode } from 'react';
import type { ChatMessage, ChatMessagePart } from '../core';
import { ChatMessageItem } from './MessageItem';

export interface ChatMessageListProps {
  messages: ChatMessage[];
  renderMessage?: (message: ChatMessage) => ReactNode;
  renderPart?: (part: ChatMessagePart, message: ChatMessage) => ReactNode;
  empty?: ReactNode;
  beforeMessages?: ReactNode;
  afterMessages?: ReactNode;
  hasOlder?: boolean;
  loadingOlder?: boolean;
  onLoadOlder?: () => void | Promise<void>;
  loadOlderLabel?: string;
  className?: string;
}

export function ChatMessageList({
  messages,
  renderMessage,
  renderPart,
  empty,
  beforeMessages,
  afterMessages,
  hasOlder = false,
  loadingOlder = false,
  onLoadOlder,
  loadOlderLabel = 'Load earlier messages',
  className,
}: ChatMessageListProps): JSX.Element {
  return (
    <section className={`nuwax-chat-message-list${className ? ` ${className}` : ''}`}>
      {hasOlder && (
        <button type="button" disabled={loadingOlder} onClick={() => void onLoadOlder?.()}>
          {loadingOlder ? 'Loading…' : loadOlderLabel}
        </button>
      )}
      {beforeMessages}
      {messages.length === 0
        ? empty
        : messages.map((message) =>
            renderMessage ? (
              <div key={message.id}>{renderMessage(message)}</div>
            ) : (
              <ChatMessageItem
                key={message.id}
                message={message}
                renderPart={renderPart}
              />
            ),
          )}
      {afterMessages}
    </section>
  );
}
