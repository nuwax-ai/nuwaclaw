/*
 * ChatUploadFile tests.
 *
 * Vitest runs in a `node` environment in this workspace (no jsdom), so we
 * verify the visual contract with `renderToStaticMarkup` — the same pattern
 * used by `variableForm.test.tsx` and `markdownRenderer.test.tsx`. For
 * imperative checks (size formatting, paste-extraction) we exercise the
 * exported helpers directly.
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import {
  ChatUploadFile,
  type UploadEntry,
  type ChatUploadFileProps,
} from '../src/components/ChatUploadFile';
import { UploadList } from '../src/components/ChatUploadFile/UploadList';
import {
  formatFileSize,
  inferFileIcon,
} from '../src/components/ChatUploadFile/utils';
import { extractClipboardFiles } from '../src/components/ChatUploadFile/usePasteUpload';
import type { WorkbenchApiAdapter } from '../src/types';

function makeAdapter(): WorkbenchApiAdapter {
  // The component never invokes adapter.uploadFile in any of the markup
  // assertions below; we only need a structurally valid object.
  return {
    listConversations: async () => [],
    createConversation: async () => ({
      id: 'c1',
      agentId: 'a1',
      title: '',
      createdAt: '',
      updatedAt: '',
    }),
    getConversation: async () => ({
      conversation: {
        id: 'c1',
        agentId: 'a1',
        title: '',
        createdAt: '',
        updatedAt: '',
      },
      messages: [],
    }),
    sendMessage: async function* () {
      // empty stream
    },
  } satisfies WorkbenchApiAdapter;
}

function makeFile(name: string, size: number, type = 'text/plain'): File {
  // Node 18+ exposes a global `File` (undici). When unavailable, fall back to
  // a minimal stub that satisfies the props the component actually reads.
  const G = globalThis as { File?: typeof File };
  if (typeof G.File === 'function') {
    return new G.File([new Uint8Array(size)], name, { type });
  }
  const stub = {
    name,
    size,
    type,
    lastModified: Date.now(),
    arrayBuffer: async () => new ArrayBuffer(size),
    slice: () => stub,
    stream: () => undefined,
    text: async () => '',
  } as unknown as File;
  return stub;
}

function renderRoot(props: ChatUploadFileProps): string {
  return renderToStaticMarkup(<ChatUploadFile {...props} />);
}

describe('ChatUploadFile — main component markup', () => {
  it('renders only the upload button when entries is empty', () => {
    const html = renderRoot({
      adapter: makeAdapter(),
      entries: [],
      onEntriesChange: () => {},
    });
    expect(html).toContain('chat-upload-button');
    expect(html).toContain('data-testid="chat-upload-button"');
    // The hidden input must be present so clicks can trigger picker.
    expect(html).toContain('data-testid="chat-upload-input"');
    // No list because entries is empty.
    expect(html).not.toContain('data-testid="chat-upload-list"');
  });

  it('renders filename and formatted size for a `done` entry', () => {
    const entries: UploadEntry[] = [
      {
        id: 'u1',
        localFile: makeFile('design.pdf', 2 * 1024 * 1024, 'application/pdf'),
        status: 'done',
        progress: 100,
        uploaded: {
          url: 'https://example.com/design.pdf',
          key: 'k-1',
          fileName: 'design.pdf',
          size: 2 * 1024 * 1024,
          mimeType: 'application/pdf',
        },
      },
    ];
    const html = renderRoot({
      adapter: makeAdapter(),
      entries,
      onEntriesChange: () => {},
    });
    expect(html).toContain('data-testid="chat-upload-list"');
    expect(html).toContain('chat-upload-item--done');
    expect(html).toContain('design.pdf');
    expect(html).toContain('2.0 MB');
    expect(html).toContain('data-icon="pdf"');
    // Progress bar is only rendered while uploading.
    expect(html).not.toContain('chat-upload-progress-u1');
  });

  it('renders progress bar with current value for an `uploading` entry', () => {
    const entries: UploadEntry[] = [
      {
        id: 'u2',
        localFile: makeFile('big.bin', 5 * 1024 * 1024, 'application/octet-stream'),
        status: 'uploading',
        progress: 42,
      },
    ];
    const html = renderToStaticMarkup(
      <UploadList entries={entries} onRemove={() => {}} />,
    );
    expect(html).toContain('chat-upload-item--uploading');
    expect(html).toContain('data-testid="chat-upload-progress-u2"');
    expect(html).toContain('aria-valuenow="42"');
    expect(html).toContain('role="progressbar"');
    expect(html).toContain('width:42%');
  });

  it('renders error styling and message for an `error` entry', () => {
    const entries: UploadEntry[] = [
      {
        id: 'u3',
        localFile: makeFile('huge.zip', 999, 'application/zip'),
        status: 'error',
        progress: 0,
        error: 'File exceeds the maximum allowed size',
      },
    ];
    const html = renderRoot({
      adapter: makeAdapter(),
      entries,
      onEntriesChange: () => {},
    });
    expect(html).toContain('chat-upload-item--error');
    expect(html).toContain('File exceeds the maximum allowed size');
    expect(html).toContain('role="alert"');
    expect(html).toContain('data-icon="zip"');
  });

  it('marks the button disabled when `disabled` is true', () => {
    const html = renderRoot({
      adapter: makeAdapter(),
      entries: [],
      onEntriesChange: () => {},
      disabled: true,
    });
    const buttonMatch = html.match(
      /<button[^>]*data-testid="chat-upload-button"[^>]*>/,
    );
    expect(buttonMatch).not.toBeNull();
    expect(buttonMatch?.[0]).toContain('disabled');
  });

  it('renders multiple entries with stable order', () => {
    const entries: UploadEntry[] = [
      {
        id: 'a',
        localFile: makeFile('a.png', 1024, 'image/png'),
        status: 'done',
        progress: 100,
        uploaded: {
          url: 'u',
          fileName: 'a.png',
          size: 1024,
          mimeType: 'image/png',
        },
      },
      {
        id: 'b',
        localFile: makeFile('b.mp4', 2048, 'video/mp4'),
        status: 'uploading',
        progress: 10,
      },
    ];
    const html = renderRoot({
      adapter: makeAdapter(),
      entries,
      onEntriesChange: () => {},
    });
    const aIdx = html.indexOf('chat-upload-item-a');
    const bIdx = html.indexOf('chat-upload-item-b');
    expect(aIdx).toBeGreaterThan(-1);
    expect(bIdx).toBeGreaterThan(aIdx);
    expect(html).toContain('data-icon="image"');
    expect(html).toContain('data-icon="video"');
  });
});

describe('ChatUploadFile — utils', () => {
  it('formatFileSize renders human-readable units', () => {
    expect(formatFileSize(0)).toBe('0 B');
    expect(formatFileSize(512)).toBe('512 B');
    expect(formatFileSize(1024)).toBe('1.0 KB');
    expect(formatFileSize(1.5 * 1024 * 1024)).toBe('1.5 MB');
    expect(formatFileSize(2 * 1024 * 1024 * 1024)).toBe('2.0 GB');
    expect(formatFileSize(undefined)).toBe('');
    expect(formatFileSize(null)).toBe('');
    expect(formatFileSize(NaN)).toBe('');
    expect(formatFileSize(-1)).toBe('');
  });

  it('inferFileIcon maps mime types to icon labels', () => {
    expect(inferFileIcon('image/png')).toBe('image');
    expect(inferFileIcon('image/jpeg')).toBe('image');
    expect(inferFileIcon('video/mp4')).toBe('video');
    expect(inferFileIcon('audio/mpeg')).toBe('audio');
    expect(inferFileIcon('application/pdf')).toBe('pdf');
    expect(inferFileIcon('text/plain')).toBe('text');
    expect(inferFileIcon('application/json')).toBe('text');
    expect(inferFileIcon('application/zip')).toBe('zip');
    expect(inferFileIcon('application/x-7z-compressed')).toBe('zip');
    expect(inferFileIcon('application/msword')).toBe('doc');
    expect(inferFileIcon('application/vnd.ms-excel')).toBe('sheet');
    expect(inferFileIcon('application/vnd.ms-powerpoint')).toBe('slide');
    expect(inferFileIcon('application/octet-stream')).toBe('file');
    expect(inferFileIcon(undefined)).toBe('file');
    expect(inferFileIcon('')).toBe('file');
  });
});

describe('ChatUploadFile — extractClipboardFiles', () => {
  it('returns files from a clipboard files list (all types)', () => {
    const png = makeFile('paste.png', 100, 'image/png');
    const txt = makeFile('note.txt', 50, 'text/plain');
    const data = {
      files: {
        length: 2,
        item(i: number) {
          return [png, txt][i] ?? null;
        },
      },
      items: undefined,
    } as unknown as DataTransfer;
    // Some test envs don't have a real DataTransfer; passing a shape with the
    // right `files.item` is enough since the extractor only reads what it
    // needs.
    const out = extractClipboardFiles(data);
    expect(out).toHaveLength(2);
    expect(out[0]?.type).toBe('image/png');
    expect(out[1]?.type).toBe('text/plain');
  });

  it('returns non-image files too (all file types accepted)', () => {
    const txt = makeFile('note.txt', 50, 'text/plain');
    const data = {
      files: {
        length: 1,
        item(i: number) {
          return [txt][i] ?? null;
        },
      },
      items: undefined,
    } as unknown as DataTransfer;
    // After commit 9341a145 sync, all file types are accepted (not just images)
    expect(extractClipboardFiles(data)).toHaveLength(1);
    expect(extractClipboardFiles(data)[0]?.type).toBe('text/plain');
  });

  it('returns [] when clipboardData is null', () => {
    expect(extractClipboardFiles(null)).toEqual([]);
  });
});
