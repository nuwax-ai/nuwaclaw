import { useCallback, useEffect, useState, type MouseEvent, type RefObject } from 'react';

/**
 * Drag-resize logic for the chat / preview split container.
 *
 * The hook owns its own `isDragging` flag so PreviewPane can apply the
 * "col-resize" cursor + disable text selection at the document level while a
 * drag is in flight. The parent only needs to keep `splitRatio` as controlled
 * state (so the outer container can apply `gridTemplateColumns`).
 *
 * The drag handler reads the container width via `containerRef` at drag start
 * (mousedown), then installs window-level mousemove/mouseup listeners that
 * clamp the live ratio to [minRatio, maxRatio] and fire `onChange`. Listeners
 * are removed on mouseup.
 */
export interface UsePreviewSplitOptions {
  /** Container whose width is used to compute the ratio. */
  containerRef: RefObject<HTMLElement>;
  /** Notified on every ratio change. */
  onChange: (next: number) => void;
  /** Lower bound for the ratio while dragging (defaults to 0.25). */
  minRatio?: number;
  /** Upper bound for the ratio while dragging (defaults to 0.75). */
  maxRatio?: number;
}

export interface UsePreviewSplitResult {
  isDragging: boolean;
  /** Attach to the split handle's `onMouseDown`. */
  onSplitDragStart: (event: MouseEvent) => void;
}

export function usePreviewSplit(options: UsePreviewSplitOptions): UsePreviewSplitResult {
  const { containerRef, onChange, minRatio = 0.25, maxRatio = 0.75 } = options;
  const [isDragging, setIsDragging] = useState(false);

  const onSplitDragStart = useCallback(
    (event: MouseEvent) => {
      event.preventDefault();
      const container = containerRef.current;
      if (!container) return;
      setIsDragging(true);

      const onMove = (e: globalThis.MouseEvent) => {
        const rect = container.getBoundingClientRect();
        if (rect.width <= 0) return;
        const ratio = (e.clientX - rect.left) / rect.width;
        const clamped = Math.min(maxRatio, Math.max(minRatio, ratio));
        onChange(clamped);
      };
      const onUp = () => {
        setIsDragging(false);
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    },
    [containerRef, maxRatio, minRatio, onChange],
  );

  // Reflect drag state on the body so the col-resize cursor + non-selecting
  // behaviour applies even if the cursor leaves the split-handle mid-drag —
  // mirrors the legacy inline implementation that set these on the outer
  // container.
  useEffect(() => {
    if (!isDragging) return;
    const body = typeof document !== 'undefined' ? document.body : null;
    if (!body) return;
    const prevCursor = body.style.cursor;
    const prevUserSelect = body.style.userSelect;
    body.style.cursor = 'col-resize';
    body.style.userSelect = 'none';
    return () => {
      body.style.cursor = prevCursor;
      body.style.userSelect = prevUserSelect;
    };
  }, [isDragging]);

  return { isDragging, onSplitDragStart };
}
