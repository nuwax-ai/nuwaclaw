/**
 * Clipboard operations for CJK paste workflow.
 *
 * Uses clipboardy for cross-platform clipboard access
 * and nut.js for key simulation.
 */

import { DesktopError } from '../utils/errors.js';
import { getPlatformPasteKeys } from '../utils/platform.js';

/**
 * Read current clipboard content.
 */
export async function readClipboard(): Promise<string> {
  try {
    const { default: clipboard } = await import('clipboardy');
    return await clipboard.read();
  } catch (err) {
    throw new DesktopError('clipboard.read', err instanceof Error ? err : new Error(String(err)));
  }
}

/**
 * Write text to clipboard.
 */
export async function writeClipboard(text: string): Promise<void> {
  try {
    const { default: clipboard } = await import('clipboardy');
    await clipboard.write(text);
  } catch (err) {
    throw new DesktopError('clipboard.write', err instanceof Error ? err : new Error(String(err)));
  }
}

/**
 * Paste text via clipboard:
 * 1. Backup current clipboard
 * 2. Write target text
 * 3. Simulate Cmd/Ctrl+V
 * 4. Wait 100ms
 * 5. Restore clipboard (best-effort)
 */
export async function pasteText(text: string): Promise<void> {
  let backup: string | undefined;
  try {
    backup = await readClipboard();
  } catch {
    // Failed to backup, continue anyway
  }

  try {
    await writeClipboard(text);

    const { keyboard, Key } = await import('@nut-tree-fork/nut-js');
    const pasteKeys = getPlatformPasteKeys();

    const keyObjs = pasteKeys.map(k => {
      const keyName = k as keyof typeof Key;
      return Key[keyName];
    });
    await keyboard.pressKey(...keyObjs);
    await keyboard.releaseKey(...[...keyObjs].reverse());

    // Wait for paste to complete
    await new Promise(resolve => setTimeout(resolve, 100));
  } catch (err) {
    throw new DesktopError('clipboard.pasteText', err instanceof Error ? err : new Error(String(err)));
  }

  // Restore clipboard (best-effort, do not throw)
  if (backup !== undefined) {
    try {
      await writeClipboard(backup);
    } catch {
      // Ignore restore failure
    }
  }
}
