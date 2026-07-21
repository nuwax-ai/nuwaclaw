import { useMemo } from 'react';
import { ChatConversationList } from '@nuwax-ai/chat-kit/react';
import type { WorkbenchConversation } from '../../../types';
import { toChatConversation } from '../../../adapters/chatKitAdapter';
import { formatTime } from '../utils';

export interface HistoryConversationLabels {
  historyTitle: string;
  searchPlaceholder: string;
  rename: string;
  delete: string;
  share: string;
  firstConversationTip?: string;
}

export interface HistoryConversationProps {
  conversations: WorkbenchConversation[];
  historyKeyword: string;
  onKeywordChange: (next: string) => void;
  onLoadConversation: (conversation: WorkbenchConversation) => void | Promise<void>;
  onRenameConversation: (conversation: WorkbenchConversation) => void | Promise<void>;
  onDeleteConversation: (conversation: WorkbenchConversation) => void | Promise<void>;
  onShareConversation?: (conversation: WorkbenchConversation) => void | Promise<void>;
  onClose: () => void;
  labels: HistoryConversationLabels;
  /** Pre-computed filtered list. Caller is responsible for filtering. */
  filteredConversations?: WorkbenchConversation[];
}

export function HistoryConversation(props: HistoryConversationProps): JSX.Element {
  const {
    conversations,
    historyKeyword,
    onKeywordChange,
    onLoadConversation,
    onRenameConversation,
    onDeleteConversation,
    onShareConversation,
    onClose,
    labels,
    filteredConversations,
  } = props;

  const items = useMemo(() => {
    if (filteredConversations) return filteredConversations;
    const keyword = historyKeyword.trim().toLowerCase();
    if (!keyword) return conversations;
    return conversations.filter((item) => item.title.toLowerCase().includes(keyword));
  }, [conversations, filteredConversations, historyKeyword]);

  return (
    <section className="open-app-history-page">
      <button className="open-app-close-history" type="button" onClick={onClose}>
        x
      </button>
      <h1>{labels.historyTitle}</h1>
      <input
        value={historyKeyword}
        onChange={(event) => onKeywordChange(event.target.value)}
        placeholder={labels.searchPlaceholder}
      />
      <ChatConversationList
        className="open-app-history-page-list"
        rowClassName="open-app-history-page-item"
        conversations={items.map(toChatConversation)}
        onSelect={(conversation) => {
          const source = items.find((item) => item.id === conversation.id);
          if (source) void onLoadConversation(source);
        }}
        renderSubtitle={(conversation) => (
          <>
            {conversation.summary && <span>{conversation.summary}</span>}
            <span>{formatTime(conversation.updatedAt)}</span>
          </>
        )}
        renderActions={(conversation) => {
          const item = items.find((candidate) => candidate.id === conversation.id);
          if (!item) return null;
          return (
            <div className="open-app-history-page-actions">
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  void onRenameConversation(item);
                }}
              >
                {labels.rename}
              </button>
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  void onDeleteConversation(item);
                }}
              >
                {labels.delete}
              </button>
              {onShareConversation && (
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    void onShareConversation(item);
                  }}
                >
                  {labels.share}
                </button>
              )}
            </div>
          );
        }}
      />
    </section>
  );
}
