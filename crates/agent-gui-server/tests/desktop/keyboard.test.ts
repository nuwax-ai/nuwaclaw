/**
 * Unit tests for desktop/keyboard.ts — typeText CJK routing, pressKey, hotkey.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockType = vi.fn();
const mockPressKey = vi.fn();
const mockReleaseKey = vi.fn();

vi.mock('@nut-tree-fork/nut-js', () => ({
  keyboard: {
    type: mockType,
    pressKey: mockPressKey,
    releaseKey: mockReleaseKey,
  },
  Key: {
    Enter: 'Enter_Val',
    Tab: 'Tab_Val',
    Escape: 'Escape_Val',
    LeftSuper: 'LeftSuper_Val',  // Meta/Command/Cmd alias
    LeftControl: 'LeftControl_Val',
    LeftAlt: 'LeftAlt_Val',
    LeftShift: 'LeftShift_Val',
    C: 'C_Val',
    V: 'V_Val',
  },
}));

const mockPasteText = vi.fn();
vi.mock('../../src/desktop/clipboard.js', () => ({
  pasteText: (...args: any[]) => mockPasteText(...args),
}));

import { typeText, pressKey, hotkey } from '../../src/desktop/keyboard.js';

describe('typeText', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses nut.js type for short ASCII text', async () => {
    await typeText('hello');
    expect(mockType).toHaveBeenCalledWith('hello');
    expect(mockPasteText).not.toHaveBeenCalled();
  });

  it('routes CJK text to clipboard paste', async () => {
    await typeText('你好世界');
    expect(mockPasteText).toHaveBeenCalledWith('你好世界');
    expect(mockType).not.toHaveBeenCalled();
  });

  it('routes non-ASCII text to clipboard paste', async () => {
    await typeText('café');
    expect(mockPasteText).toHaveBeenCalledWith('café');
    expect(mockType).not.toHaveBeenCalled();
  });

  it('routes long text (>50 chars) to clipboard paste', async () => {
    const longText = 'a'.repeat(51);
    await typeText(longText);
    expect(mockPasteText).toHaveBeenCalledWith(longText);
    expect(mockType).not.toHaveBeenCalled();
  });

  it('uses nut.js type for exactly 50 ASCII chars', async () => {
    const text = 'a'.repeat(50);
    await typeText(text);
    expect(mockType).toHaveBeenCalledWith(text);
    expect(mockPasteText).not.toHaveBeenCalled();
  });

  it('uses nut.js type for empty string', async () => {
    await typeText('');
    expect(mockType).toHaveBeenCalledWith('');
    expect(mockPasteText).not.toHaveBeenCalled();
  });
});

describe('pressKey', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('presses and releases a valid key', async () => {
    await pressKey('Enter');
    expect(mockPressKey).toHaveBeenCalledWith('Enter_Val');
    expect(mockReleaseKey).toHaveBeenCalledWith('Enter_Val');
  });

  it('throws DesktopError for unknown key', async () => {
    await expect(pressKey('UnknownKey')).rejects.toThrow('Unknown key: UnknownKey');
  });
});

describe('hotkey', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses keyboard.type() for hotkey combinations', async () => {
    await hotkey(['Meta', 'C']);
    // Meta is aliased to LeftSuper
    expect(mockType).toHaveBeenCalledWith('LeftSuper_Val', 'C_Val');
  });

  it('throws DesktopError for unknown key in combination', async () => {
    await expect(hotkey(['Meta', 'UnknownKey'])).rejects.toThrow('Unknown key: UnknownKey');
  });
});
