/**
 * Unit tests for utils/platform.ts — getPlatform, getPlatformPasteKeys, permission checks.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock os module
const mockPlatform = vi.fn();
vi.mock('os', () => ({
  platform: () => mockPlatform(),
}));

// Mock nut.js for permission checks
const mockScreenWidth = vi.fn();
const mockMouseGetPosition = vi.fn();

vi.mock('@nut-tree-fork/nut-js', () => ({
  screen: {
    width: () => mockScreenWidth(),
  },
  mouse: {
    getPosition: () => mockMouseGetPosition(),
  },
}));

import { getPlatform, getPlatformPasteKeys, checkScreenRecordingPermission, checkAccessibilityPermission } from '../../src/utils/platform.js';

describe('getPlatform', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns "macos" for darwin', () => {
    mockPlatform.mockReturnValue('darwin');
    expect(getPlatform()).toBe('macos');
  });

  it('returns "windows" for win32', () => {
    mockPlatform.mockReturnValue('win32');
    expect(getPlatform()).toBe('windows');
  });

  it('returns "linux" for linux', () => {
    mockPlatform.mockReturnValue('linux');
    expect(getPlatform()).toBe('linux');
  });

  it('returns "linux" for unknown platforms', () => {
    mockPlatform.mockReturnValue('freebsd');
    expect(getPlatform()).toBe('linux');
  });
});

describe('getPlatformPasteKeys', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns Meta+V on macOS', () => {
    mockPlatform.mockReturnValue('darwin');
    expect(getPlatformPasteKeys()).toEqual(['Meta', 'V']);
  });

  it('returns Control+V on Windows', () => {
    mockPlatform.mockReturnValue('win32');
    expect(getPlatformPasteKeys()).toEqual(['Control', 'V']);
  });

  it('returns Control+V on Linux', () => {
    mockPlatform.mockReturnValue('linux');
    expect(getPlatformPasteKeys()).toEqual(['Control', 'V']);
  });
});

describe('checkScreenRecordingPermission', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns true on non-macOS platforms', async () => {
    mockPlatform.mockReturnValue('win32');
    const result = await checkScreenRecordingPermission();
    expect(result).toBe(true);
    expect(mockScreenWidth).not.toHaveBeenCalled();
  });

  it('returns true on macOS when screen.width succeeds', async () => {
    mockPlatform.mockReturnValue('darwin');
    mockScreenWidth.mockResolvedValue(1920);
    const result = await checkScreenRecordingPermission();
    expect(result).toBe(true);
  });

  it('returns false on macOS when screen.width throws', async () => {
    mockPlatform.mockReturnValue('darwin');
    mockScreenWidth.mockRejectedValue(new Error('no permission'));
    const result = await checkScreenRecordingPermission();
    expect(result).toBe(false);
  });
});

describe('checkAccessibilityPermission', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns true on non-macOS platforms', async () => {
    mockPlatform.mockReturnValue('linux');
    const result = await checkAccessibilityPermission();
    expect(result).toBe(true);
    expect(mockMouseGetPosition).not.toHaveBeenCalled();
  });

  it('returns true on macOS when mouse.getPosition succeeds', async () => {
    mockPlatform.mockReturnValue('darwin');
    mockMouseGetPosition.mockResolvedValue({ x: 0, y: 0 });
    const result = await checkAccessibilityPermission();
    expect(result).toBe(true);
  });

  it('returns false on macOS when mouse.getPosition throws', async () => {
    mockPlatform.mockReturnValue('darwin');
    mockMouseGetPosition.mockRejectedValue(new Error('no permission'));
    const result = await checkAccessibilityPermission();
    expect(result).toBe(false);
  });
});
