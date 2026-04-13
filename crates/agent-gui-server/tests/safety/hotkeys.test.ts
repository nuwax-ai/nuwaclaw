/**
 * Unit tests for safety/hotkeys.ts — platform blacklists and key normalization.
 */

import { describe, it, expect, vi } from 'vitest';

// Mock platform detection
const mockGetPlatform = vi.fn();
vi.mock('../../src/utils/platform.js', () => ({
  getPlatform: () => mockGetPlatform(),
}));

import { validateHotkey } from '../../src/safety/hotkeys.js';

describe('validateHotkey', () => {
  describe('macOS blacklist', () => {
    it('blocks Cmd+Q', () => {
      mockGetPlatform.mockReturnValue('macos');
      const result = validateHotkey(['Meta', 'Q']);
      expect(result.blocked).toBe(true);
      expect(result.reason).toContain('Quit application');
    });

    it('blocks Cmd+W', () => {
      mockGetPlatform.mockReturnValue('macos');
      const result = validateHotkey(['Meta', 'W']);
      expect(result.blocked).toBe(true);
      expect(result.reason).toContain('Close window');
    });

    it('blocks Cmd+Opt+Escape', () => {
      mockGetPlatform.mockReturnValue('macos');
      const result = validateHotkey(['Meta', 'Alt', 'Escape']);
      expect(result.blocked).toBe(true);
      expect(result.reason).toContain('Force quit');
    });

    it('blocks Cmd+Shift+Q (log out)', () => {
      mockGetPlatform.mockReturnValue('macos');
      const result = validateHotkey(['Meta', 'Shift', 'Q']);
      expect(result.blocked).toBe(true);
    });
  });

  describe('Windows blacklist', () => {
    it('blocks Alt+F4', () => {
      mockGetPlatform.mockReturnValue('windows');
      const result = validateHotkey(['Alt', 'F4']);
      expect(result.blocked).toBe(true);
      expect(result.reason).toContain('Close application');
    });

    it('blocks Ctrl+Alt+Delete', () => {
      mockGetPlatform.mockReturnValue('windows');
      const result = validateHotkey(['Control', 'Alt', 'Delete']);
      expect(result.blocked).toBe(true);
      expect(result.reason).toContain('System menu');
    });
  });

  describe('Linux blacklist', () => {
    it('blocks Ctrl+Alt+Delete', () => {
      mockGetPlatform.mockReturnValue('linux');
      const result = validateHotkey(['Control', 'Alt', 'Delete']);
      expect(result.blocked).toBe(true);
    });

    it('blocks Ctrl+Alt+Backspace', () => {
      mockGetPlatform.mockReturnValue('linux');
      const result = validateHotkey(['Control', 'Alt', 'Backspace']);
      expect(result.blocked).toBe(true);
      expect(result.reason).toContain('Kill X server');
    });
  });

  describe('key alias normalization', () => {
    it('normalizes cmd to meta', () => {
      mockGetPlatform.mockReturnValue('macos');
      const result = validateHotkey(['cmd', 'q']);
      expect(result.blocked).toBe(true);
    });

    it('normalizes command to meta', () => {
      mockGetPlatform.mockReturnValue('macos');
      const result = validateHotkey(['command', 'q']);
      expect(result.blocked).toBe(true);
    });

    it('normalizes opt/option to alt', () => {
      mockGetPlatform.mockReturnValue('macos');
      const result = validateHotkey(['meta', 'opt', 'esc']);
      expect(result.blocked).toBe(true);
    });

    it('normalizes ctrl to control', () => {
      mockGetPlatform.mockReturnValue('windows');
      const result = validateHotkey(['ctrl', 'alt', 'del']);
      expect(result.blocked).toBe(true);
    });

    it('is case insensitive', () => {
      mockGetPlatform.mockReturnValue('macos');
      const result = validateHotkey(['META', 'Q']);
      expect(result.blocked).toBe(true);
    });
  });

  describe('allowed combinations', () => {
    it('allows Cmd+C (copy)', () => {
      mockGetPlatform.mockReturnValue('macos');
      const result = validateHotkey(['Meta', 'C']);
      expect(result.blocked).toBe(false);
    });

    it('allows Ctrl+S (save)', () => {
      mockGetPlatform.mockReturnValue('windows');
      const result = validateHotkey(['Control', 'S']);
      expect(result.blocked).toBe(false);
    });

    it('allows single keys', () => {
      mockGetPlatform.mockReturnValue('macos');
      const result = validateHotkey(['Enter']);
      expect(result.blocked).toBe(false);
    });

    it('key order does not matter', () => {
      mockGetPlatform.mockReturnValue('macos');
      const r1 = validateHotkey(['Q', 'Meta']);
      expect(r1.blocked).toBe(true);
    });
  });
});
