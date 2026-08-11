import { ChatComposer } from '@nuwax-ai/chat-kit/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type {
  WorkbenchApiAdapter,
  WorkbenchModelOption,
  WorkbenchSkillOption,
  WorkbenchUploadedFile,
} from '../../types';
// Icons and labels live in OpenApp subdirectory.
import { Icon } from '../OpenApp/icons';
import { zh } from '../OpenApp/labels';
import { ChatUploadFile, usePasteUpload } from '../ChatUploadFile';
import { useDragUpload } from '../ChatUploadFile/useDragUpload';
import type { UploadEntry } from '../ChatUploadFile/types';
import { generateUploadId } from '../ChatUploadFile/utils';
import { MentionPopup } from '../MentionPopup';

export interface ChatInputHomeProps {
  value: string;
  disabled: boolean;
  streaming: boolean;
  labels: typeof zh;
  agentMode: 'ask' | 'yolo';
  selectedModelId?: string;
  modelOptions: WorkbenchModelOption[];
  showModelDropdown: boolean;
  selectedSkillIds: string[];
  /**
   * Optional cache of skill metadata for the currently-selected skill ids so
   * the chips can show readable names instead of raw ids. The parent typically
   * updates this whenever `onSelectedSkillsChange` fires.
   */
  selectedSkills?: WorkbenchSkillOption[];
  onChange: (value: string) => void;
  /**
   * Called when the user submits. Receives the list of already-uploaded files
   * collected from the embedded ChatUploadFile entries (status === 'done').
   * The parent should pass these directly to `sendMessage.attachments`
   * without re-uploading.
   */
  onSubmit: (uploaded?: WorkbenchUploadedFile[]) => void;
  onStop: () => void;
  onModeChange: (mode: 'ask' | 'yolo') => void;
  onModelSelect: (modelId: string) => void;
  onToggleModelDropdown: () => void;
  onSkillIdsChange: (ids: string[]) => void;
  /** Mirror of `onSkillIdsChange` that also exposes the picked skill objects. */
  onSelectedSkillsChange?: (skills: WorkbenchSkillOption[]) => void;
  /** Adapter for MentionPopup and ChatUploadFile. */
  adapter: WorkbenchApiAdapter;
  /** Required for MentionPopup's skill listings. */
  agentId: string;
  /**
   * Whether the @-skill mention trigger + popup should be rendered. Mirrors
   * nuwax `AgentDetail.allowAtSkill`. Treated as enabled by default to keep
   * call sites that don't yet thread the agent detail through unchanged.
   */
  allowAtSkill?: boolean;
  /**
   * When true (tenant-level config), paid skills display a price / subscription
   * tag in the MentionPopup. Mirrors nuwax `tenantConfig.enableSubscription`.
   */
  enableSubscription?: boolean;
}

