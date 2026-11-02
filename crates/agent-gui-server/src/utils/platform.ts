/**
 * Platform detection and permission checking utilities.
 */

import * as os from 'os';

export type Platform = 'macos' | 'windows' | 'linux';

export function getPlatform(): Platform {
  switch (os.platform()) {
    case 'darwin': return 'macos';
    case 'win32': return 'windows';
    default: return 'linux';
  }
}

/**
 * Check screen recording permission (macOS only).
 * On other platforms, always returns true.
 */
export async function checkScreenRecordingPermission(): Promise<boolean> {
  if (getPlatform() !== 'macos') return true;
  try {
    // Attempt a test capture to verify permission
    const { screen } = await import('@nut-tree-fork/nut-js');
    await screen.width();
    return true;
  } catch {
    return false;
  }
}

/**
 * Check accessibility permission (macOS only).
 * On other platforms, always returns true.
 */
export async function checkAccessibilityPermission(): Promise<boolean> {
  if (getPlatform() !== 'macos') return true;
  try {
    const { mouse } = await import('@nut-tree-fork/nut-js');
    await mouse.getPosition();
    return true;
  } catch {
    return false;
  }
}

/**
 * Get platform-specific paste key combination.
 * macOS: Meta+V, Windows/Linux: Control+V
 */
export function getPlatformPasteKeys(): string[] {
  if (getPlatform() === 'macos') {
    return ['Meta', 'V'];
  }
  return ['Control', 'V'];
}
