/*
 * usePasteUpload — clipboard-paste image upload hook.
 *
 * Mirrors the paste handler in nuwax `ChatInputHome` (src/components/
 * ChatInputHome/index.tsx, lines 228-340): when the user pastes one or more
 * images from the clipboard into the chat input, we want to forward those
 * files to the upload pipeline instead of inserting their textual data URL.
 *
 * The hook is intentionally framework-agnostic:
 *   - it attaches a `paste` listener to the provided element
 *   - it extracts every `File` whose `type.startsWith('image/')` from
 *     `e.clipboardData.files` (preferred) or `e.clipboardData.items`
 *   - if there is at least one image file, it calls `e.preventDefault()` and
 *     invokes `onFiles(files)`. The caller then routes those into
 *     `ChatUploadFile`'s upload queue.
 *
 * The hook does *not* call adapter.uploadFile directly — the surrounding
 * component (typically the chat input) decides whether to wire pasted files
 * to `ChatUploadFile` or somewhere else.
 */
import { useEffect } from 'react';
import type { RefObject } from 'react';

export interface UsePasteUploadOptions {
  /** Element ref the paste handler should attach to. */
  targetRef: RefObject<HTMLElement>;
  /** Called with extracted image File[] when at least one is found. */
  onFiles: (files: File[]) => void;
  /** When true, skip attaching the listener. Default false. */
  disabled?: boolean;
  /** Optional filter for mime types (defaults to 'image/*'). */
  mimeFilter?: (mimeType: string) => boolean;
}

function defaultFilter(mimeType: string): boolean {
  return mimeType.startsWith('image/');
}

function extractFiles(
  clipboardData: DataTransfer | null,
  filter: (mt: string) => boolean,
): File[] {
  if (!clipboardData) return [];
  const out: File[] = [];
  // Prefer clipboardData.files when populated (Chrome, Safari).
  const files = clipboardData.files;
  if (files && files.length > 0) {
    for (let i = 0; i < files.length; i += 1) {
      const file = files.item(i);
      if (file && filter(file.type)) {
        out.push(file);
      }
    }
  }
  // Fallback to items[] for browsers/spec variants that only populate items.
  if (out.length === 0 && clipboardData.items) {
    for (let i = 0; i < clipboardData.items.length; i += 1) {
      const item = clipboardData.items[i];
      if (!item) continue;
      if (item.kind !== 'file') continue;
      if (!filter(item.type)) continue;
      const file = item.getAsFile();
      if (file) out.push(file);
    }
  }
  return out;
}

export function usePasteUpload(opts: UsePasteUploadOptions): void {
  const { targetRef, onFiles, disabled = false, mimeFilter } = opts;
  useEffect(() => {
    if (disabled) return undefined;
    const el = targetRef.current;
    if (!el) return undefined;

    const handler = (e: Event): void => {
      const clipboardEvt = e as ClipboardEvent;
      const filter = mimeFilter ?? defaultFilter;
      const files = extractFiles(clipboardEvt.clipboardData, filter);
      if (files.length > 0) {
        clipboardEvt.preventDefault();
        onFiles(files);
      }
    };

    el.addEventListener('paste', handler as EventListener);
    return () => {
      el.removeEventListener('paste', handler as EventListener);
    };
  }, [targetRef, onFiles, disabled, mimeFilter]);
}

/**
 * Exported for testing — extracts image files from a ClipboardEvent-like
 * payload without needing a real DOM event.
 */
export function extractClipboardFiles(
  clipboardData: DataTransfer | null,
  mimeFilter?: (mt: string) => boolean,
): File[] {
  return extractFiles(clipboardData, mimeFilter ?? defaultFilter);
}
