/**
 * Keyboard operations with CJK/long text routing.
 *
 * - Non-ASCII or text > 50 chars → clipboard paste
 * - Otherwise → nut.js keyboard.type()
 */

import { DesktopError } from '../utils/errors.js';
import { pasteText } from './clipboard.js';

const NON_ASCII_RE = /[^\x00-\x7F]/;
const MAX_TYPE_LENGTH = 50;

/**
 * Type text with smart routing:
 * - CJK/non-ASCII or long text → clipboard paste
 * - Short ASCII → direct nut.js typing
 */
export async function typeText(text: string): Promise<void> {
  if (NON_ASCII_RE.test(text) || text.length > MAX_TYPE_LENGTH) {
    await pasteText(text);
    return;
  }

  try {
    const { keyboard } = await import('@nut-tree-fork/nut-js');
    await keyboard.type(text);
  } catch (err) {
    throw new DesktopError('keyboard.typeText', err instanceof Error ? err : new Error(String(err)));
  }
}

/**
 * Press a single key by name.
 */
export async function pressKey(key: string): Promise<void> {
  try {
    const { keyboard, Key } = await import('@nut-tree-fork/nut-js');
    const keyObj = Key[key as keyof typeof Key];
    if (keyObj === undefined) {
      throw new Error(`Unknown key: ${key}`);
    }
    await keyboard.pressKey(keyObj);
    await keyboard.releaseKey(keyObj);
  } catch (err) {
    throw new DesktopError('keyboard.pressKey', err instanceof Error ? err : new Error(String(err)));
  }
}

/**
 * Press a key combination (hotkey).
 */
export async function hotkey(keys: string[]): Promise<void> {
  try {
    const { keyboard, Key } = await import('@nut-tree-fork/nut-js');
    const keyObjs = keys.map(k => {
      const keyObj = Key[k as keyof typeof Key];
      if (keyObj === undefined) {
        throw new Error(`Unknown key: ${k}`);
      }
      return keyObj;
    });
    await keyboard.pressKey(...keyObjs);
    await keyboard.releaseKey(...keyObjs.reverse());
  } catch (err) {
    throw new DesktopError('keyboard.hotkey', err instanceof Error ? err : new Error(String(err)));
  }
}
