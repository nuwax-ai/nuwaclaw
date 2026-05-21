/*
 * Utilities for ChatUploadFile.
 *
 * `formatFileSize` mirrors nuwax `utils/byteConverter#formatBytes` — IEC units
 * (KiB-style values rendered as KB/MB/...) with a single decimal for non-byte
 * units. The exact rounding is not byte-perfect with nuwax (nuwax uses
 * 1024-based with two decimals in some places) but stays within a kilobyte
 * for any input we render in the chip list.
 *
 * `inferFileIcon` is the workbench fallback for `FileTypeIcon` in nuwax. It
 * returns a short label string (`image` / `pdf` / `doc` / etc.) so consumers
 * can map it to whatever icon system they use. Callers can override the
 * full resolver via `ChatUploadFileProps.iconResolver`.
 */

const BYTE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const;

export function formatFileSize(bytes: number | undefined | null): string {
  if (bytes === undefined || bytes === null || Number.isNaN(bytes)) return '';
  if (bytes < 0) return '';
  if (bytes === 0) return '0 B';
  const k = 1024;
  const exp = Math.min(
    Math.floor(Math.log(bytes) / Math.log(k)),
    BYTE_UNITS.length - 1,
  );
  const value = bytes / Math.pow(k, exp);
  const unit = BYTE_UNITS[exp];
  if (unit === 'B') {
    return `${value} ${unit}`;
  }
  // Keep one decimal for friendly display ("1.2 MB").
  return `${value.toFixed(1)} ${unit}`;
}

export function inferFileIcon(mimeType?: string): string {
  if (!mimeType) return 'file';
  const mt = mimeType.toLowerCase();
  if (mt.startsWith('image/')) return 'image';
  if (mt.startsWith('video/')) return 'video';
  if (mt.startsWith('audio/')) return 'audio';
  if (mt === 'application/pdf') return 'pdf';
  if (
    mt.startsWith('text/') ||
    mt === 'application/json' ||
    mt === 'application/xml'
  ) {
    return 'text';
  }
  if (
    mt.includes('zip') ||
    mt.includes('compressed') ||
    mt.includes('x-tar') ||
    mt.includes('x-7z') ||
    mt.includes('x-rar')
  ) {
    return 'zip';
  }
  if (
    mt.includes('msword') ||
    mt.includes('officedocument.wordprocessingml') ||
    mt.includes('rtf')
  ) {
    return 'doc';
  }
  if (
    mt.includes('spreadsheetml') ||
    mt.includes('ms-excel') ||
    mt.includes('csv')
  ) {
    return 'sheet';
  }
  if (
    mt.includes('presentationml') ||
    mt.includes('ms-powerpoint')
  ) {
    return 'slide';
  }
  return 'file';
}

/**
 * Generate a stable-ish id for an upload entry. Uses `crypto.randomUUID()`
 * when available (browsers, recent Node) and falls back to a timestamp +
 * random suffix otherwise (older test environments).
 */
export function generateUploadId(): string {
  const g = globalThis as {
    crypto?: { randomUUID?: () => string };
  };
  if (g.crypto?.randomUUID) {
    try {
      return g.crypto.randomUUID();
    } catch {
      /* fall through */
    }
  }
  return `up-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
