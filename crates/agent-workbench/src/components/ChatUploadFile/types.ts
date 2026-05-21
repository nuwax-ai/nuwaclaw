/*
 * Types for the standalone ChatUploadFile component.
 *
 * Mirrors the nuwax (PC) upload UX:
 *   - selectable button that opens a hidden <input type=file>
 *   - a controlled list of upload entries with progress and removal
 *   - clipboard-paste image hook (`usePasteUpload`)
 *
 * The component is fully controlled: the parent owns `entries` and reacts to
 * `onEntriesChange` to mutate them. The component performs the actual upload
 * call through the injected `adapter.uploadFile` and emits state transitions
 * through `onEntriesChange`. This keeps the upload state co-located with the
 * surrounding chat input so it can survive remounts / be reset on send.
 */
import type {
  WorkbenchApiAdapter,
  WorkbenchUploadedFile,
} from '../../types';

/**
 * State of a single upload row.
 *
 * - `pending`  — queued behind the concurrency cap, not yet uploading.
 * - `uploading` — POST in flight; `progress` reflects the latest tick.
 * - `done`      — server returned success; `uploaded` is populated.
 * - `error`     — upload failed or was aborted with an error reason.
 */
export type UploadEntryStatus = 'pending' | 'uploading' | 'done' | 'error';

export interface UploadEntry {
  id: string;
  localFile: File;
  status: UploadEntryStatus;
  /** 0-100. Best-effort; native fetch may only jump to 100 at the end. */
  progress: number;
  uploaded?: WorkbenchUploadedFile;
  error?: string;
  /** AbortController to cancel an in-flight upload. */
  abort?: AbortController;
}

export interface ChatUploadFileLabels {
  upload?: string;
  uploading?: string;
  remove?: string;
  sizeExceeded?: string;
  uploadFailed?: string;
}

export interface ChatUploadFileProps {
  adapter: WorkbenchApiAdapter;
  entries: UploadEntry[];
  onEntriesChange: (next: UploadEntry[]) => void;
  /** Max file size in bytes. Default 50 MB. */
  maxFileSize?: number;
  /** Max concurrent uploads. Default 3. */
  maxConcurrent?: number;
  /** Restrict mime types if needed. Forwarded to <input accept>. */
  accept?: string;
  /** Allow multiple selection. Default true. */
  multiple?: boolean;
  /** Disable the button (e.g. while the chat is streaming). */
  disabled?: boolean;
  /** Custom file icon resolver by mime type. */
  iconResolver?: (mime?: string) => string;
  labels?: ChatUploadFileLabels;
  /** className for the wrapping button. */
  className?: string;
}
