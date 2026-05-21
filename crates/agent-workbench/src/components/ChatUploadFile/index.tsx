/*
 * ChatUploadFile — standalone upload UI for the workbench chat input.
 *
 * Phase C.2 UI deliverable. Not wired into NuwaxOpenApp.tsx by design; the
 * Phase B refactor will pick it up when the chat input is split out into a
 * dedicated component.
 *
 * Behavior summary:
 *   - Renders a single "upload" button that opens a hidden <input type=file>.
 *   - The list of upload entries is fully controlled by the parent through
 *     `entries` + `onEntriesChange`. The component never holds entry state
 *     internally — that way the parent can serialize / clear / merge on send
 *     without prop drilling refs.
 *   - When the user picks files, each one is validated against
 *     `maxFileSize`. Files that fail validation get a synthetic `error`
 *     entry so the user can see what was rejected.
 *   - Accepted files become `pending` entries. A small scheduler runs
 *     adapter.uploadFile(...) for up to `maxConcurrent` of them in parallel;
 *     the remaining ones stay `pending` until a slot frees up.
 *   - Removing an `uploading` entry calls `abort()` on its AbortController.
 *
 * The concurrency cap is enforced against the *latest* entries list so that
 * subsequent invocations of `startPending` always see the freshest in-flight
 * count.
 */
import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { ChangeEvent } from 'react';

import type { WorkbenchUploadedFile, WorkbenchUploadProgress } from '../../types';
import { UploadList } from './UploadList';
import type { ChatUploadFileProps, UploadEntry } from './types';
import { generateUploadId } from './utils';

const DEFAULT_MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB
const DEFAULT_MAX_CONCURRENT = 3;

function isAdapterReady(
  adapter: ChatUploadFileProps['adapter'],
): adapter is ChatUploadFileProps['adapter'] & {
  uploadFile: NonNullable<ChatUploadFileProps['adapter']['uploadFile']>;
} {
  return typeof adapter.uploadFile === 'function';
}

