import type { RefObject } from 'react';
import type { PreviewState, WorkbenchHostBridge } from '../../../types';
import { FilePreview } from '../../business-component/FilePreview';
import { PagePreviewIframe } from '../../business-component/PagePreviewIframe';
import { zh as nuwaxOpenAppLabelsZh, type Labels } from '../labels';
import { usePreviewSplit } from './usePreviewSplit';

export type PreviewPaneLabels = Labels;

export interface PreviewPaneProps {
  /** Discriminated preview state (page URL, file descriptor, or none). */
  previewState: PreviewState;
  /** Current split ratio (controlled). Parent applies it to its grid template. */
  splitRatio: number;
  /** Called whenever the user drags the split handle. */
  onSplitRatioChange: (next: number) => void;
  /** Called when the user clicks the close button on the preview header. */
  onClose: () => void;
  containerRef: RefObject<HTMLElement>;
  hostBridge?: WorkbenchHostBridge;
  previewContainer?: string;
  labels?: PreviewPaneLabels;
}

export function PreviewPane(props: PreviewPaneProps): JSX.Element | null {
  const {
    previewState,
    onSplitRatioChange,
    onClose,
    containerRef,
    hostBridge,
    previewContainer,
    labels,
  } = props;

  const { onSplitDragStart } = usePreviewSplit({
    containerRef,
    onChange: onSplitRatioChange,
  });

  if (previewState.kind === 'none') return null;

  const effectiveLabels = labels ?? nuwaxOpenAppLabelsZh;

  return (
    <>
      <div
        className="open-app-split-handle"
        onMouseDown={onSplitDragStart}
        role="separator"
        aria-orientation="vertical"
      />
      <div className="open-app-chat-right">
        {previewState.kind === 'page' ? (
          <PagePreviewIframe
            url={previewState.url}
            title={effectiveLabels.pagePreview}
            labels={effectiveLabels}
            previewContainer={previewContainer}
            hostBridge={hostBridge}
            onClose={onClose}
          />
        ) : (
          <FilePreview
            src={previewState.descriptor.src}
            fileName={previewState.descriptor.fileName}
            fileType={previewState.descriptor.fileType}
            content={previewState.descriptor.content}
            staticFileBasePath={previewState.descriptor.staticFileBasePath}
            onClose={onClose}
          />
        )}
      </div>
    </>
  );
}
