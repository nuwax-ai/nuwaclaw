/*
 * UploadList — renders the controlled list of upload entries.
 *
 * Mirrors nuwax `ChatUploadFile`: each row shows an icon, filename, size,
 * progress (when uploading), and a remove button. Removing an in-flight
 * upload aborts the underlying request through its AbortController.
 *
 * Rendering is intentionally markup-only — no internal state — so it can be
 * driven both from the main `ChatUploadFile` wrapper and from any other
 * surface that wants to reuse the visual contract.
 */
import type { ChatUploadFileLabels, UploadEntry } from './types';
import { formatFileSize, inferFileIcon } from './utils';

export interface UploadListProps {
  entries: UploadEntry[];
  onRemove: (id: string) => void;
  iconResolver?: (mime?: string) => string;
  labels?: ChatUploadFileLabels;
}

function statusClass(status: UploadEntry['status']): string {
  switch (status) {
    case 'uploading':
      return 'chat-upload-item--uploading';
    case 'done':
      return 'chat-upload-item--done';
    case 'error':
      return 'chat-upload-item--error';
    default:
      return 'chat-upload-item--pending';
  }
}

export function UploadList({
  entries,
  onRemove,
  iconResolver,
  labels,
}: UploadListProps): JSX.Element | null {
  if (!entries.length) return null;

  const removeLabel = labels?.remove ?? 'Remove';

  return (
    <div className="chat-upload-list" data-testid="chat-upload-list">
      {entries.map((entry) => {
        const mime = entry.uploaded?.mimeType ?? entry.localFile.type;
        const size = entry.uploaded?.size ?? entry.localFile.size;
        const name =
          entry.uploaded?.fileName ?? entry.localFile.name ?? 'file';
        const icon = (iconResolver ?? inferFileIcon)(mime);
        const progress = Math.max(0, Math.min(100, Math.round(entry.progress)));
        return (
          <div
            key={entry.id}
            className={`chat-upload-item ${statusClass(entry.status)}`}
            data-testid={`chat-upload-item-${entry.id}`}
            data-status={entry.status}
          >
            <span className="chat-upload-item-icon" data-icon={icon}>
              {icon}
            </span>
            <span className="chat-upload-item-body">
              <span
                className="chat-upload-item-name"
                title={name}
              >
                {name}
              </span>
              <span className="chat-upload-item-size">
                {formatFileSize(size)}
              </span>
              {entry.status === 'uploading' && (
                <span
                  className="chat-upload-progress"
                  data-testid={`chat-upload-progress-${entry.id}`}
                  aria-valuenow={progress}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  role="progressbar"
                >
                  <span
                    className="chat-upload-progress-bar"
                    style={{ width: `${progress}%` }}
                  />
                </span>
              )}
              {entry.status === 'error' && entry.error && (
                <span className="chat-upload-item-error" role="alert">
                  {entry.error}
                </span>
              )}
            </span>
            <button
              type="button"
              className="chat-upload-item-remove"
              aria-label={removeLabel}
              onClick={() => onRemove(entry.id)}
            >
              ×
            </button>
          </div>
        );
      })}
    </div>
  );
}
