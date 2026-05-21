import type { RefObject } from 'react';
import type { WorkbenchHostBridge } from '../../../types';
import { PagePreviewIframe } from '../../business-component/PagePreviewIframe';
import { zh as nuwaxOpenAppLabelsZh, type Labels } from '../labels';
import { usePreviewSplit } from './usePreviewSplit';

/**
 * Subset of the NuwaxOpenApp label dictionary that is actually read by the
 * preview header (refresh / back / forward / copyLink / openInNewWindow /
 * close), plus `pagePreview` used as the iframe title.
 *
 * PreviewPane accepts the full nuwax label dictionary (and forwards it
 * verbatim to `PagePreviewIframe`) so callers don't have to re-shape labels.
 */
export type PreviewPaneLabels = Labels;

export interface PreviewPaneProps {
  /** URL to render inside the preview iframe / webview. `null` collapses the pane. */
  previewUrl: string | null;
  /** Current split ratio (controlled). Parent applies it to its grid template. */
  splitRatio: number;
  /** Called whenever the user drags the split handle. */
  onSplitRatioChange: (next: number) => void;
  /** Called when the user clicks the close button on the preview header. */
  onClose: () => void;
  /**
   * Ref to the outer container that hosts both the chat area and the preview.
   * Drag math computes `(clientX - rect.left) / rect.width` against it; the
   * parent must attach this ref to the same element it sizes via
   * `gridTemplateColumns: ${splitRatio}fr ${1 - splitRatio}fr`.
   */
  containerRef: RefObject<HTMLElement>;
  hostBridge?: WorkbenchHostBridge;
  /** Forwarded to `PagePreviewIframe`. `'electron-webview'` selects the native webview. */
  previewContainer?: string;
  /** Full label dictionary (matches the zh shape used by NuwaxOpenApp). */
  labels?: PreviewPaneLabels;
}

/**
 * Right-side preview pane for the OpenApp chat shell.
 *
 * Renders the drag handle + `PagePreviewIframe` when `previewUrl` is set, and
 * returns `null` otherwise so the parent grid collapses to chat-only. The
 * mousedown / mousemove / mouseup drag pipeline is owned by `usePreviewSplit`
 * and operates against the parent's `containerRef`.
 *
 * Extracted from `NuwaxOpenApp.tsx` (Phase B follow-up) to give the chat-shell
 * a stable component boundary and to allow other "open-app" hosts to embed
 * the same preview UI without re-implementing the split handle.
 */
export function PreviewPane(props: PreviewPaneProps): JSX.Element | null {
  const {
    previewUrl,
    onSplitRatioChange,
    onClose,
    containerRef,
    hostBridge,
    previewContainer,
    labels,
  } = props;

  // Hook order must stay stable across renders, so always call usePreviewSplit
  // before the `previewUrl` null-check.
  const { onSplitDragStart } = usePreviewSplit({
    containerRef,
    onChange: onSplitRatioChange,
  });

  if (!previewUrl) return null;

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
        <PagePreviewIframe
          url={previewUrl}
          title={effectiveLabels.pagePreview}
          labels={effectiveLabels}
          previewContainer={previewContainer}
          hostBridge={hostBridge}
          onClose={onClose}
        />
      </div>
    </>
  );
}
