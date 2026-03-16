/**
 * Tests for permissionService — platform permission detection
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockSystemPreferences = vi.hoisted(() => ({
  getMediaAccessStatus: vi.fn(),
  isTrustedAccessibilityClient: vi.fn(),
}));

const mockDesktopCapturer = vi.hoisted(() => ({
  getSources: vi.fn(),
}));

const mockShell = vi.hoisted(() => ({
  openExternal: vi.fn(),
}));

vi.mock('electron', () => ({
  systemPreferences: mockSystemPreferences,
  desktopCapturer: mockDesktopCapturer,
  shell: mockShell,
}));

vi.mock('electron-log', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import {
  checkGuiPermissions,
  requestAccessibilityPermission,
  openPermissionSettings,
} from './permissionService';

describe('permissionService', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe('checkGuiPermissions', () => {
    it('returns not_needed for Windows', () => {
      const originalPlatform = process.platform;
      Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });

      const result = checkGuiPermissions();
      expect(result.screenCapture).toBe('not_needed');
      expect(result.accessibility).toBe('not_needed');
      expect(result.platform).toBe('win32');

      Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
    });

    it('checks macOS screen capture and accessibility', () => {
      const originalPlatform = process.platform;
      Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });

      mockSystemPreferences.getMediaAccessStatus.mockReturnValue('granted');
      mockSystemPreferences.isTrustedAccessibilityClient.mockReturnValue(true);

      const result = checkGuiPermissions();
      expect(result.screenCapture).toBe('granted');
      expect(result.accessibility).toBe('granted');
      expect(result.platform).toBe('darwin');

      Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
    });

    it('reports denied macOS permissions', () => {
      const originalPlatform = process.platform;
      Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });

      mockSystemPreferences.getMediaAccessStatus.mockReturnValue('denied');
      mockSystemPreferences.isTrustedAccessibilityClient.mockReturnValue(false);

      const result = checkGuiPermissions();
      expect(result.screenCapture).toBe('denied');
      expect(result.accessibility).toBe('denied');

      Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
    });

    it('handles macOS permission check errors gracefully', () => {
      const originalPlatform = process.platform;
      Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });

      mockSystemPreferences.getMediaAccessStatus.mockImplementation(() => { throw new Error('fail'); });
      mockSystemPreferences.isTrustedAccessibilityClient.mockImplementation(() => { throw new Error('fail'); });

      const result = checkGuiPermissions();
      expect(result.screenCapture).toBe('unknown');
      expect(result.accessibility).toBe('unknown');

      Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
    });

    it('detects Linux X11', () => {
      const originalPlatform = process.platform;
      const originalEnv = process.env.XDG_SESSION_TYPE;
      Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
      process.env.XDG_SESSION_TYPE = 'x11';

      const result = checkGuiPermissions();
      expect(result.screenCapture).toBe('granted');
      expect(result.platform).toBe('linux');
      expect(result.displayServer).toBe('x11');

      Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
      if (originalEnv === undefined) delete process.env.XDG_SESSION_TYPE;
      else process.env.XDG_SESSION_TYPE = originalEnv;
    });

    it('detects Linux Wayland as denied for screen capture', () => {
      const originalPlatform = process.platform;
      const originalEnv = process.env.XDG_SESSION_TYPE;
      Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
      process.env.XDG_SESSION_TYPE = 'wayland';

      const result = checkGuiPermissions();
      expect(result.screenCapture).toBe('denied');
      expect(result.displayServer).toBe('wayland');

      Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
      if (originalEnv === undefined) delete process.env.XDG_SESSION_TYPE;
      else process.env.XDG_SESSION_TYPE = originalEnv;
    });

    it('returns unknown for unsupported platforms', () => {
      const originalPlatform = process.platform;
      Object.defineProperty(process, 'platform', { value: 'freebsd', configurable: true });

      const result = checkGuiPermissions();
      expect(result.screenCapture).toBe('unknown');
      expect(result.accessibility).toBe('unknown');

      Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
    });
  });

  describe('requestAccessibilityPermission', () => {
    it('returns false on non-darwin', () => {
      const originalPlatform = process.platform;
      Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });

      const result = requestAccessibilityPermission();
      expect(result).toBe(false);

      Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
    });

    it('calls isTrustedAccessibilityClient(true) on macOS', () => {
      const originalPlatform = process.platform;
      Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });
      mockSystemPreferences.isTrustedAccessibilityClient.mockReturnValue(true);

      const result = requestAccessibilityPermission();
      expect(result).toBe(true);
      expect(mockSystemPreferences.isTrustedAccessibilityClient).toHaveBeenCalledWith(true);

      Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
    });

    it('returns false on error', () => {
      const originalPlatform = process.platform;
      Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });
      mockSystemPreferences.isTrustedAccessibilityClient.mockImplementation(() => { throw new Error('err'); });

      const result = requestAccessibilityPermission();
      expect(result).toBe(false);

      Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
    });
  });

  describe('openPermissionSettings', () => {
    it('opens screen capture settings on macOS', async () => {
      const originalPlatform = process.platform;
      Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });
      mockShell.openExternal.mockResolvedValue(undefined);

      const result = await openPermissionSettings('screenCapture');
      expect(result).toBe(true);
      expect(mockShell.openExternal).toHaveBeenCalledWith(
        'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture'
      );

      Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
    });

    it('opens accessibility settings on macOS', async () => {
      const originalPlatform = process.platform;
      Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });
      mockShell.openExternal.mockResolvedValue(undefined);

      const result = await openPermissionSettings('accessibility');
      expect(result).toBe(true);
      expect(mockShell.openExternal).toHaveBeenCalledWith(
        'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility'
      );

      Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
    });

    it('returns false on Windows', async () => {
      const originalPlatform = process.platform;
      Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });

      const result = await openPermissionSettings('screenCapture');
      expect(result).toBe(false);

      Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
    });

    it('returns false on Linux', async () => {
      const originalPlatform = process.platform;
      Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });

      const result = await openPermissionSettings('screenCapture');
      expect(result).toBe(false);

      Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
    });

    it('handles openExternal errors', async () => {
      const originalPlatform = process.platform;
      Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });
      mockShell.openExternal.mockRejectedValue(new Error('fail'));

      const result = await openPermissionSettings('screenCapture');
      expect(result).toBe(false);

      Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
    });
  });
});
