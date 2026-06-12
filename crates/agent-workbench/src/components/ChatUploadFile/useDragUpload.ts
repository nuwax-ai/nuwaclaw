/*
 * useDragUpload — drag-and-drop file upload hook.
 *
 * Mirrors the drag-drop handler in nuwax ChatInputHome (commit 9341a145):
 * when the user drags one or more files over the chat input area, a
 * semi-transparent overlay is shown. On drop, the files are forwarded to
 * the upload pipeline.
 *
 * Uses a dragCounter to handle nested dragenter/dragleave without flicker.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';

export interface UseDragUploadOptions {
  /** Element ref the drag handlers should attach to. */
  targetRef: RefObject<HTMLElement>;
  /** Called with dropped File[]. */
  onFiles: (files: File[]) => void;
  /** When true, skip attaching listeners. Default false. */
  disabled?: boolean;
}

export interface UseDragUploadResult {
  /** True when the user is dragging files over the target. */
  isDragging: boolean;
}

export function useDragUpload(opts: UseDragUploadOptions): UseDragUploadResult {
  const { targetRef, onFiles, disabled = false } = opts;
  const dragCounterRef = useRef(0);
  const [isDragging, setIsDragging] = useState(false);

  const handleDragEnter = useCallback(
    (e: DragEvent) => {
      if (disabled) return;
      if (!e.dataTransfer?.types?.includes('Files')) return;
      e.preventDefault();
      dragCounterRef.current += 1;
      setIsDragging(true);
    },
    [disabled],
  );

  const handleDragLeave = useCallback(
    (e: DragEvent) => {
      if (disabled) return;
      e.preventDefault();
      dragCounterRef.current -= 1;
      if (dragCounterRef.current <= 0) {
        dragCounterRef.current = 0;
        setIsDragging(false);
      }
    },
    [disabled],
  );

  const handleDragOver = useCallback((e: DragEvent) => {
    // Required to allow drop; no-op otherwise.
    if (e.dataTransfer?.types?.includes('Files')) {
      e.preventDefault();
    }
  }, []);

  const handleDrop = useCallback(
    (e: DragEvent) => {
      if (disabled) return;
      if (!e.dataTransfer?.types?.includes('Files')) return;
      e.preventDefault();
      dragCounterRef.current = 0;
      setIsDragging(false);
      const files: File[] = [];
      const dtFiles = e.dataTransfer.files;
      if (dtFiles && dtFiles.length > 0) {
        for (let i = 0; i < dtFiles.length; i += 1) {
          const f = dtFiles.item(i);
          if (f) files.push(f);
        }
      }
      if (files.length > 0) onFiles(files);
    },
    [disabled, onFiles],
  );

  useEffect(() => {
    if (disabled) {
      setIsDragging(false);
      dragCounterRef.current = 0;
      return undefined;
    }
    const el = targetRef.current;
    if (!el) return undefined;

    el.addEventListener('dragenter', handleDragEnter as EventListener);
    el.addEventListener('dragleave', handleDragLeave as EventListener);
    el.addEventListener('dragover', handleDragOver as EventListener);
    el.addEventListener('drop', handleDrop as EventListener);
    return () => {
      el.removeEventListener('dragenter', handleDragEnter as EventListener);
      el.removeEventListener('dragleave', handleDragLeave as EventListener);
      el.removeEventListener('dragover', handleDragOver as EventListener);
      el.removeEventListener('drop', handleDrop as EventListener);
    };
  }, [targetRef, disabled, handleDragEnter, handleDragLeave, handleDragOver, handleDrop]);

  return { isDragging };
}