export function ChatInputHome({
  value,
  disabled,
  streaming,
  labels,
  agentMode,
  selectedModelId,
  modelOptions,
  showModelDropdown,
  selectedSkillIds,
  selectedSkills,
  onChange,
  onSubmit,
  onStop,
  onModeChange,
  onModelSelect,
  onToggleModelDropdown,
  onSkillIdsChange,
  onSelectedSkillsChange,
  adapter,
  agentId,
  allowAtSkill = true,
  enableSubscription = false,
}: ChatInputHomeProps) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [mentionOpen, setMentionOpen] = useState(false);
  const [uploadEntries, setUploadEntries] = useState<UploadEntry[]>([]);
  const modelChipRef = useRef<HTMLButtonElement | null>(null);
  const [dropdownPos, setDropdownPos] = useState<{ left: number; bottom: number } | null>(null);

  // Submit guard: don't allow send while any upload is still in flight or
  // queued. Errors are tolerated — the user can either remove them or send
  // anyway (we filter to `done` before passing to the parent).
  const uploadsBusy = uploadEntries.some(
    (e) => e.status === 'pending' || e.status === 'uploading',
  );
  const hasContent =
    value.trim().length > 0 ||
    uploadEntries.some((e) => e.status === 'done');
  const canSend = !streaming && !disabled && !uploadsBusy && hasContent;

  const collectUploaded = useCallback((): WorkbenchUploadedFile[] => {
    const out: WorkbenchUploadedFile[] = [];
    for (const entry of uploadEntries) {
      if (entry.status === 'done' && entry.uploaded) {
        out.push(entry.uploaded);
      }
    }
    return out;
  }, [uploadEntries]);

  const handleSubmit = useCallback(() => {
    if (!canSend) return;
    const uploaded = collectUploaded();
    onSubmit(uploaded.length > 0 ? uploaded : undefined);
    // Reset upload list after submit so the user starts fresh for the next
    // turn. Mirrors the parent clearing `value` synchronously.
    setUploadEntries([]);
  }, [canSend, collectUploaded, onSubmit]);

  const selectedModel = modelOptions.find((m) => m.id === selectedModelId);

  // Hook up clipboard paste — pasted images become pending UploadEntry rows
  // that ChatUploadFile's internal scheduler will pick up automatically.
  const handlePastedFiles = useCallback((files: File[]) => {
    setUploadEntries((prev) => [
      ...prev,
      ...files.map<UploadEntry>((file) => ({
        id: generateUploadId(),
        localFile: file,
        status: 'pending',
        progress: 0,
      })),
    ]);
  }, []);

  usePasteUpload({
    targetRef: textareaRef,
    onFiles: handlePastedFiles,
    disabled: streaming,
  });

  const formRef = useRef<HTMLDivElement>(null);

  // Drag-and-drop file upload (mirrors nuwax commit 9341a145)
  const { isDragging } = useDragUpload({
    targetRef: formRef,
    onFiles: handlePastedFiles,
    disabled: streaming,
  });

  // Resolve skill chip labels: prefer the parent-supplied metadata map, fall
  // back to the raw id if no metadata is available.
  const skillNameById = useCallback(
    (id: string): string => {
      const hit = selectedSkills?.find((s) => s.id === id);
      return hit?.name ?? id;
    },
    [selectedSkills],
  );

  const removeSkill = useCallback(
    (id: string) => {
      const nextIds = selectedSkillIds.filter((s) => s !== id);
      onSkillIdsChange(nextIds);
      if (onSelectedSkillsChange && selectedSkills) {
        onSelectedSkillsChange(selectedSkills.filter((s) => s.id !== id));
      }
    },
    [
      onSelectedSkillsChange,
      onSkillIdsChange,
      selectedSkillIds,
      selectedSkills,
    ],
  );

  const handleMentionSelect = useCallback(
    (skill: WorkbenchSkillOption) => {
      if (!selectedSkillIds.includes(skill.id)) {
        onSkillIdsChange([...selectedSkillIds, skill.id]);
      }
      if (onSelectedSkillsChange) {
        const existing = selectedSkills ?? [];
        if (!existing.some((s) => s.id === skill.id)) {
          onSelectedSkillsChange([...existing, skill]);
        }
      }
      setMentionOpen(false);
      // Restore focus to the textarea so the user can continue typing.
      textareaRef.current?.focus();
    },
    [
      onSelectedSkillsChange,
      onSkillIdsChange,
      selectedSkillIds,
      selectedSkills,
    ],
  );

  // Close mention popup automatically while streaming so users can't pick a
  // new skill mid-stream and end up with a confusing send.
  useEffect(() => {
    if (streaming) setMentionOpen(false);
  }, [streaming]);

  // Compute the model dropdown position from the chip button rect so it can
  // be rendered in a portal (document.body) and escape the chat input's
  // `overflow: hidden`.  Recompute on scroll/resize while open.
  useEffect(() => {
    if (!showModelDropdown) {
      setDropdownPos(null);
      return;
    }
    const compute = () => {
      const el = modelChipRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      setDropdownPos({ left: rect.left, bottom: window.innerHeight - rect.top + 4 });
    };
    compute();
    window.addEventListener('scroll', compute, true);
    window.addEventListener('resize', compute);
    return () => {
      window.removeEventListener('scroll', compute, true);
      window.removeEventListener('resize', compute);
    };
  }, [showModelDropdown]);


  return (
    <>
    <div ref={formRef}>
    <ChatComposer
      draft={{
        text: value,
        attachments: [],
        skillIds: selectedSkillIds,
        modelId: selectedModelId,
        agentMode,
      }}
      onDraftChange={(draft) => onChange(draft.text)}
      onSend={handleSubmit}
      onStop={onStop}
      disabled={disabled || streaming}
      streaming={streaming}
      canSend={canSend}
      textareaRef={textareaRef}
      className={isDragging ? 'open-app-chat-input-home drag-over' : 'open-app-chat-input-home'}
      actionsClassName="open-app-input-footer"
      toolbarClassName="open-app-input-tools"
      controlsClassName="open-app-right-actions"
      sendButtonClassName="open-app-send-button"
      stopButtonClassName="open-app-send-button streaming"
      sendButtonTitle={labels.send}
      stopButtonTitle={labels.stop}
      labels={{
        placeholder: labels.inputPlaceholder,
        send: labels.send,
        stop: labels.stop,
      }}
      sendContent={<Icon name="send" />}
      stopContent={<Icon name="stop" />}
      beforeInput={isDragging && (
        <div className="open-app-drag-overlay">
          <div className="open-app-drag-overlay-text">
            {labels.dropFilesHere}
          </div>
        </div>
      )}
      afterInput={selectedSkillIds.length > 0 && (
        <div className="open-app-skill-chips">
          {selectedSkillIds.map((id) => (
            <span key={id} className="open-app-skill-chip">
              @{skillNameById(id)}
              <button
                type="button"
                onClick={() => removeSkill(id)}
                disabled={streaming}
              >
                &times;
              </button>
            </span>
          ))}
        </div>
      )}
      toolbar={(
        <>
         {allowAtSkill && (
           <div style={{ position: 'relative' }}>
             <button
               type="button"
               title={labels.mentionSkill}
               disabled={disabled || streaming}
               onClick={() => setMentionOpen((v) => !v)}
               data-testid="open-app-mention-trigger"
             >
               @
             </button>
             {mentionOpen && (
               <div
                 style={{
                   position: 'absolute',
                   bottom: '100%',
                   left: 0,
                   marginBottom: 4,
                 }}
               >
                <MentionPopup
                  open={mentionOpen}
                  agentId={agentId}
                  adapter={adapter}
                  onSelect={handleMentionSelect}
                  onClose={() => setMentionOpen(false)}
                   enableSubscription={enableSubscription}
                  labels={{
                    tabAll: labels.skillTabAll,
                    tabRecent: labels.skillTabRecent,
                    tabCollect: labels.skillTabCollect,
                    empty: labels.noSkills,
                    loading: labels.loadingMoreMessages,
                    loadingMore: labels.loadingMoreMessages,
                     paidTag: labels.skillPaidTag,
                     subscribedTag: labels.skillSubscribedTag,
                  }}
                />
               </div>
             )}
           </div>
         )}
         <ChatUploadFile
           adapter={adapter}
           entries={uploadEntries}
           onEntriesChange={setUploadEntries}
           maxFileSize={50 * 1024 * 1024}
           multiple
           disabled={disabled || streaming}
           labels={{
             upload: labels.uploadAttachment,
             uploading: labels.uploadAttachment,
           }}
         />
          <div className="open-app-mode-segment" aria-label={labels.agentMode}>
            <button
              type="button"
              className={agentMode === 'ask' ? 'active' : ''}
              disabled={disabled || streaming}
              onClick={() => onModeChange('ask')}
            >
              {labels.askMode}
            </button>
            <button
              type="button"
              className={agentMode === 'yolo' ? 'active' : ''}
              disabled={disabled || streaming}
              onClick={() => onModeChange('yolo')}
            >
              {labels.yoloMode}
            </button>
          </div>
        </>
      )}
      beforeAction={(
         <div className="open-app-model-chip-wrapper">
          <button
            className="open-app-model-chip"
            type="button"
            disabled={disabled || streaming}
            onClick={onToggleModelDropdown}
            ref={modelChipRef}
          >
            <span>{selectedModel?.name ?? labels.model}</span>
          </button>
         </div>
      )}
    />
    </div>
    {showModelDropdown && dropdownPos && createPortal(
      <div
        className="open-app-model-dropdown"
        style={{ left: dropdownPos.left, bottom: dropdownPos.bottom }}
      >
        {modelOptions.length > 0 ? (
          modelOptions.map((model) => (
            <button
              key={model.id}
              type="button"
              className={model.id === selectedModelId ? 'active' : ''}
              onClick={() => {
                onModelSelect(model.id);
                onToggleModelDropdown();
              }}
            >
              {model.name}
            </button>
          ))
        ) : (
          <div className="open-app-model-empty">{labels.noModels}</div>
        )}
      </div>,
      document.body,
    )}
    </>
  );
}