export function ChatUploadFile(props: ChatUploadFileProps): JSX.Element {
  const {
    adapter,
    entries,
    onEntriesChange,
    maxFileSize = DEFAULT_MAX_FILE_SIZE,
    maxConcurrent = DEFAULT_MAX_CONCURRENT,
    accept,
    multiple = true,
    disabled = false,
    iconResolver,
    labels,
    className,
  } = props;

  const inputRef = useRef<HTMLInputElement | null>(null);

  // Keep a ref of the latest entries so the upload scheduler always reads
  // the current state when computing in-flight counts and updating individual
  // entries. Without this we'd close over stale snapshots inside async
  // callbacks and either over-schedule uploads or fail to mark them done.
  const entriesRef = useRef<UploadEntry[]>(entries);
  useEffect(() => {
    entriesRef.current = entries;
  }, [entries]);

  const labelUpload = labels?.upload ?? 'Upload';
  const labelSizeExceeded =
    labels?.sizeExceeded ?? 'File exceeds the maximum allowed size';
  const labelUploadFailed = labels?.uploadFailed ?? 'Upload failed';

  // Stable refs to the latest callbacks so the scheduler doesn't restart
  // when the parent re-renders with a new lambda. The component is fully
  // controlled, so onEntriesChange identity may change every render.
  const onEntriesChangeRef = useRef(onEntriesChange);
  useEffect(() => {
    onEntriesChangeRef.current = onEntriesChange;
  }, [onEntriesChange]);

  const adapterRef = useRef(adapter);
  useEffect(() => {
    adapterRef.current = adapter;
  }, [adapter]);

  // Mutates the entries list by id. Reads from entriesRef so concurrent
  // mutators don't drop each other's changes — every patcher pulls the
  // freshest list, applies its diff, then publishes a new array.
  const patchEntry = useCallback(
    (id: string, patch: Partial<UploadEntry>): void => {
      const current = entriesRef.current;
      let changed = false;
      const next = current.map((e) => {
        if (e.id !== id) return e;
        changed = true;
        return { ...e, ...patch };
      });
      if (!changed) return;
      entriesRef.current = next;
      onEntriesChangeRef.current(next);
    },
    [],
  );

  const startUpload = useCallback(
    async (entryId: string): Promise<void> => {
      const current = entriesRef.current;
      const target = current.find((e) => e.id === entryId);
      if (!target) return;
      if (target.status !== 'pending') return;
      const liveAdapter = adapterRef.current;
      if (!isAdapterReady(liveAdapter)) {
        patchEntry(entryId, {
          status: 'error',
          error: 'uploadFile not supported by this adapter',
        });
        return;
      }
      const abort = new AbortController();
      patchEntry(entryId, { status: 'uploading', progress: 0, abort });

      try {
        const uploaded: WorkbenchUploadedFile = await liveAdapter.uploadFile(
          target.localFile,
          {
            signal: abort.signal,
            onProgress: (p: WorkbenchUploadProgress) => {
              const total = p.total > 0 ? p.total : target.localFile.size || 1;
              const pct = Math.round((p.loaded / total) * 100);
              patchEntry(entryId, {
                progress: Number.isFinite(pct) ? pct : 0,
              });
            },
          },
        );
        patchEntry(entryId, {
          status: 'done',
          progress: 100,
          uploaded,
          abort: undefined,
        });
      } catch (err) {
        const aborted = abort.signal.aborted;
        if (aborted) {
          // The entry was removed by the user; nothing to patch — it has
          // either been spliced out by `removeEntry` or its slot is gone.
          return;
        }
        const message =
          err instanceof Error ? err.message : labelUploadFailed;
        patchEntry(entryId, {
          status: 'error',
          error: message,
          abort: undefined,
        });
      }
    },
    [patchEntry, labelUploadFailed],
  );

  // Schedule any pending entries up to the concurrency cap. Counts
  // `uploading` against the cap and reads from the freshest entries snapshot.
  const startPending = useCallback((): void => {
    const current = entriesRef.current;
    let inFlight = current.filter((e) => e.status === 'uploading').length;
    if (inFlight >= maxConcurrent) return;
    for (const entry of current) {
      if (inFlight >= maxConcurrent) break;
      if (entry.status !== 'pending') continue;
      inFlight += 1;
      // Fire-and-forget: each upload's lifecycle is driven by patchEntry,
      // and once it settles we re-enter startPending via the entries effect.
      void startUpload(entry.id);
    }
  }, [maxConcurrent, startUpload]);

  // Whenever entries change, see if a slot opened up. This is what advances
  // the queue after a `done` / `error` settles or after the user removes an
  // in-flight upload.
  useEffect(() => {
    startPending();
  }, [entries, startPending]);

  const enqueueFiles = useCallback(
    (files: File[]): void => {
      if (!files.length) return;
      const incoming: UploadEntry[] = [];
      for (const file of files) {
        const id = generateUploadId();
        if (file.size > maxFileSize) {
          incoming.push({
            id,
            localFile: file,
            status: 'error',
            progress: 0,
            error: labelSizeExceeded,
          });
          continue;
        }
        incoming.push({
          id,
          localFile: file,
          status: 'pending',
          progress: 0,
        });
      }
      const next = [...entriesRef.current, ...incoming];
      entriesRef.current = next;
      onEntriesChangeRef.current(next);
    },
    [maxFileSize, labelSizeExceeded],
  );

  const removeEntry = useCallback((id: string): void => {
    const current = entriesRef.current;
    const target = current.find((e) => e.id === id);
    if (target?.abort && target.status === 'uploading') {
      try {
        target.abort.abort();
      } catch {
        /* swallow — abort is best-effort */
      }
    }
    const next = current.filter((e) => e.id !== id);
    if (next.length === current.length) return;
    entriesRef.current = next;
    onEntriesChangeRef.current(next);
  }, []);

  const handleSelectChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>): void => {
      const list = event.target.files;
      if (!list || list.length === 0) {
        return;
      }
      const files: File[] = [];
      for (let i = 0; i < list.length; i += 1) {
        const f = list.item(i);
        if (f) files.push(f);
      }
      enqueueFiles(files);
      // Reset input so the user can pick the same file twice in a row.
      event.target.value = '';
    },
    [enqueueFiles],
  );

  const handleButtonClick = useCallback((): void => {
    if (disabled) return;
    inputRef.current?.click();
  }, [disabled]);

  const hasUploading = useMemo(
    () => entries.some((e) => e.status === 'uploading'),
    [entries],
  );

  const buttonLabel = hasUploading
    ? labels?.uploading ?? labelUpload
    : labelUpload;

  return (
    <div className={`chat-upload-root${className ? ` ${className}` : ''}`}>
      <button
        type="button"
        className="chat-upload-button"
        onClick={handleButtonClick}
        disabled={disabled}
        aria-label={labelUpload}
        data-testid="chat-upload-button"
      >
        <span aria-hidden="true">+</span>
        <span className="chat-upload-button-label">{buttonLabel}</span>
      </button>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple={multiple}
        hidden
        // We keep the input mounted so its ref is stable — clicks programmatic.
        onChange={handleSelectChange}
        data-testid="chat-upload-input"
      />
      <UploadList
        entries={entries}
        onRemove={removeEntry}
        iconResolver={iconResolver}
        labels={labels}
      />
    </div>
  );
}

// Re-export helpers so consumers can grab them from the same entry point.
export { UploadList } from './UploadList';
export { usePasteUpload, extractClipboardFiles } from './usePasteUpload';
export { formatFileSize, inferFileIcon } from './utils';
export type {
  ChatUploadFileLabels,
  ChatUploadFileProps,
  UploadEntry,
  UploadEntryStatus,
} from './types';
