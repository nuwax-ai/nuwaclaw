import type { RefObject } from 'react';
import type {
  WorkbenchAgentDetail,
  WorkbenchApiAdapter,
  WorkbenchConversation,
  WorkbenchMessage,
  WorkbenchModelOption,
  WorkbenchPermissionRequest,
  WorkbenchSkillOption,
} from '../../../types';
import { ChatInputHome } from '../../ChatInputHome';
import { AgentChatEmpty, ChatMessage, PermissionCard } from '../Message';
import { VariableForm } from './VariableFormWrapper';
import type { Labels } from '../labels';
import { questionText } from '../utils';

export type ChatAreaLabels = Labels;

export interface ChatAreaProps {
  // identity
  agent: WorkbenchAgentDetail | null;
  agentId: string;
  adapter: WorkbenchApiAdapter;

  // conversation state
  activeConversation: WorkbenchConversation | null;
  messages: WorkbenchMessage[];
  streaming: boolean;
  permissionRequest: WorkbenchPermissionRequest | null;
  hasMoreMessages: boolean;
  loadingMoreMessages: boolean;
  suggestQuestions: string[];

  // input state (controlled)
  prompt: string;
  onPromptChange: (next: string) => void;
  modelOptions: WorkbenchModelOption[];
  selectedModelId: string | undefined;
  onSelectedModelIdChange: (next: string) => void;
  showModelDropdown: boolean;
  onToggleModelDropdown: () => void;
  agentMode: 'ask' | 'yolo';
  onAgentModeChange: (next: 'ask' | 'yolo') => void;
  selectedSkillIds: string[];
  onSelectedSkillIdsChange: (next: string[]) => void;
  selectedSkills: WorkbenchSkillOption[];
  onSelectedSkillsChange: (next: WorkbenchSkillOption[]) => void;
  showVariableForm: boolean;

  // actions
  onSendPrompt: (text?: string) => void | Promise<void>;
  onSubmitWithUploads: (
    uploaded?: import('../../../types').WorkbenchUploadedFile[],
  ) => void | Promise<void>;
  onStopStream: () => void | Promise<void>;
  onAnswerPermission: (choiceId: string) => void | Promise<void>;
  onLoadMoreMessages: () => void | Promise<void>;
  onSubmitVariableForm: (params: Record<string, unknown>) => void;
  onCancelVariableForm: () => void;

  // refs (for IntersectionObserver, scroll-to-bottom — owned by parent)
  transcriptRef: RefObject<HTMLDivElement>;
  loadMoreSentinelRef: RefObject<HTMLDivElement>;

  // file preview
  onFilePreview?: (fileId: string, context?: { conversationId?: string }) => void;
  conversationId?: string;

  // labels (the shared zh-shaped label dictionary; parent picks zh or en)
  labels: ChatAreaLabels;
}

/**
 * ChatArea — transcript, empty/welcome, permission card, variable form,
 * suggest chips, and ChatInputHome in the BaseTemplate. Intentionally
 * stateless; conversation/input state owned by parent (NuwaxOpenApp).
 */
export function ChatArea(props: ChatAreaProps): JSX.Element {
  const {
    agent,
    agentId,
    adapter,
    activeConversation,
    messages,
    streaming,
    permissionRequest,
    hasMoreMessages,
    loadingMoreMessages,
    suggestQuestions,
    prompt,
    onPromptChange,
    modelOptions,
    selectedModelId,
    onSelectedModelIdChange,
    showModelDropdown,
    onToggleModelDropdown,
    agentMode,
    onAgentModeChange,
    selectedSkillIds,
    onSelectedSkillIdsChange,
    selectedSkills,
    onSelectedSkillsChange,
    showVariableForm,
    onSendPrompt,
    onSubmitWithUploads,
    onStopStream,
    onAnswerPermission,
    onLoadMoreMessages,
    onSubmitVariableForm,
    onCancelVariableForm,
    transcriptRef,
    loadMoreSentinelRef,
    onFilePreview,
    conversationId,
    labels,
  } = props;

  return (
    <div className="open-app-chat-left">
      <div className="open-app-chat-body" ref={transcriptRef}>
        <div ref={loadMoreSentinelRef} />
        {hasMoreMessages && (
          <button
            type="button"
            className="open-app-load-more-messages"
            disabled={loadingMoreMessages}
            onClick={() => void onLoadMoreMessages()}
          >
            {loadingMoreMessages ? labels.loadingMoreMessages : labels.loadMoreMessages}
          </button>
        )}
        {messages.length > 0 ? (
          messages.map((message) => (
            <ChatMessage key={message.id} message={message} agent={agent} onFilePreview={onFilePreview} conversationId={conversationId} />
          ))
        ) : activeConversation && !streaming ? (
          <div className="open-app-loading-indicator">
            <div className="open-app-loading-dots">
              <span />
              <span />
              <span />
            </div>
          </div>
        ) : !activeConversation ? (
          <AgentChatEmpty agent={agent} labels={labels} agentId={agentId} />
        ) : null}
        {agent?.guidQuestionDtos && agent.guidQuestionDtos.length > 0 && messages.length === 0 && (
          <div className="open-app-recommend-list">
            {agent.guidQuestionDtos.map((item, index) => {
              const text = questionText(item);
              if (!text) return null;
              return (
                <button key={`${text}-${index}`} type="button" onClick={() => void onSendPrompt(text)}>
                  {text}
                </button>
              );
            })}
          </div>
        )}
      </div>
      {permissionRequest && (
        <PermissionCard request={permissionRequest} labels={labels} onRespond={onAnswerPermission} />
      )}
      {showVariableForm && agent?.variables && agent.variables.length > 0 && (
        <VariableForm
          variables={agent.variables}
          labels={labels}
          onSubmit={onSubmitVariableForm}
          onCancel={onCancelVariableForm}
        />
      )}
      {suggestQuestions.length > 0 && (
        <div className="open-app-recommend-list">
          {suggestQuestions.map((text, index) => (
            <button key={`${text}-${index}`} type="button" onClick={() => void onSendPrompt(text)}>
              {text}
            </button>
          ))}
        </div>
      )}
      <ChatInputHome
        value={prompt}
        labels={labels}
        disabled={!agent || agent.hasPermission === false}
        streaming={streaming}
        agentMode={agentMode}
        selectedModelId={selectedModelId}
        modelOptions={modelOptions}
        showModelDropdown={showModelDropdown}
        selectedSkillIds={selectedSkillIds}
        selectedSkills={selectedSkills}
        onChange={onPromptChange}
        onSubmit={(uploaded) => void onSubmitWithUploads(uploaded)}
        onStop={() => void onStopStream()}
        onModeChange={onAgentModeChange}
        onModelSelect={onSelectedModelIdChange}
        onToggleModelDropdown={onToggleModelDropdown}
        onSkillIdsChange={onSelectedSkillIdsChange}
        onSelectedSkillsChange={onSelectedSkillsChange}
        adapter={adapter}
        agentId={agentId}
        // Gate @-mention by nuwax `allowAtSkill`. When the agent detail does
        // not declare it (undefined), ChatInputHome defaults to enabled to
        // preserve the previous behavior for mock/dev call paths.
        allowAtSkill={agent?.allowAtSkill}
      />
      <div className="open-app-ai-notice">{labels.contentGenerated}</div>
    </div>
  );
}
