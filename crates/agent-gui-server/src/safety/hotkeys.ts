/**
 * Dangerous hotkey blacklist with platform-specific rules.
 */

import { getPlatform, type Platform } from '../utils/platform.js';

export interface HotkeyValidationResult {
  blocked: boolean;
  reason?: string;
}

interface BlacklistEntry {
  keys: string[];
  description: string;
}

const BLACKLISTS: Record<Platform, BlacklistEntry[]> = {
  macos: [
    { keys: ['meta', 'q'], description: 'Quit application' },
    { keys: ['meta', 'w'], description: 'Close window' },
    { keys: ['meta', 'alt', 'escape'], description: 'Force quit' },
    { keys: ['meta', 'shift', 'q'], description: 'Log out' },
    { keys: ['meta', 'alt', 'shift', 'q'], description: 'Force log out' },
  ],
  windows: [
    { keys: ['alt', 'f4'], description: 'Close application' },
    { keys: ['control', 'alt', 'delete'], description: 'System menu' },
    { keys: ['meta', 'l'], description: 'Lock screen' },
  ],
  linux: [
    { keys: ['alt', 'f4'], description: 'Close window' },
    { keys: ['control', 'alt', 'delete'], description: 'System interrupt' },
    { keys: ['control', 'alt', 'backspace'], description: 'Kill X server' },
  ],
};

function normalizeKey(key: string): string {
  const lower = key.toLowerCase().trim();
  // Normalize common aliases
  switch (lower) {
    case 'cmd':
    case 'command':
    case 'super':
    case 'win':
      return 'meta';
    case 'opt':
    case 'option':
      return 'alt';
    case 'ctrl':
      return 'control';
    case 'esc':
      return 'escape';
    case 'del':
      return 'delete';
    default:
      return lower;
  }
}

/**
 * Validate a hotkey combination against the platform blacklist.
 */
export function validateHotkey(keys: string[]): HotkeyValidationResult {
  const platform = getPlatform();
  const blacklist = BLACKLISTS[platform];
  const normalized = keys.map(normalizeKey).sort();

  for (const entry of blacklist) {
    const entryNormalized = entry.keys.map(normalizeKey).sort();
    if (
      normalized.length === entryNormalized.length &&
      normalized.every((k, i) => k === entryNormalized[i])
    ) {
      return {
        blocked: true,
        reason: `${entry.description} (${keys.join('+')})`,
      };
    }
  }

  return { blocked: false };
}
