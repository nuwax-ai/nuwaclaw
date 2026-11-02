/**
 * Unit tests for desktop/clipboard.ts — pasteText flow, backup/restore, key order.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockRead = vi.fn();
const mockWrite = vi.fn();

vi.mock('clipboardy', () => ({
  default: {
    read: () => mockRead(),
    write: (text: string) => mockWrite(text),
  },
}));

const mockPressKey = vi.fn();
const mockReleaseKey = vi.fn();

vi.mock('@nut-tree-fork/nut-js', () => ({
  keyboard: {
    pressKey: mockPressKey,
    releaseKey: mockReleaseKey,
  },
  Key: {
    Meta: 100,
    Control: 101,
    V: 102,
  },
}));

const mockGetPlatformPasteKeys = vi.fn();
vi.mock('../../src/utils/platform.js', () => ({
  getPlatformPasteKeys: () => mockGetPlatformPasteKeys(),
}));

import { pasteText, readClipboard, writeClipboard } from '../../src/desktop/clipboard.js';

describe('readClipboard', () => {
  beforeEach(() => vi.clearAllMocks());

  it('reads clipboard content', async () => {
    mockRead.mockResolvedValue('existing content');
    const result = await readClipboard();
    expect(result).toBe('existing content');
  });
});

describe('writeClipboard', () => {
  beforeEach(() => vi.clearAllMocks());

  it('writes text to clipboard', async () => {
    mockWrite.mockResolvedValue(undefined);
    await writeClipboard('new text');
    expect(mockWrite).toHaveBeenCalledWith('new text');
  });
});

describe('pasteText', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetPlatformPasteKeys.mockReturnValue(['Meta', 'V']);
    mockRead.mockResolvedValue('backup-content');
    mockWrite.mockResolvedValue(undefined);
    mockPressKey.mockResolvedValue(undefined);
    mockReleaseKey.mockResolvedValue(undefined);
  });

  it('follows full paste flow: backup → write → press → wait → restore', async () => {
    await pasteText('target text');

    // 1. Backup clipboard
    expect(mockRead).toHaveBeenCalledTimes(1);

    // 2. Write target text
    expect(mockWrite).toHaveBeenNthCalledWith(1, 'target text');

    // 3. Press paste keys
    expect(mockPressKey).toHaveBeenCalledWith(100, 102); // Meta, V

    // 4. Release in REVERSE order (V first, then Meta)
    expect(mockReleaseKey).toHaveBeenCalledWith(102, 100); // V, Meta

    // 5. Restore original clipboard
    expect(mockWrite).toHaveBeenNthCalledWith(2, 'backup-content');
  });

  it('continues if backup read fails', async () => {
    mockRead.mockRejectedValue(new Error('clipboard not available'));

    await pasteText('text');

    // Should still write and paste
    expect(mockWrite).toHaveBeenCalledWith('text');
    expect(mockPressKey).toHaveBeenCalled();
  });

  it('does not throw if restore fails', async () => {
    mockRead.mockResolvedValue('backup');
    // First write succeeds, second (restore) fails
    mockWrite
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('restore failed'));

    // Should not throw
    await expect(pasteText('text')).resolves.toBeUndefined();
  });

  it('does not attempt restore if backup was undefined', async () => {
    mockRead.mockRejectedValue(new Error('no clipboard'));
    await pasteText('text');

    // Only one write call (the target text), no restore
    expect(mockWrite).toHaveBeenCalledTimes(1);
    expect(mockWrite).toHaveBeenCalledWith('text');
  });

  it('uses platform-specific paste keys', async () => {
    mockGetPlatformPasteKeys.mockReturnValue(['Control', 'V']);
    await pasteText('text');

    expect(mockPressKey).toHaveBeenCalledWith(101, 102); // Control, V
    expect(mockReleaseKey).toHaveBeenCalledWith(102, 101); // V, Control (reversed)
  });
});
