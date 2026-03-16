/**
 * Tests for guiAgentServer — input validation functions
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('electron-log', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('electron', () => ({
  desktopCapturer: { getSources: vi.fn() },
  screen: { getAllDisplays: vi.fn(() => []), getPrimaryDisplay: vi.fn(() => ({ id: 1 })) },
  systemPreferences: { getMediaAccessStatus: vi.fn(), isTrustedAccessibilityClient: vi.fn() },
  shell: { openExternal: vi.fn() },
}));

import { validateInputAction, validateScreenshotRequest } from './guiAgentServer';

describe('validateInputAction', () => {
  it('rejects missing action', () => {
    expect(() => validateInputAction({})).toThrow('Missing or invalid action object');
  });

  it('rejects non-object action', () => {
    expect(() => validateInputAction({ action: 'string' })).toThrow('Missing or invalid action object');
  });

  it('rejects array action', () => {
    expect(() => validateInputAction({ action: [1, 2] })).toThrow('Missing or invalid action object');
  });

  it('rejects invalid action type', () => {
    expect(() => validateInputAction({ action: { type: 'invalid_type' } })).toThrow('Invalid action type');
  });

  it('rejects action with missing type', () => {
    expect(() => validateInputAction({ action: { x: 1 } })).toThrow('Invalid action type');
  });

  // mouse_move
  it('accepts valid mouse_move', () => {
    const result = validateInputAction({ action: { type: 'mouse_move', x: 100, y: 200 } });
    expect(result.type).toBe('mouse_move');
  });

  it('rejects mouse_move without x', () => {
    expect(() => validateInputAction({ action: { type: 'mouse_move', y: 200 } }))
      .toThrow('requires numeric x and y');
  });

  it('rejects mouse_move with string x', () => {
    expect(() => validateInputAction({ action: { type: 'mouse_move', x: '100', y: 200 } }))
      .toThrow('requires numeric x and y');
  });

  // mouse_click
  it('accepts valid mouse_click', () => {
    const result = validateInputAction({ action: { type: 'mouse_click', x: 50, y: 50 } });
    expect(result.type).toBe('mouse_click');
  });

  it('accepts mouse_click with optional button', () => {
    const result = validateInputAction({ action: { type: 'mouse_click', x: 50, y: 50, button: 'right' } });
    expect(result.type).toBe('mouse_click');
  });

  // mouse_scroll
  it('accepts valid mouse_scroll', () => {
    const result = validateInputAction({ action: { type: 'mouse_scroll', x: 100, y: 100, deltaY: 3 } });
    expect(result.type).toBe('mouse_scroll');
  });

  it('rejects mouse_scroll without deltaY', () => {
    expect(() => validateInputAction({ action: { type: 'mouse_scroll', x: 100, y: 100 } }))
      .toThrow('mouse_scroll requires numeric deltaY');
  });

  // mouse_drag
  it('accepts valid mouse_drag', () => {
    const result = validateInputAction({
      action: { type: 'mouse_drag', startX: 0, startY: 0, endX: 100, endY: 100 },
    });
    expect(result.type).toBe('mouse_drag');
  });

  it('rejects mouse_drag with missing endX', () => {
    expect(() => validateInputAction({
      action: { type: 'mouse_drag', startX: 0, startY: 0, endY: 100 },
    })).toThrow('requires numeric startX, startY, endX, endY');
  });

  // keyboard_type
  it('accepts valid keyboard_type', () => {
    const result = validateInputAction({ action: { type: 'keyboard_type', text: 'hello' } });
    expect(result.type).toBe('keyboard_type');
  });

  it('rejects keyboard_type without text', () => {
    expect(() => validateInputAction({ action: { type: 'keyboard_type' } }))
      .toThrow('keyboard_type requires string text');
  });

  it('rejects keyboard_type with numeric text', () => {
    expect(() => validateInputAction({ action: { type: 'keyboard_type', text: 123 } }))
      .toThrow('keyboard_type requires string text');
  });

  // keyboard_press
  it('accepts valid keyboard_press', () => {
    const result = validateInputAction({ action: { type: 'keyboard_press', key: 'enter' } });
    expect(result.type).toBe('keyboard_press');
  });

  it('rejects keyboard_press without key', () => {
    expect(() => validateInputAction({ action: { type: 'keyboard_press' } }))
      .toThrow('keyboard_press requires string key');
  });

  // keyboard_hotkey
  it('accepts valid keyboard_hotkey', () => {
    const result = validateInputAction({ action: { type: 'keyboard_hotkey', keys: ['ctrl', 'c'] } });
    expect(result.type).toBe('keyboard_hotkey');
  });

  it('rejects keyboard_hotkey without keys', () => {
    expect(() => validateInputAction({ action: { type: 'keyboard_hotkey' } }))
      .toThrow('keyboard_hotkey requires string[] keys');
  });

  it('rejects keyboard_hotkey with non-string keys', () => {
    expect(() => validateInputAction({ action: { type: 'keyboard_hotkey', keys: [1, 2] } }))
      .toThrow('keyboard_hotkey requires string[] keys');
  });

  it('rejects keyboard_hotkey with non-array keys', () => {
    expect(() => validateInputAction({ action: { type: 'keyboard_hotkey', keys: 'ctrl+c' } }))
      .toThrow('keyboard_hotkey requires string[] keys');
  });
});

describe('validateScreenshotRequest', () => {
  it('returns empty opts for empty body', () => {
    const result = validateScreenshotRequest({});
    expect(result).toEqual({});
  });

  it('accepts valid scale', () => {
    const result = validateScreenshotRequest({ scale: 0.5 });
    expect(result.scale).toBe(0.5);
  });

  it('rejects non-numeric scale', () => {
    expect(() => validateScreenshotRequest({ scale: '0.5' })).toThrow('scale must be a number');
  });

  it('accepts valid format png', () => {
    const result = validateScreenshotRequest({ format: 'png' });
    expect(result.format).toBe('png');
  });

  it('accepts valid format jpeg', () => {
    const result = validateScreenshotRequest({ format: 'jpeg' });
    expect(result.format).toBe('jpeg');
  });

  it('rejects invalid format', () => {
    expect(() => validateScreenshotRequest({ format: 'bmp' })).toThrow('format must be "png" or "jpeg"');
  });

  it('accepts valid quality', () => {
    const result = validateScreenshotRequest({ quality: 80 });
    expect(result.quality).toBe(80);
  });

  it('rejects non-numeric quality', () => {
    expect(() => validateScreenshotRequest({ quality: 'high' })).toThrow('quality must be a number');
  });

  it('accepts valid displayIndex', () => {
    const result = validateScreenshotRequest({ displayIndex: 1 });
    expect(result.displayIndex).toBe(1);
  });

  it('rejects non-numeric displayIndex', () => {
    expect(() => validateScreenshotRequest({ displayIndex: '1' })).toThrow('displayIndex must be a number');
  });

  it('accepts valid region', () => {
    const result = validateScreenshotRequest({ region: { x: 0, y: 0, width: 100, height: 100 } });
    expect(result.region).toEqual({ x: 0, y: 0, width: 100, height: 100 });
  });

  it('rejects region with missing fields', () => {
    expect(() => validateScreenshotRequest({ region: { x: 0, y: 0 } }))
      .toThrow('region must have numeric x, y, width, height');
  });

  it('rejects non-object region', () => {
    expect(() => validateScreenshotRequest({ region: 'full' }))
      .toThrow('region must have numeric x, y, width, height');
  });

  it('accepts all fields combined', () => {
    const result = validateScreenshotRequest({
      scale: 0.3,
      format: 'jpeg',
      quality: 60,
      displayIndex: 0,
      region: { x: 10, y: 20, width: 200, height: 150 },
    });
    expect(result).toEqual({
      scale: 0.3,
      format: 'jpeg',
      quality: 60,
      displayIndex: 0,
      region: { x: 10, y: 20, width: 200, height: 150 },
    });
  });
});
