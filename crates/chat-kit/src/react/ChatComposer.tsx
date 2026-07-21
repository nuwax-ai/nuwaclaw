import type { KeyboardEvent, ReactNode, RefObject } from 'react';
import type { ChatDraft } from '../core';

export interface ChatComposerLabels {
  placeholder?: string;
  send?: string;
  stop?: string;
}

export interface ChatComposerProps {
  draft: ChatDraft;
  onDraftChange: (draft: ChatDraft) => void;
  onSend: (draft: ChatDraft) => void | Promise<void>;
  disabled?: boolean;
  streaming?: boolean;
  onStop?: () => void | Promise<void>;
  labels?: ChatComposerLabels;
  beforeInput?: ReactNode;
  afterInput?: ReactNode;
  /**
   * Replaces the default textarea while retaining the shared form, submit and
   * action layout contract. Useful for host editors with mentions or rich text.
   */
  renderEditor?: (props: {
    draft: ChatDraft;
    disabled: boolean;
    submit: () => void;
    onDraftChange: (draft: ChatDraft) => void;
  }) => ReactNode;
  toolbar?: ReactNode;
  /** Replaces the default toolbar/control row for feature-rich host actions. */
  actions?: ReactNode;
  footer?: ReactNode;
  beforeAction?: ReactNode;
  sendContent?: ReactNode;
  stopContent?: ReactNode;
  textareaRef?: RefObject<HTMLTextAreaElement>;
  /** Host-calculated send gate, e.g. completed attachments with empty text. */
  canSend?: boolean;
  actionsClassName?: string;
  toolbarClassName?: string;
  controlsClassName?: string;
  sendButtonClassName?: string;
  stopButtonClassName?: string;
  sendButtonTitle?: string;
  stopButtonTitle?: string;
  className?: string;
}

export function ChatComposer({
  draft,
  onDraftChange,
  onSend,
  disabled = false,
  streaming = false,
  onStop,
  labels,
  beforeInput,
  afterInput,
  renderEditor,
  toolbar,
  actions,
  footer,
  beforeAction,
  sendContent,
  stopContent,
  textareaRef,
  canSend: canSendOverride,
  actionsClassName,
  toolbarClassName,
  controlsClassName,
  sendButtonClassName,
  stopButtonClassName,
  sendButtonTitle,
  stopButtonTitle,
  className,
}: ChatComposerProps): JSX.Element {
  const canSend = !disabled && (canSendOverride ?? draft.text.trim().length > 0);
  const submit = () => {
    if (canSend && !streaming) void onSend(draft);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      submit();
    }
  };

  return (
    <form
      className={`nuwax-chat-composer${className ? ` ${className}` : ''}`}
      onSubmit={(event) => {
        event.preventDefault();
        if (streaming) void onStop?.();
        else submit();
      }}
    >
      {beforeInput}
      <div className="nuwax-chat-composer__input-row">
        {renderEditor ? (
          renderEditor({ draft, disabled, submit, onDraftChange })
        ) : (
          <textarea
            ref={textareaRef}
            value={draft.text}
            disabled={disabled}
            placeholder={labels?.placeholder ?? 'Ask anything'}
            onChange={(event) => onDraftChange({ ...draft, text: event.target.value })}
            onKeyDown={onKeyDown}
          />
        )}
        {afterInput}
      </div>
      {actions ?? (
        <div className={`nuwax-chat-composer__actions${actionsClassName ? ` ${actionsClassName}` : ''}`}>
          <div className={`nuwax-chat-composer__toolbar${toolbarClassName ? ` ${toolbarClassName}` : ''}`}>{toolbar}</div>
          <div className={`nuwax-chat-composer__controls${controlsClassName ? ` ${controlsClassName}` : ''}`}>
            {beforeAction}
            {streaming ? (
              <button
                type="submit"
                className={stopButtonClassName}
                title={stopButtonTitle}
                disabled={!onStop}
              >
                {stopContent ?? labels?.stop ?? 'Stop'}
              </button>
            ) : (
              <button
                type="submit"
                className={sendButtonClassName}
                title={sendButtonTitle}
                disabled={!canSend}
              >
                {sendContent ?? labels?.send ?? 'Send'}
              </button>
            )}
          </div>
        </div>
      )}
      {footer}
    </form>
  );
}
